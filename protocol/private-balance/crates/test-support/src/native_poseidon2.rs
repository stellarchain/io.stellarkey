use ark_bn254::Fr;
use ark_ff::{AdditiveGroup, BigInteger, Field, PrimeField};
use private_balance_protocol::{
    constants::{DOMAIN_MERKLE_NODE, TREE_DEPTH},
    field::{bytes_to_field, is_canonical_field},
    tree::{TreeError, TreeState},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const WIDTH: usize = 4;
const RATE: usize = 3;
const FULL_ROUNDS_PER_SIDE: usize = 4;
const PARTIAL_ROUNDS: usize = 56;

#[derive(Deserialize)]
struct ParameterFile {
    width: usize,
    rate: usize,
    full_rounds: usize,
    partial_rounds: usize,
    m_diag: Vec<String>,
    rc: Vec<String>,
}

struct Parameters {
    diagonal: [Fr; WIDTH],
    round_constants: Vec<Fr>,
}

fn parse_field(encoded: &str) -> Fr {
    let raw = hex::decode(encoded.strip_prefix("0x").unwrap_or(encoded))
        .expect("pinned Poseidon2 parameter must be hexadecimal");
    Fr::from_be_bytes_mod_order(&raw)
}

fn parameters() -> &'static Parameters {
    static PARAMETERS: OnceLock<Parameters> = OnceLock::new();
    PARAMETERS.get_or_init(|| {
        let file: ParameterFile = serde_json::from_str(include_str!(
            "../../../parameters/poseidon2-bn254-t4-v1.json"
        ))
        .expect("pinned Poseidon2 parameters must parse");
        assert_eq!(file.width, WIDTH);
        assert_eq!(file.rate, RATE);
        assert_eq!(file.full_rounds, FULL_ROUNDS_PER_SIDE * 2);
        assert_eq!(file.partial_rounds, PARTIAL_ROUNDS);
        let diagonal: [Fr; WIDTH] = file
            .m_diag
            .iter()
            .map(|value| parse_field(value))
            .collect::<Vec<_>>()
            .try_into()
            .expect("Poseidon2 diagonal must have four entries");
        let round_constants = file
            .rc
            .iter()
            .map(|value| parse_field(value))
            .collect::<Vec<_>>();
        assert_eq!(
            round_constants.len(),
            (FULL_ROUNDS_PER_SIDE * 2 + PARTIAL_ROUNDS) * WIDTH
        );
        Parameters {
            diagonal,
            round_constants,
        }
    })
}

fn sbox5(value: Fr) -> Fr {
    value.square().square() * value
}

fn external_matrix(state: [Fr; WIDTH]) -> [Fr; WIDTH] {
    let t0 = state[0] + state[1];
    let t1 = state[2] + state[3];
    let t2 = state[1].double() + t1;
    let t3 = state[3].double() + t0;
    let t4 = t1.double().double() + t3;
    let t5 = t0.double().double() + t2;
    [t3 + t5, t5, t2 + t4, t4]
}

fn internal_matrix(state: [Fr; WIDTH], diagonal: &[Fr; WIDTH]) -> [Fr; WIDTH] {
    let sum = state.iter().copied().sum::<Fr>();
    std::array::from_fn(|index| state[index] * diagonal[index] + sum)
}

fn permutation(input: [Fr; WIDTH]) -> [Fr; WIDTH] {
    let params = parameters();
    let mut state = external_matrix(input);

    for round in 0..FULL_ROUNDS_PER_SIDE {
        state = external_matrix(std::array::from_fn(|index| {
            sbox5(state[index] + params.round_constants[round * WIDTH + index])
        }));
    }

    for partial in 0..PARTIAL_ROUNDS {
        let round = FULL_ROUNDS_PER_SIDE + partial;
        state[0] = sbox5(state[0] + params.round_constants[round * WIDTH]);
        state = internal_matrix(state, &params.diagonal);
    }

    for final_round in 0..FULL_ROUNDS_PER_SIDE {
        let round = FULL_ROUNDS_PER_SIDE + PARTIAL_ROUNDS + final_round;
        state = external_matrix(std::array::from_fn(|index| {
            sbox5(state[index] + params.round_constants[round * WIDTH + index])
        }));
    }
    state
}

fn field_to_bytes(value: Fr) -> [u8; 32] {
    let encoded = value.into_bigint().to_bytes_be();
    let mut output = [0u8; 32];
    output[32 - encoded.len()..].copy_from_slice(&encoded);
    output
}

fn poseidon2_hash(inputs: &[[u8; 32]]) -> [u8; 32] {
    let field_inputs = inputs
        .iter()
        .map(|input| {
            assert!(is_canonical_field(input), "input exceeds field modulus");
            Fr::from_be_bytes_mod_order(input)
        })
        .collect::<Vec<_>>();
    let mut length_iv = [0u8; 32];
    length_iv[16..24].copy_from_slice(&(inputs.len() as u64).to_be_bytes());
    let mut state = [
        Fr::ZERO,
        Fr::ZERO,
        Fr::ZERO,
        Fr::from_be_bytes_mod_order(&length_iv),
    ];
    let block_count = inputs.len().div_ceil(RATE).max(1);
    for block in 0..block_count {
        for (rate_index, rate_value) in state.iter_mut().enumerate().take(RATE) {
            if let Some(input) = field_inputs.get(block * RATE + rate_index) {
                *rate_value += input;
            }
        }
        state = permutation(state);
    }
    field_to_bytes(state[0])
}

pub fn native_p2(domain: &str, fields: &[[u8; 32]]) -> [u8; 32] {
    assert!(
        !domain.is_empty() && domain.bytes().all(|byte| (0x20..=0x7e).contains(&byte)),
        "Poseidon2 domain must be nonempty ASCII"
    );
    let domain_field = bytes_to_field(&Sha256::digest(domain.as_bytes()));
    let mut inputs = Vec::with_capacity(fields.len() + 1);
    inputs.push(domain_field);
    inputs.extend_from_slice(fields);
    poseidon2_hash(&inputs)
}

pub struct NativeTreeHashContext {
    empty_roots: [[u8; 32]; TREE_DEPTH + 1],
}

impl NativeTreeHashContext {
    pub fn new() -> Self {
        let mut empty_roots = [[0u8; 32]; TREE_DEPTH + 1];
        for depth in 0..TREE_DEPTH {
            empty_roots[depth + 1] = native_p2(
                DOMAIN_MERKLE_NODE,
                &[empty_roots[depth], empty_roots[depth]],
            );
        }
        Self { empty_roots }
    }

    pub fn empty_tree(&self) -> TreeState {
        TreeState {
            root: self.empty_roots[TREE_DEPTH],
            next_leaf_index: 0,
            frontier: [[0u8; 32]; TREE_DEPTH],
        }
    }

    pub fn append_two_commitments(
        &self,
        tree: &mut TreeState,
        cm0: &[u8; 32],
        cm1: &[u8; 32],
    ) -> Result<[u8; 32], TreeError> {
        if tree.next_leaf_index > (1u64 << TREE_DEPTH) - 2 {
            return Err(TreeError::TreeFull);
        }
        debug_assert_eq!(tree.next_leaf_index & 1, 0);
        tree.frontier[0] = *cm0;
        let mut current = native_p2(DOMAIN_MERKLE_NODE, &[*cm0, *cm1]);
        let mut index = tree.next_leaf_index >> 1;
        for (level, empty_root) in self.empty_roots.iter().enumerate().take(TREE_DEPTH).skip(1) {
            if index & 1 == 0 {
                tree.frontier[level] = current;
                current = native_p2(DOMAIN_MERKLE_NODE, &[current, *empty_root]);
            } else {
                current = native_p2(DOMAIN_MERKLE_NODE, &[tree.frontier[level], current]);
            }
            index >>= 1;
        }
        tree.next_leaf_index += 2;
        tree.root = current;
        Ok(current)
    }
}

impl Default for NativeTreeHashContext {
    fn default() -> Self {
        Self::new()
    }
}
