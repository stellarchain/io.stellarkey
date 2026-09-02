use crate::constants::{TREE_ARITY, TREE_CAPACITY, TREE_DEPTH, TREE_FRONTIER_WIDTH};
use crate::poseidon2::poseidon2_hash;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeState {
    pub root: [u8; 32],
    pub next_leaf_index: u64,
    pub frontier: [[[u8; 32]; TREE_FRONTIER_WIDTH]; TREE_DEPTH],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeError {
    TreeFull,
    InvalidPath,
}

const fn root_bytes(words: [u128; 2]) -> [u8; 32] {
    let high = words[0].to_be_bytes();
    let low = words[1].to_be_bytes();
    let mut out = [0u8; 32];
    let mut index = 0;
    while index < 16 {
        out[index] = high[index];
        out[index + 16] = low[index];
        index += 1;
    }
    out
}

const EMPTY_ROOT_WORDS: [[u128; 2]; TREE_DEPTH + 1] = [
    [0x00000000000000000000000000000000, 0x00000000000000000000000000000000],
    [0x2a5de47ed300af27b706aaa14762fc46, 0x8f5cfc16cd8116eb6b09b0f2643ca2b9],
    [0x1070e389d2a8c6c59df016833644d786, 0xbc20cd3c02702f8842318abdbc24f2be],
    [0x0219c4d94d0a6bbedaca37389b257a9d, 0x77b79eb808c6c96aad26b3fedf18623f],
    [0x1c542f962c10039f740a8df044f0f7a2, 0x4a5e34ddfdb4aceac279219ec138994a],
    [0x041427ef9d920eea17d39cd01efa15f8, 0x7b5d86bc43d2681fa6e37498625106ab],
    [0x0ac86b0ef82942a569557943ec260012, 0x6932f3b1d171bb2a2cd54eeae3401868],
    [0x24a59b2c70ffdd9b05059919fc6d281a, 0x6d9427cd239ade15d9ed1469711d10f0],
    [0x147afd0d2c07f85eaa70d3d673a1db77, 0x003ee4ab5d0bd821ad0ea66801bda534],
    [0x2efdede6144d26513da58fab51b1e275, 0x6cbcc5ed29f9f56c231e43c0c451170b],
    [0x27a77c9a37fa7fc9e205bf22ef812319, 0x9a834ebf1e0f756de5bb587a8ae2280e],
    [0x02550c437ec27e059f2e0f8a6f3ef0b1, 0x9f76b2aaf418c6258e00c6a6013bcc03],
    [0x2e512ab7918b5c42e16201af79869aad, 0x6231f2ff0d7988d362bf8c9e71d3ee4d],
    [0x23246d93d74982acb736c0208daf955e, 0x4c3cba5aec87506e76efe2fb6c598da4],
    [0x1e01f044649095495c9a65a993d8797d, 0x3d684a047875a15498dfcbc14e12e0c7],
    [0x16b3a2ff965b9474bf814cc1a3a55859, 0xcbbc83d94ce5628632461871c6447a16],
    [0x1bdaee57fd2490bdbcd7328fe96f98dc, 0xd62dab5d2818e47d12d8327cc59d4215],
    [0x23b3e23c0bc898db86d462d5e7a3c7e7, 0xa3f1f4f9409dfc3744feb2fb4cae15a5],
];

const fn empty_roots() -> [[u8; 32]; TREE_DEPTH + 1] {
    let mut roots = [[0u8; 32]; TREE_DEPTH + 1];
    let mut index = 0;
    while index <= TREE_DEPTH {
        roots[index] = root_bytes(EMPTY_ROOT_WORDS[index]);
        index += 1;
    }
    roots
}

pub const EMPTY_ROOTS: [[u8; 32]; TREE_DEPTH + 1] = empty_roots();

pub fn hash_merkle_node(children: &[[u8; 32]; TREE_ARITY]) -> [u8; 32] {
    poseidon2_hash(children)
}

pub const fn compute_empty_roots() -> [[u8; 32]; TREE_DEPTH + 1] {
    EMPTY_ROOTS
}

pub fn compute_root_from_path(
    leaf: &[u8; 32],
    leaf_index: u32,
    siblings: &[[[u8; 32]; TREE_FRONTIER_WIDTH]; TREE_DEPTH],
) -> [u8; 32] {
    let mut current = *leaf;
    let mut index = u64::from(leaf_index);
    for level_siblings in siblings {
        let position = (index % TREE_ARITY as u64) as usize;
        let children = match position {
            0 => [current, level_siblings[0], level_siblings[1]],
            1 => [level_siblings[0], current, level_siblings[1]],
            2 => [level_siblings[0], level_siblings[1], current],
            _ => unreachable!(),
        };
        current = hash_merkle_node(&children);
        index /= TREE_ARITY as u64;
    }
    current
}

impl TreeState {
    pub fn new() -> Self {
        let frontier = core::array::from_fn(|level| [EMPTY_ROOTS[level]; TREE_FRONTIER_WIDTH]);
        Self {
            root: EMPTY_ROOTS[TREE_DEPTH],
            next_leaf_index: 0,
            frontier,
        }
    }

    pub fn append_frontier(&mut self, leaf: &[u8; 32]) -> Result<(), TreeError> {
        if self.next_leaf_index >= TREE_CAPACITY {
            return Err(TreeError::TreeFull);
        }
        let mut current = *leaf;
        let mut index = self.next_leaf_index;
        let mut level = 0;
        loop {
            match index % TREE_ARITY as u64 {
                0 => {
                    self.frontier[level][0] = current;
                    break;
                }
                1 => {
                    self.frontier[level][1] = current;
                    break;
                }
                2 => {
                    current = hash_merkle_node(&[
                        self.frontier[level][0],
                        self.frontier[level][1],
                        current,
                    ]);
                    index /= TREE_ARITY as u64;
                    level += 1;
                    if level == TREE_DEPTH {
                        self.root = current;
                        break;
                    }
                }
                _ => unreachable!(),
            }
        }
        self.next_leaf_index += 1;
        Ok(())
    }

    pub fn refresh_root(&mut self) -> [u8; 32] {
        if self.next_leaf_index == TREE_CAPACITY {
            return self.root;
        }
        let mut current = EMPTY_ROOTS[0];
        let mut index = self.next_leaf_index;
        for level in 0..TREE_DEPTH {
            current = match index % TREE_ARITY as u64 {
                0 => hash_merkle_node(&[current, EMPTY_ROOTS[level], EMPTY_ROOTS[level]]),
                1 => hash_merkle_node(&[
                    self.frontier[level][0],
                    current,
                    EMPTY_ROOTS[level],
                ]),
                2 => hash_merkle_node(&[
                    self.frontier[level][0],
                    self.frontier[level][1],
                    current,
                ]),
                _ => unreachable!(),
            };
            index /= TREE_ARITY as u64;
        }
        self.root = current;
        current
    }

    pub fn append_leaf(&mut self, leaf: &[u8; 32]) -> Result<[u8; 32], TreeError> {
        self.append_frontier(leaf)?;
        Ok(self.refresh_root())
    }

    pub fn append_two_commitments(
        &mut self,
        cm0: &[u8; 32],
        cm1: &[u8; 32],
    ) -> Result<[u8; 32], TreeError> {
        if self.next_leaf_index > TREE_CAPACITY - 2 {
            return Err(TreeError::TreeFull);
        }
        self.append_frontier(cm0)?;
        self.append_frontier(cm1)?;
        Ok(self.refresh_root())
    }
}

impl Default for TreeState {
    fn default() -> Self {
        Self::new()
    }
}
