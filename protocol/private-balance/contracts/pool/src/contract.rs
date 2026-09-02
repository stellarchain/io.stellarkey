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
    PRIVATE_ADDRESS_PAYLOAD_BYTES, PROTOCOL_VERSION, ROOT_WINDOW_LEDGERS, TREE_ARITY,
    TREE_CAPACITY, TREE_DEPTH, TREE_FRONTIER_WIDTH,
};
use private_balance_protocol::deployment::DeploymentBinding;
use private_balance_protocol::encoding::{compute_context_field, compute_context_hash};
use private_balance_protocol::tree::{EMPTY_ROOTS, hash_merkle_node};
use private_balance_verifier::{Proof, verify_groth16_proof};
use soroban_sdk::{Address, BytesN, Env, Vec, contract, contractimpl, panic_with_error};

#[contract]
pub struct PrivateBalancePool;

fn frontier_offset(level: usize, position: usize) -> u32 {
    (level * TREE_FRONTIER_WIDTH + position) as u32
}

fn append_leaf_to_frontier(
    env: &Env,
    tree: &mut TreeStorage,
    leaf: &BytesN<32>,
) -> Result<(), PoolError> {
    let index = tree.next_index;
    if index >= TREE_CAPACITY {
        return Err(PoolError::TreeFull);
    }

    let mut cur = leaf.to_array();
    let mut node_index = index;
    let mut next_frontier = tree.frontier.clone();

    let mut level = 0usize;
    loop {
        match node_index % TREE_ARITY as u64 {
            0 => {
                next_frontier.set(frontier_offset(level, 0), BytesN::from_array(env, &cur));
                break;
            }
            1 => {
                next_frontier.set(frontier_offset(level, 1), BytesN::from_array(env, &cur));
                break;
            }
            2 => {
                let first = next_frontier
                    .get(frontier_offset(level, 0))
                    .unwrap()
                    .to_array();
                let second = next_frontier
                    .get(frontier_offset(level, 1))
                    .unwrap()
                    .to_array();
                cur = hash_merkle_node(&[first, second, cur]);
                node_index /= TREE_ARITY as u64;
                level += 1;
                if level == TREE_DEPTH {
                    tree.current_root = BytesN::from_array(env, &cur);
                    break;
                }
            }
            _ => unreachable!(),
        }
    }

    tree.next_index += 1;
    tree.frontier = next_frontier;
    Ok(())
}

fn compute_tree_root(env: &Env, tree: &TreeStorage) -> BytesN<32> {
    if tree.next_index == TREE_CAPACITY {
        return tree.current_root.clone();
    }
    let mut current = EMPTY_ROOTS[0];
    let mut node_index = tree.next_index;
    for (level, empty_root) in EMPTY_ROOTS.iter().enumerate().take(TREE_DEPTH) {
        current = match node_index % TREE_ARITY as u64 {
            0 => hash_merkle_node(&[current, *empty_root, *empty_root]),
            1 => {
                let first = tree
                    .frontier
                    .get(frontier_offset(level, 0))
                    .unwrap()
                    .to_array();
                hash_merkle_node(&[first, current, *empty_root])
            }
            2 => {
                let first = tree
                    .frontier
                    .get(frontier_offset(level, 0))
                    .unwrap()
                    .to_array();
                let second = tree
                    .frontier
                    .get(frontier_offset(level, 1))
                    .unwrap()
                    .to_array();
                hash_merkle_node(&[first, second, current])
            }
            _ => unreachable!(),
        };
        node_index /= TREE_ARITY as u64;
    }
    BytesN::from_array(env, &current)
}

fn execute_action(
    env: &Env,
    config: &PoolConfig,
    action: &ProtocolAction,
    proof: &Proof,
    public_address: Option<&Address>,
    relayer_address: Option<&Address>,
) -> Result<u32, PoolError> {
    let asset = get_asset(env).ok_or(PoolError::InvalidConfiguration)?;
    if action.asset != address_payload(&asset)? || contract_payload(&asset)? != action.asset.1 {
        return Err(PoolError::NoncanonicalEncoding);
    }
    if action.kind == ActionKind::Deposit && deposits_paused(env) {
        return Err(PoolError::DepositsPaused);
    }

    let tree_before = get_tree(env);
    if action.kind != ActionKind::Deposit {
        let anchor_root = BytesN::from_array(env, &action.anchor_root);
        if anchor_root == tree_before.current_root {
            // The current root must remain spendable even after an idle root
            // window or while deposits are paused. This write rolls back with
            // the action if proof verification or token movement fails.
            add_known_root(env, &anchor_root, config.root_window_ledgers)?;
        }
        known_root(env, &anchor_root)?;
    }
    // Deposits have no real inputs. One durable dummy nullifier is sufficient
    // to reject proof replay; the second public slot remains for fixed arity.
    let persistent_nullifier_count = if action.kind == ActionKind::Deposit { 1 } else { 2 };
    for nullifier in action.nullifiers.iter().take(persistent_nullifier_count) {
        nullifier::require_unspent(env, &BytesN::from_array(env, nullifier))?;
    }

    if tree_before.next_index > TREE_CAPACITY - 2 {
        return Err(PoolError::TreeFull);
    }

    let signals = public_signals(env, config, action)?;
    let valid = verify_groth16_proof(env, proof, &signals).map_err(|_| PoolError::InvalidProof)?;
    if !valid {
        return Err(PoolError::InvalidProof);
    }

    let action_index = get_meta(env).action_count;
    for nullifier in action.nullifiers.iter().take(persistent_nullifier_count) {
        nullifier::mark_spent(env, &BytesN::from_array(env, nullifier), action_index);
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
        &asset,
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
            token::deposit(env, &asset, source, action.public_value);
        }
        ActionKind::PrivateTransfer => {
            if public_address.is_some() {
                return Err(PoolError::InvalidActionShape);
            }
            let relayer = relayer_address.ok_or(PoolError::InvalidActionShape)?;
            if action.relayer_fee > 0 {
                token::withdraw(env, &asset, relayer, action.relayer_fee);
            }
        }
        ActionKind::Withdraw => {
            let recipient = public_address.ok_or(PoolError::InvalidActionShape)?;
            token::withdraw(env, &asset, recipient, action.public_value);
            let relayer = relayer_address.ok_or(PoolError::InvalidActionShape)?;
            if action.relayer_fee > 0 {
                token::withdraw(env, &asset, relayer, action.relayer_fee);
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
        asset: Address,
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
        let asset_payload = match contract_payload(&asset) {
            Ok(value) => (1, value),
            Err(_) => panic_with_error!(&env, PoolError::InvalidConfiguration),
        };
        let expected_deployment_binding = DeploymentBinding {
            protocol_version: PROTOCOL_VERSION,
            network_id: network_id.to_array(),
            realm_id: realm_id.to_array(),
            pool_id,
            asset: asset_payload,
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
            for _ in 0..TREE_FRONTIER_WIDTH {
                frontier_vec.push_back(BytesN::from_array(&env, empty_root));
            }
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
        set_asset(&env, &asset);
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
        let asset = get_asset(&env).ok_or(PoolError::InvalidConfiguration)?;
        let action = from_deposit(&action, &asset)?;
        execute_action(&env, &config, &action, &proof, Some(&source), None)
    }

    pub fn transfer(env: Env, action: TransferAction, proof: Proof) -> Result<u32, PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        let relayer = action.relayer.clone();
        let asset = get_asset(&env).ok_or(PoolError::InvalidConfiguration)?;
        let action = from_transfer(&action, &asset)?;
        execute_action(&env, &config, &action, &proof, None, Some(&relayer))
    }

    pub fn withdraw(env: Env, action: WithdrawAction, proof: Proof) -> Result<u32, PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        let recipient = action.public_recipient.clone();
        let relayer = action.relayer.clone();
        let asset = get_asset(&env).ok_or(PoolError::InvalidConfiguration)?;
        let action = from_withdraw(&action, &asset)?;
        execute_action(
            &env,
            &config,
            &action,
            &proof,
            Some(&recipient),
            Some(&relayer),
        )
    }

    pub fn config(env: Env) -> PoolConfig {
        get_config(&env).unwrap_or_else(|| panic_with_error!(&env, PoolError::InvalidConfiguration))
    }

    pub fn asset(env: Env) -> Address {
        get_asset(&env).unwrap_or_else(|| panic_with_error!(&env, PoolError::InvalidConfiguration))
    }

    pub fn archive_meta(env: Env) -> ArchiveMeta {
        get_meta(&env)
    }

    pub fn tree_state(env: Env) -> TreeStorage {
        get_tree(&env)
    }

    /// Re-registers the current tree root without moving value. This is
    /// permissionless so an idle pool remains spendable while deposits are
    /// paused, and repeated calls only refresh the same canonical root.
    pub fn touch_root(env: Env) -> Result<KnownRoot, PoolError> {
        let config = get_config(&env).ok_or(PoolError::InvalidConfiguration)?;
        let tree = get_tree(&env);
        add_known_root(&env, &tree.current_root, config.root_window_ledgers)
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
