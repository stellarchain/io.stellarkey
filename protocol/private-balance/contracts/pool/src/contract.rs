use crate::action::{
    DepositAction, TransferAction, WithdrawAction, address_payload, contract_payload, from_deposit,
    from_transfer, from_withdraw, public_signals,
};
use crate::archive::{self, ArchiveMeta};
use crate::errors::PoolError;
use crate::events::*;
use crate::generated_artifacts::{
    EXPECTED_CIRCUIT_HASH, EXPECTED_POSEIDON2_PARAMETER_HASH, EXPECTED_VERIFICATION_KEY_HASH,
};
use crate::storage::*;
use crate::{nullifier, token};
use private_balance_protocol::action::{Action as ProtocolAction, ActionKind};
use private_balance_protocol::constants::{
    ADDRESS_CHECKSUM_BYTES, ADDRESS_CONTEXT_TAG_BYTES, PAGE_CAPACITY, PRIVATE_ADDRESS_ASCII_BYTES,
    PRIVATE_ADDRESS_PAYLOAD_BYTES, PROTOCOL_VERSION, ROOT_WINDOW_LEDGERS, TREE_DEPTH,
};
use private_balance_protocol::deployment::DeploymentBinding;
use private_balance_protocol::encoding::{compute_context_field, compute_context_hash};
use private_balance_protocol::poseidon2::p2;
use private_balance_protocol::tree::EMPTY_ROOTS;
use private_balance_verifier::{Proof, verify_groth16_proof};
use soroban_sdk::{Address, BytesN, Env, Vec, contract, contractimpl, panic_with_error};

#[contract]
pub struct PrivateBalancePool;

fn append_leaf_to_frontier(
    env: &Env,
    tree: &mut TreeStorage,
    leaf: &BytesN<32>,
) -> Result<(), PoolError> {
    let index = tree.next_index;
    if index >= (1u64 << TREE_DEPTH) {
        return Err(PoolError::TreeFull);
    }

    let mut cur = leaf.to_array();
    let mut node_index = index;
    let mut next_frontier = tree.frontier.clone();

    let mut level = 0usize;
    while node_index & 1 == 1 {
        let left = next_frontier.get(level as u32).unwrap().to_array();
        cur = p2("SKSB_MERKLE_NODE_V1", &[left, cur]);
        node_index >>= 1;
        level += 1;
    }
    if level < TREE_DEPTH {
        next_frontier.set(level as u32, BytesN::from_array(env, &cur));
    } else {
        tree.current_root = BytesN::from_array(env, &cur);
    }

    tree.next_index += 1;
    tree.frontier = next_frontier;
    Ok(())
}

fn compute_tree_root(env: &Env, tree: &TreeStorage) -> BytesN<32> {
    if tree.next_index == (1u64 << TREE_DEPTH) {
        return tree.current_root.clone();
    }
    let mut current = EMPTY_ROOTS[0];
    let mut node_index = tree.next_index;
    for (level, empty_root) in EMPTY_ROOTS.iter().enumerate().take(TREE_DEPTH) {
        current = if node_index & 1 == 1 {
            let left = tree.frontier.get(level as u32).unwrap().to_array();
            p2("SKSB_MERKLE_NODE_V1", &[left, current])
        } else {
            p2("SKSB_MERKLE_NODE_V1", &[current, *empty_root])
        };
        node_index >>= 1;
    }
    BytesN::from_array(env, &current)
}

fn execute_action(
    env: &Env,
    config: &PoolConfig,
    action: &ProtocolAction,
    asset: &Address,
    proof: &Proof,
    public_address: Option<&Address>,
    relayer_address: Option<&Address>,
) -> Result<u32, PoolError> {
    if action.asset != address_payload(asset)? || contract_payload(asset)? != action.asset.1 {
        return Err(PoolError::NoncanonicalEncoding);
    }
    if action.kind == ActionKind::Deposit && deposits_paused(env) {
        return Err(PoolError::DepositsPaused);
    }

    if action.kind != ActionKind::Deposit {
        known_root(env, &BytesN::from_array(env, &action.anchor_root))?;
        for nullifier in &action.nullifiers {
            if *nullifier != [0; 32] {
                nullifier::require_unspent(env, &BytesN::from_array(env, nullifier))?;
            }
        }
    }

    let tree_before = get_tree(env);
    if tree_before.next_index > (1u64 << TREE_DEPTH) - 2 {
        return Err(PoolError::TreeFull);
    }

    let signals = public_signals(env, config, action)?;
    let valid = verify_groth16_proof(env, proof, &signals).map_err(|_| PoolError::InvalidProof)?;
    if !valid {
        return Err(PoolError::InvalidProof);
    }

    let action_index = get_meta(env).action_count;
    for nullifier in &action.nullifiers {
        if *nullifier != [0; 32] {
            nullifier::mark_spent(env, &BytesN::from_array(env, nullifier), action_index);
        }
    }

    let mut tree = tree_before;
    let starting_leaf_index = tree.next_index;
    for output in &action.outputs {
        append_leaf_to_frontier(env, &mut tree, &BytesN::from_array(env, &output.cm))?;
    }
    tree.current_root = compute_tree_root(env, &tree);
    add_known_root(env, &tree.current_root, config.root_window_ledgers)?;
    set_tree(env, &tree);

    let record = archive::append_record(
        env,
        config,
        action,
        asset,
        &BytesN::from_array(env, &signals[7]),
        starting_leaf_index,
        &tree.current_root,
        public_address,
        relayer_address,
    )?;
    debug_assert_eq!(action_index, record.action_index);

    match action.kind {
        ActionKind::Deposit => {
            let source = public_address.ok_or(PoolError::InvalidActionShape)?;
            token::deposit(env, asset, source, action.public_value);
        }
        ActionKind::PrivateTransfer => {
            if public_address.is_some() {
                return Err(PoolError::InvalidActionShape);
            }
            let relayer = relayer_address.ok_or(PoolError::InvalidActionShape)?;
            if action.relayer_fee > 0 {
                token::withdraw(env, asset, relayer, action.relayer_fee);
            }
        }
        ActionKind::Withdraw => {
            let recipient = public_address.ok_or(PoolError::InvalidActionShape)?;
            token::withdraw(env, asset, recipient, action.public_value);
            let relayer = relayer_address.ok_or(PoolError::InvalidActionShape)?;
            if action.relayer_fee > 0 {
                token::withdraw(env, asset, relayer, action.relayer_fee);
            }
        }
    }
    emit_shielded_action(env, &record);

    Ok(action_index)
}

#[contractimpl]
impl PrivateBalancePool {
    pub fn __constructor(
        env: Env,
        protocol_version: u32,
        network_id: BytesN<32>,
        realm_id: BytesN<32>,
        guardian: Address,
        poseidon2_parameter_hash: BytesN<32>,
        circuit_hash: BytesN<32>,
        verification_key_hash: BytesN<32>,
        tree_depth: u32,
        root_window_ledgers: u32,
        page_capacity: u32,
        deployment_binding_hash: BytesN<32>,
    ) {
        if protocol_version != u32::from(PROTOCOL_VERSION) {
            panic_with_error!(&env, PoolError::UnsupportedProtocol);
        }
        let configuration_matches = network_id == env.ledger().network_id()
            && realm_id.to_array() != [0; 32]
            && poseidon2_parameter_hash.to_array() == EXPECTED_POSEIDON2_PARAMETER_HASH
            && circuit_hash.to_array() == EXPECTED_CIRCUIT_HASH
            && verification_key_hash.to_array() == EXPECTED_VERIFICATION_KEY_HASH
            && tree_depth == TREE_DEPTH as u32
            && root_window_ledgers == ROOT_WINDOW_LEDGERS
            && page_capacity == PAGE_CAPACITY as u32;
        if !configuration_matches {
            panic_with_error!(&env, PoolError::InvalidConfiguration);
        }

        let pool_id = match contract_payload(&env.current_contract_address()) {
            Ok(value) => value,
            Err(_) => panic_with_error!(&env, PoolError::InvalidConfiguration),
        };
        let guardian_payload = match address_payload(&guardian) {
            Ok(value) if value.1 != [0; 32] => value,
            Ok(_) => panic_with_error!(&env, PoolError::InvalidConfiguration),
            Err(_) => panic_with_error!(&env, PoolError::InvalidConfiguration),
        };
        let expected_deployment_binding = DeploymentBinding {
            protocol_version: PROTOCOL_VERSION,
            network_id: network_id.to_array(),
            realm_id: realm_id.to_array(),
            pool_id,
            guardian: guardian_payload,
            poseidon2_parameter_hash: EXPECTED_POSEIDON2_PARAMETER_HASH,
            circuit_hash: EXPECTED_CIRCUIT_HASH,
            verification_key_hash: EXPECTED_VERIFICATION_KEY_HASH,
            tree_depth,
            root_window_ledgers,
            page_capacity,
            private_address_payload_bytes: PRIVATE_ADDRESS_PAYLOAD_BYTES as u32,
            private_address_ascii_bytes: PRIVATE_ADDRESS_ASCII_BYTES as u32,
            address_context_tag_bytes: ADDRESS_CONTEXT_TAG_BYTES as u32,
            address_checksum_bytes: ADDRESS_CHECKSUM_BYTES as u32,
            hpke_kem_id: 0x0020,
            hpke_kdf_id: 0x0001,
            hpke_aead_id: 0x0001,
        };
        let expected_deployment_binding = match expected_deployment_binding.hash() {
            Ok(value) => value,
            Err(_) => panic_with_error!(&env, PoolError::InvalidConfiguration),
        };
        if deployment_binding_hash.to_array() != expected_deployment_binding {
            panic_with_error!(&env, PoolError::InvalidConfiguration);
        }

        let context_hash = compute_context_hash(
            PROTOCOL_VERSION,
            &network_id.to_array(),
            &realm_id.to_array(),
            &pool_id,
        );
        let context_field = compute_context_field(&context_hash);

        let current_root = BytesN::from_array(&env, &EMPTY_ROOTS[TREE_DEPTH]);

        let mut frontier_vec = Vec::new(&env);
        for empty_root in EMPTY_ROOTS.iter().take(TREE_DEPTH) {
            frontier_vec.push_back(BytesN::from_array(&env, empty_root));
        }

        let tree = TreeStorage {
            next_index: 0_u64,
            frontier: frontier_vec,
            current_root: current_root.clone(),
        };

        let config = PoolConfig {
            protocol_version,
            network_id,
            realm_id,
            guardian,
            poseidon2_parameter_hash,
            circuit_hash,
            verification_key_hash,
            tree_depth,
            root_window_ledgers,
            page_capacity,
            deployment_binding_hash,
            context_hash: BytesN::from_array(&env, &context_hash),
            context_field: BytesN::from_array(&env, &context_field),
        };
        let meta = ArchiveMeta {
            action_count: 0,
            transcript_head: BytesN::from_array(&env, &archive::genesis_record_hash(&config)),
        };

        set_config(&env, &config);
        crate::storage::set_deposits_paused(&env, false);
        set_tree(&env, &tree);
        set_meta(&env, &meta);
        if let Err(error) = add_known_root(&env, &current_root, root_window_ledgers) {
            panic_with_error!(&env, error);
        }
    }

    pub fn deposit(env: Env, action: DepositAction, proof: Proof) -> Result<u32, PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        if deposits_paused(&env) {
            return Err(PoolError::DepositsPaused);
        }
        let source = action.deposit_source.clone();
        let asset = action.asset.clone();
        let action = from_deposit(&action)?;
        execute_action(&env, &config, &action, &asset, &proof, Some(&source), None)
    }

    pub fn transfer(env: Env, action: TransferAction, proof: Proof) -> Result<u32, PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        let relayer = action.relayer.clone();
        let asset = action.asset.clone();
        let action = from_transfer(&action)?;
        execute_action(&env, &config, &action, &asset, &proof, None, Some(&relayer))
    }

    pub fn withdraw(env: Env, action: WithdrawAction, proof: Proof) -> Result<u32, PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        let recipient = action.public_recipient.clone();
        let relayer = action.relayer.clone();
        let asset = action.asset.clone();
        let action = from_withdraw(&action)?;
        execute_action(
            &env,
            &config,
            &action,
            &asset,
            &proof,
            Some(&recipient),
            Some(&relayer),
        )
    }

    pub fn config(env: Env) -> PoolConfig {
        get_config(&env).unwrap_or_else(|| panic_with_error!(&env, PoolError::InvalidConfiguration))
    }

    pub fn archive_meta(env: Env) -> ArchiveMeta {
        get_meta(&env)
    }

    pub fn tree_state(env: Env) -> TreeStorage {
        get_tree(&env)
    }

    pub fn deposits_paused(env: Env) -> bool {
        deposits_paused(&env)
    }

    pub fn set_deposits_paused(env: Env, paused: bool) -> Result<(), PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        config.guardian.require_auth();
        crate::storage::set_deposits_paused(&env, paused);
        emit_deposits_paused(&env, paused);
        Ok(())
    }
}
