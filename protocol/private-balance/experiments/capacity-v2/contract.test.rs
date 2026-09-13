//! Local native Soroban prototype; not compiled into the deployed pool Wasm.
//! Uses the existing verifier with a fixed constructor-supplied development VK.
//! Source, recipient and asset are fixed test accounts, not a wallet API.
use private_balance_verifier::{Proof, ProofBytes, VerificationKey, verify_groth16_proof_with_vk};
use serde_json::{Value, json};
use soroban_poseidon::poseidon2_hash;
use soroban_sdk::{
    Address, Bytes, BytesN, Env, U256, Vec, contract, contracterror, contractimpl, contracttype,
    crypto::bn254::Bn254Fr,
    testutils::{Address as _, EnvTestConfig, Ledger as _},
    token,
};

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub depth: u32,
    pub context: BytesN<32>,
    pub asset_field: BytesN<32>,
    pub token: Address,
    pub source: Address,
    pub recipient: Address,
    pub vk: Bytes,
}
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct State {
    pub next: u128,
    pub actions: u128,
    pub root: BytesN<32>,
    pub frontier: Vec<BytesN<32>>,
}
#[contracttype]
#[derive(Clone)]
pub enum Key {
    Config,
    State,
    Nullifier(BytesN<32>),
    Root(BytesN<32>),
    Record(u128),
    Zeros,
}
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Invalid = 1,
    Spent = 2,
    Capacity = 3,
    Root = 4,
    Proof = 5,
}
#[contract]
pub struct CapacityHarness;

fn field(env: &Env, n: u128) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[16..].copy_from_slice(&n.to_be_bytes());
    BytesN::from_array(env, &bytes)
}
fn p2(env: &Env, values: &Vec<BytesN<32>>) -> BytesN<32> {
    let mut inputs = Vec::new(env);
    for value in values {
        inputs.push_back(U256::from_be_bytes(env, &value.into()));
    }
    let mut bytes = [0u8; 32];
    poseidon2_hash::<4, Bn254Fr>(env, &inputs)
        .to_be_bytes()
        .copy_into_slice(&mut bytes);
    BytesN::from_array(env, &bytes)
}
fn parent(env: &Env, a: BytesN<32>, b: BytesN<32>, c: BytesN<32>) -> BytesN<32> {
    p2(env, &soroban_sdk::vec![env, a, b, c])
}
fn vk_from_bytes(raw: &[u8]) -> VerificationKey {
    assert_eq!(raw.len(), 1216);
    VerificationKey {
        alpha_g1: raw[0..64].try_into().unwrap(),
        beta_g2: raw[64..192].try_into().unwrap(),
        gamma_g2: raw[192..320].try_into().unwrap(),
        delta_g2: raw[320..448].try_into().unwrap(),
        gamma_abc: core::array::from_fn(|i| raw[448 + i * 64..512 + i * 64].try_into().unwrap()),
    }
}
fn append(env: &Env, state: &mut State, depth: u32, leaf: BytesN<32>) {
    let mut index = state.next;
    let mut node = leaf;
    for level in 0..depth {
        match index % 3 {
            0 | 1 => {
                state.frontier.set(level * 2 + (index % 3) as u32, node);
                break;
            }
            _ => {
                node = parent(
                    env,
                    state.frontier.get(level * 2).unwrap(),
                    state.frontier.get(level * 2 + 1).unwrap(),
                    node,
                );
                index /= 3;
                if level + 1 == depth {
                    state.root = node.clone();
                }
            }
        }
    }
    state.next += 1;
}
fn root(env: &Env, state: &State, depth: u32, zeros: &Vec<BytesN<32>>) -> BytesN<32> {
    if state.next == 3u128.pow(depth) {
        return state.root.clone();
    }
    let mut index = state.next;
    let mut node = zeros.get(0).unwrap();
    for level in 0..depth {
        let zero = zeros.get(level).unwrap();
        node = match index % 3 {
            0 => parent(env, node, zero.clone(), zero),
            1 => parent(env, state.frontier.get(level * 2).unwrap(), node, zero),
            _ => parent(
                env,
                state.frontier.get(level * 2).unwrap(),
                state.frontier.get(level * 2 + 1).unwrap(),
                node,
            ),
        };
        index /= 3;
    }
    node
}
#[contractimpl]
impl CapacityHarness {
    pub fn __constructor(env: Env, config: Config) {
        assert!(config.depth >= 2 && config.depth <= 64);
        assert_eq!(config.vk.len(), 1216);
        let mut zeros = soroban_sdk::vec![&env, field(&env, 0)];
        let mut frontier = Vec::new(&env);
        for level in 0..config.depth {
            let z = zeros.get(level).unwrap();
            zeros.push_back(parent(&env, z.clone(), z.clone(), z.clone()));
            frontier.push_back(z.clone());
            frontier.push_back(z);
        }
        let root = zeros.last().unwrap();
        env.storage().instance().set(
            &Key::State,
            &State {
                next: 0,
                actions: 0,
                root: root.clone(),
                frontier,
            },
        );
        env.storage().instance().set(&Key::Config, &config);
        env.storage().instance().set(&Key::Zeros, &zeros);
        env.storage().temporary().set(
            &Key::Root(root),
            &env.ledger().sequence().saturating_add(1440),
        );
    }
    pub fn state(env: Env) -> State {
        env.storage().instance().get(&Key::State).unwrap()
    }
    pub fn execute(env: Env, signals: Vec<BytesN<32>>, proof: Proof) -> Result<State, Error> {
        if signals.len() != 11 {
            return Err(Error::Invalid);
        }
        let config: Config = env.storage().instance().get(&Key::Config).unwrap();
        let mut state = Self::state(env.clone());
        let s = |i| signals.get(i).unwrap();
        let kind = (1u128..=4)
            .find(|n| s(2) == field(&env, *n))
            .ok_or(Error::Invalid)?;
        if s(0) != config.context
            || s(1)
                != if kind == 2 {
                    field(&env, 0)
                } else {
                    config.asset_field.clone()
                }
        {
            return Err(Error::Invalid);
        }
        let value_bytes = s(4).to_array();
        if value_bytes[..24] != [0u8; 24] {
            return Err(Error::Invalid);
        }
        let value = u64::from_be_bytes(value_bytes[24..].try_into().unwrap());
        if value > i64::MAX as u64 || (kind == 2 && value != 0) || (kind != 2 && value == 0) {
            return Err(Error::Invalid);
        }
        let mut digest_inputs = soroban_sdk::vec![&env, field(&env, 987654321)];
        for i in 0..11 {
            if i != 5 {
                digest_inputs.push_back(s(i));
            }
        }
        if p2(&env, &digest_inputs) != s(5) {
            return Err(Error::Invalid);
        }
        if kind == 1 {
            if s(3) != field(&env, 0) {
                return Err(Error::Root);
            }
            config.source.require_auth();
        } else if s(3) != state.root {
            let expiry: Option<u32> = env.storage().temporary().get(&Key::Root(s(3)));
            if expiry.is_none_or(|expiry| expiry < env.ledger().sequence()) {
                return Err(Error::Root);
            }
        }
        for i in 6..8 {
            if env.storage().persistent().has(&Key::Nullifier(s(i))) {
                return Err(Error::Spent);
            }
        }
        if kind != 4 && state.next > 3u128.pow(config.depth) - 3 {
            return Err(Error::Capacity);
        }
        let vk = vk_from_bytes(&config.vk.to_alloc_vec());
        let public = core::array::from_fn(|i| s(i as u32).to_array());
        if !verify_groth16_proof_with_vk(&env, &vk, &proof, &public).map_err(|_| Error::Proof)? {
            return Err(Error::Proof);
        }
        if kind != 4 {
            for i in 8..11 {
                append(&env, &mut state, config.depth, s(i));
            }
            state.root = root(
                &env,
                &state,
                config.depth,
                &env.storage().instance().get(&Key::Zeros).unwrap(),
            );
        }
        for i in 6..8 {
            env.storage()
                .persistent()
                .set(&Key::Nullifier(s(i)), &state.actions);
        }
        // Fixed-size public synthetic record, keyed by independent u128 action
        // count. Production encrypted transcript/retention is a separate gate.
        env.storage().persistent().set(
            &Key::Record(state.actions),
            &(signals, state.next, state.root.clone()),
        );
        state.actions = state.actions.checked_add(1).ok_or(Error::Capacity)?;
        env.storage().instance().set(&Key::State, &state);
        env.storage().temporary().set(
            &Key::Root(state.root.clone()),
            &env.ledger().sequence().saturating_add(1440),
        );
        let tokens = token::Client::new(&env, &config.token);
        if kind == 1 {
            tokens.transfer(
                &config.source,
                &env.current_contract_address(),
                &i128::from(value),
            );
        }
        if kind == 3 || kind == 4 {
            tokens.transfer(
                &env.current_contract_address(),
                &config.recipient,
                &i128::from(value),
            );
        }
        Ok(state)
    }
}

fn dec(s: &str) -> [u8; 32] {
    let raw = num_bigint::BigUint::parse_bytes(s.as_bytes(), 10)
        .unwrap()
        .to_bytes_be();
    let mut bytes = [0u8; 32];
    bytes[32 - raw.len()..].copy_from_slice(&raw);
    bytes
}
fn g1(v: &Value) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&dec(v[0].as_str().unwrap()));
    out[32..].copy_from_slice(&dec(v[1].as_str().unwrap()));
    out
}
fn g2(v: &Value) -> [u8; 128] {
    let mut out = [0u8; 128];
    for (i, (row, col)) in [(0, 1), (0, 0), (1, 1), (1, 0)].iter().enumerate() {
        out[i * 32..(i + 1) * 32].copy_from_slice(&dec(v[*row][*col].as_str().unwrap()));
    }
    out
}
fn proof(env: &Env, vector: &Value) -> Proof {
    let p = &vector["proof"];
    ProofBytes {
        a: g1(&p["pi_a"]),
        b: g2(&p["pi_b"]),
        c: g1(&p["pi_c"]),
    }
    .to_contract_proof(env)
}
fn signals(env: &Env, vector: &Value) -> Vec<BytesN<32>> {
    Vec::from_iter(
        env,
        vector["publicSignals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| BytesN::from_array(env, &dec(x.as_str().unwrap()))),
    )
}
fn fixture_path(name: &str, file: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../experiments/capacity-v2/build")
        .join(name)
        .join(file)
}

#[test]
#[ignore = "opt-in capacity prototype: run compile.mjs and prove.mjs first"]
fn proof_verified_rollover_exit_and_host_costs() {
    let mut metrics = std::vec::Vec::new();
    for (name, depth) in [("small", 2), ("full", 64)] {
        let mut env = Env::default();
        env.set_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
            ..Default::default()
        });
        env.cost_estimate().budget().reset_unlimited();
        env.mock_all_auths(); // Deliberately synthetic SAC accounts only.
        let source = Address::generate(&env);
        let recipient = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        token::StellarAssetClient::new(&env, &asset).mint(&source, &100);
        let vk: Value = serde_json::from_slice(
            &std::fs::read(fixture_path(name, "verification_key.json")).expect("run prove.mjs"),
        )
        .unwrap();
        let mut raw_vk = std::vec::Vec::new();
        raw_vk.extend(g1(&vk["vk_alpha_1"]));
        for k in ["vk_beta_2", "vk_gamma_2", "vk_delta_2"] {
            raw_vk.extend(g2(&vk[k]));
        }
        for ic in vk["IC"].as_array().unwrap() {
            raw_vk.extend(g1(ic));
        }
        let id = env.register(
            CapacityHarness,
            (Config {
                depth,
                context: field(&env, 424242),
                asset_field: field(&env, 84),
                token: asset.clone(),
                source: source.clone(),
                recipient: recipient.clone(),
                vk: Bytes::from_slice(&env, &raw_vk),
            },),
        );
        let client = CapacityHarnessClient::new(&env, &id);
        let vectors: std::vec::Vec<Value> =
            serde_json::from_slice(&std::fs::read(fixture_path(name, "vectors.json")).unwrap())
                .unwrap();
        let alternate: Value = serde_json::from_slice(
            &std::fs::read(fixture_path(name, "alternate-exit.json")).unwrap(),
        )
        .unwrap();
        for (i, vector) in vectors.iter().enumerate() {
            let before = client.state();
            let sig = signals(&env, vector);
            let p = proof(&env, vector);
            // Stale historical anchors cannot be revived by expiry; a current
            // root remains spendable after idle time, including at saturation.
            if i == 3 {
                env.ledger().with_mut(|info| info.sequence_number += 1500);
                // Synthetic counter fixture proves archive indexing does not
                // truncate to u32, u64, or JavaScript's safe integer range.
                env.as_contract(&id, || {
                    let mut state = CapacityHarness::state(env.clone());
                    state.actions = 1u128 << 80;
                    env.storage().instance().set(&Key::State, &state);
                });
            }
            if i == 2 {
                let mut bad = sig.clone();
                bad.set(6, field(&env, 991));
                let mut digest = soroban_sdk::vec![&env, field(&env, 987654321)];
                for j in 0..11 {
                    if j != 5 {
                        digest.push_back(bad.get(j).unwrap());
                    }
                }
                bad.set(5, p2(&env, &digest));
                assert!(matches!(
                    client.try_execute(&bad, &p),
                    Err(Ok(Error::Proof))
                ));
                assert_eq!(client.state(), before, "invalid proof must roll back state");
            }
            let state = match client.try_execute(&sig, &p) {
                Ok(Ok(state)) => state,
                _ => panic!("synthetic prototype action failed (arguments intentionally omitted)"),
            };
            let costs = env.cost_estimate().resources();
            metrics.push(json!({"tree": name, "action": vector["name"], "instructions": costs.instructions,
                "memoryBytes": costs.mem_bytes, "diskReadBytes": costs.disk_read_bytes,
                "writeBytes": costs.write_bytes, "writeEntries": costs.write_entries,
                "nativeHostOnly": true, "excludes": "Wasm execution/instantiation, network fees, full encrypted archive and transaction bytes"}));
            assert_eq!(
                state.root.to_array(),
                dec(vector["checkpoint"]["root"].as_str().unwrap())
            );
            assert_eq!(
                state.next.to_string(),
                vector["checkpoint"]["next"].as_str().unwrap()
            );
            assert_eq!(
                state.actions,
                if i == 3 {
                    (1u128 << 80) + 1
                } else {
                    i as u128 + 1
                }
            );
            if i == 3 {
                assert_eq!(state.root, before.root);
                assert_eq!(state.next, before.next);
            }
            if i == 2 {
                assert!(
                    matches!(
                        client.try_execute(&signals(&env, &alternate), &proof(&env, &alternate)),
                        Err(Ok(Error::Spent))
                    ),
                    "normal spend and exit must share nullifiers"
                );
            }
            assert_eq!(client.try_execute(&sig, &p), Err(Ok(Error::Spent)));
            assert_eq!(client.state(), state);
        }
        assert_eq!(token::Client::new(&env, &asset).balance(&recipient), 100);
        assert_eq!(token::Client::new(&env, &asset).balance(&id), 0);
    }
    let output = fixture_path("", "contract-costs.json");
    std::fs::write(output, serde_json::to_vec_pretty(&metrics).unwrap()).unwrap();
}
