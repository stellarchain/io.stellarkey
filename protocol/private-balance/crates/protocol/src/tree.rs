use crate::constants::{DOMAIN_MERKLE_NODE, TREE_DEPTH};
use crate::poseidon2::p2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeState {
    pub root: [u8; 32],
    pub next_leaf_index: u64,
    pub frontier: [[u8; 32]; TREE_DEPTH],
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
    [
        0x00000000000000000000000000000000,
        0x00000000000000000000000000000000,
    ],
    [
        0x0f7c2789476dc071529b9e3b40c2ec7a,
        0x80d6e713e9589457abc7b25191b67b29,
    ],
    [
        0x0d43ebf9e470ed8a96f853e933a0f478,
        0x8114fb3ccc2e82a03305e89f25825d80,
    ],
    [
        0x24bc9221ecc1487fca1d18ef95fec226,
        0xaad4c9d5e8da83e8cdd539950cf27d05,
    ],
    [
        0x0c12d256cb26917631491388432ee0db,
        0x2b8dd5ed37e4ce9403506bcaee3ef157,
    ],
    [
        0x0357f785c10179e3117163d89cc48331,
        0x6f41c8fc644708a6645e1f00fd1facbd,
    ],
    [
        0x2706d06eb5f7abeaf81abaf30655c10b,
        0x1440cb8dd9e57cf5923f6792bebfc01e,
    ],
    [
        0x1c7d88c18f76ebc6352d1a5e6fac337a,
        0x9d93c9eb44bef2075d81a3661410b88d,
    ],
    [
        0x0a7489501fbf8f1d7867ec2095d44378,
        0x1279a038332a9b73c42202e483554ed6,
    ],
    [
        0x0e4646e28c25e7d0714a896be3b5acaf,
        0x6c9904a847ae8ef52c890e8fef9dbc9c,
    ],
    [
        0x04d25dff536b2ccb34ecd8bc0bb2b52a,
        0xaed25f2d6f97b09977d3b9c8bbb5d291,
    ],
    [
        0x0f671dfa78647b718b165884aaea767b,
        0x768a022fb92aed7c499d8a810ab57165,
    ],
    [
        0x1b7981da3b6295881a39edcdeb3818eb,
        0x8a81a3648b2f770d3d2d01ffb3b41ef2,
    ],
    [
        0x20152fa61dba4d8e5fb0905d2eaac530,
        0x31a6660dd36061ab0bd5c481ca00f503,
    ],
    [
        0x2dac8eb58b489bd74c29903b587577a4,
        0x80bf4f14a17d1930f4826a2c120d2fa7,
    ],
    [
        0x1b2e05e523ce6f2ca56454a2009da308,
        0x9c1a203b469b6b9099026277c5443698,
    ],
    [
        0x1ce1c933da4f4292af1d720984f1e338,
        0xa4543896050721705009d0d1472d5cb4,
    ],
    [
        0x2aedbd2263c29d05fe25fab45e0e302a,
        0x278edf9f3277d6b46c66c482abb90a08,
    ],
    [
        0x2852eb6024eb6d5b1b6b5d6936071fbe,
        0x737576dc1d357b25e2f7b328c386f0cd,
    ],
    [
        0x00e15bc0b2b424ea06eba41ab1a54d1a,
        0xa1daa901fa060b88b085910d70db2714,
    ],
    [
        0x04e44ef91546201b5773e875afe66399,
        0x8100a33d0f53d696849f995b4eed05e7,
    ],
    [
        0x1c77e58c802f130c845557decc519dbb,
        0xda2c34a20df7cf28ede07be9ab742066,
    ],
    [
        0x2d74985d79db03f7ba598806a3f9fe4e,
        0xae3a3bb7e292ddfc52112d351983d590,
    ],
    [
        0x226bf0a63692ab678e01ca37df94e03e,
        0x9a652bdc932daa2de6e81896045b3375,
    ],
    [
        0x1d981537f02514ae15cb7ed1718653e5,
        0xed2b03b11b36ba9a3fc712e71bffdd6d,
    ],
    [
        0x2cc19110b437ead061a0ebf0340e79cc,
        0xeb397b4deed01bc109f8f1b8502ad098,
    ],
    [
        0x14ab202bdc00e9241e1c9926c5c5492c,
        0x8eb6e776a4be09639cc66acbe24382e4,
    ],
    [
        0x19859c8232ddf1c519cc4aadf011c89e,
        0xfd90ca30b40b8a96fa557d4142299ab8,
    ],
    [
        0x28c184e7fbb8b63c6d88ac9f3ec43161,
        0xe8b4ba171a8205ffadec8236971f71ea,
    ],
    [
        0x2fde26459b3f7e57e665c5f3a71a80c7,
        0x488d2458403818ad939a89100eb118b7,
    ],
    [
        0x0084be1c34626938ca37c98f70d466b2,
        0x7c114132624f767b0979e4a4ee80fd77,
    ],
    [
        0x0268d5cc1e50f7ca209a3bdfa176e47e,
        0xf2a0d0b4f0cb11b03ba6df0bf6a8d3b0,
    ],
    [
        0x047585958785546e518e72d1bbfb7c57,
        0x3205c35c332e0b876f60218918401a59,
    ],
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

pub fn hash_merkle_parent(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    p2(DOMAIN_MERKLE_NODE, &[*left, *right])
}

pub const fn compute_empty_roots() -> [[u8; 32]; TREE_DEPTH + 1] {
    EMPTY_ROOTS
}

pub fn compute_root_from_path(
    leaf: &[u8; 32],
    leaf_index: u32,
    siblings: &[[u8; 32]; TREE_DEPTH],
) -> [u8; 32] {
    let mut current = *leaf;
    let mut index = leaf_index;
    for sibling in siblings {
        current = if index & 1 == 0 {
            hash_merkle_parent(&current, sibling)
        } else {
            hash_merkle_parent(sibling, &current)
        };
        index >>= 1;
    }
    current
}

impl TreeState {
    pub fn new() -> Self {
        let mut frontier = [[0u8; 32]; TREE_DEPTH];
        frontier.copy_from_slice(&EMPTY_ROOTS[..TREE_DEPTH]);
        Self {
            root: EMPTY_ROOTS[TREE_DEPTH],
            next_leaf_index: 0,
            frontier,
        }
    }

    pub fn append_frontier(&mut self, leaf: &[u8; 32]) -> Result<(), TreeError> {
        if self.next_leaf_index >= (1u64 << TREE_DEPTH) {
            return Err(TreeError::TreeFull);
        }
        let mut current = *leaf;
        let mut index = self.next_leaf_index;
        let mut level = 0;
        while index & 1 == 1 {
            current = hash_merkle_parent(&self.frontier[level], &current);
            index >>= 1;
            level += 1;
        }
        if level < TREE_DEPTH {
            self.frontier[level] = current;
        } else {
            self.root = current;
        }
        self.next_leaf_index += 1;
        Ok(())
    }

    pub fn refresh_root(&mut self) -> [u8; 32] {
        if self.next_leaf_index == (1u64 << TREE_DEPTH) {
            return self.root;
        }
        let mut current = EMPTY_ROOTS[0];
        let mut index = self.next_leaf_index;
        for (level, empty_root) in EMPTY_ROOTS.iter().enumerate().take(TREE_DEPTH) {
            current = if index & 1 == 1 {
                hash_merkle_parent(&self.frontier[level], &current)
            } else {
                hash_merkle_parent(&current, empty_root)
            };
            index >>= 1;
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
        if self.next_leaf_index > (1u64 << TREE_DEPTH) - 2 {
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
