use crate::constants::{TREE_ARITY, TREE_CAPACITY, TREE_DEPTH, TREE_FRONTIER_WIDTH};
use crate::poseidon2::poseidon2_hash;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeState {
    pub root: [u8; 32],
    pub next_leaf_index: u128,
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
    [
        0x00000000000000000000000000000000,
        0x00000000000000000000000000000000,
    ],
    [
        0x2a5de47ed300af27b706aaa14762fc46,
        0x8f5cfc16cd8116eb6b09b0f2643ca2b9,
    ],
    [
        0x1070e389d2a8c6c59df016833644d786,
        0xbc20cd3c02702f8842318abdbc24f2be,
    ],
    [
        0x0219c4d94d0a6bbedaca37389b257a9d,
        0x77b79eb808c6c96aad26b3fedf18623f,
    ],
    [
        0x1c542f962c10039f740a8df044f0f7a2,
        0x4a5e34ddfdb4aceac279219ec138994a,
    ],
    [
        0x041427ef9d920eea17d39cd01efa15f8,
        0x7b5d86bc43d2681fa6e37498625106ab,
    ],
    [
        0x0ac86b0ef82942a569557943ec260012,
        0x6932f3b1d171bb2a2cd54eeae3401868,
    ],
    [
        0x24a59b2c70ffdd9b05059919fc6d281a,
        0x6d9427cd239ade15d9ed1469711d10f0,
    ],
    [
        0x147afd0d2c07f85eaa70d3d673a1db77,
        0x003ee4ab5d0bd821ad0ea66801bda534,
    ],
    [
        0x2efdede6144d26513da58fab51b1e275,
        0x6cbcc5ed29f9f56c231e43c0c451170b,
    ],
    [
        0x27a77c9a37fa7fc9e205bf22ef812319,
        0x9a834ebf1e0f756de5bb587a8ae2280e,
    ],
    [
        0x02550c437ec27e059f2e0f8a6f3ef0b1,
        0x9f76b2aaf418c6258e00c6a6013bcc03,
    ],
    [
        0x2e512ab7918b5c42e16201af79869aad,
        0x6231f2ff0d7988d362bf8c9e71d3ee4d,
    ],
    [
        0x23246d93d74982acb736c0208daf955e,
        0x4c3cba5aec87506e76efe2fb6c598da4,
    ],
    [
        0x1e01f044649095495c9a65a993d8797d,
        0x3d684a047875a15498dfcbc14e12e0c7,
    ],
    [
        0x16b3a2ff965b9474bf814cc1a3a55859,
        0xcbbc83d94ce5628632461871c6447a16,
    ],
    [
        0x1bdaee57fd2490bdbcd7328fe96f98dc,
        0xd62dab5d2818e47d12d8327cc59d4215,
    ],
    [
        0x23b3e23c0bc898db86d462d5e7a3c7e7,
        0xa3f1f4f9409dfc3744feb2fb4cae15a5,
    ],
    [
        0x0fbab90226f7d74293653c4b391c3f0b,
        0x05ea7de7a0ab705187b5684e7a4e7360,
    ],
    [
        0x2c1ef457f50de669d0f5cdb2df763a91,
        0x4d545f1e840e6fb927923564fd7d5706,
    ],
    [
        0x1469b5586ace72e4c51bb7f05fa6b10e,
        0xa8f9a525c96e36458f159b4794ac7c35,
    ],
    [
        0x301938ee9324c6d0ffcb658fdd9258c9,
        0xb3b0e7e68f9412e4182161a317b5baaa,
    ],
    [
        0x0d68b5b4e8b531a6f5ad342e0f11bd42,
        0x525dc6c265072eee22e239875117d443,
    ],
    [
        0x00c3222bf7dc82141f65a1e6d0362823,
        0x8e268e1d8c51edc5d844f169c25e17f4,
    ],
    [
        0x0bb9c7421a3701d4bee94bcd238b3f28,
        0xbc21f258a3f314cfdcd92ce70e13c9f2,
    ],
    [
        0x1dcc4363be3bc5ee79d8b75711b0de7c,
        0x95ad80c5d9d42f9ca7b102818c374577,
    ],
    [
        0x18bfbee711f72eb823d4f5c713124ab2,
        0xc65aa75cbfc03cc296d353b9046a5265,
    ],
    [
        0x0f1bb2627068b413a1ff607e926b79da,
        0x818024163fd3a106fbe1eea991cb5605,
    ],
    [
        0x06a86b14d6504bbae040952899e939ed,
        0x167adcc9e6d5d3f29aba6ba735434d83,
    ],
    [
        0x0eeb69dc4e64bdd7357441ada53bba61,
        0x5db22a5e5f6c38f80d9671c18411b9bc,
    ],
    [
        0x2c13a15877fdbbba5da345a1968e2bb4,
        0x789ecd562344291799fb0e28b5886411,
    ],
    [
        0x112ded08aaf309fcb8029432ecb60e5d,
        0x9667195786094368f6342f31e2fb98e2,
    ],
    [
        0x2506aa865236788b903bec5dc8d07649,
        0xbb2a50e675f375cc84cbaa5af2a13b09,
    ],
    [
        0x1213761ff3f86bc202edd697d61a4b5b,
        0x888aee5b85155c6efb73cce81b7872e7,
    ],
    [
        0x0388dde9a6288ff4d775d54dc4c46ec0,
        0xdcec1280426520cc516884eec97f3f9d,
    ],
    [
        0x28f9767aaab3e050702f04620d470369,
        0x4c1e3a945af37e10b9dc20b23b153535,
    ],
    [
        0x1b716bb4f7c7efaa1210f9e2d899e47a,
        0x45dfdb9df61d112c155e8a7b0df478c1,
    ],
    [
        0x228f271a2f5291accc4673fb47f4930a,
        0xbe123c4ecf83dc40ded50b672da840a9,
    ],
    [
        0x07bd3caca6983523f03e565072b864da,
        0xdf8ab4d2c15e7640d860486cda5f96e4,
    ],
    [
        0x032092ca4228b611feb11f754778389c,
        0xa049fb3e6b95c5186716e4d12af4202f,
    ],
    [
        0x0d438d8b23d2a0a7d719552aea4afa0d,
        0xee6a858b87e21e7d3a4c357319ce0a90,
    ],
    [
        0x23017d765398b66c6879cb0a670e4dfa,
        0xf476349a219153a43c0eeb03a9df62e1,
    ],
    [
        0x28366a76bbd917530c78463010cca9af,
        0x73afb3df7c4bbf98046bc0c547af6af8,
    ],
    [
        0x25dd9433d36a34d4caf46a541e34cdb2,
        0x13f9412aa9c075c53b786c532106dcf3,
    ],
    [
        0x2db208980e7e7dffc6d9f099f4058d41,
        0x1d509f5f7a3b66eb5c4b617d31e770c6,
    ],
    [
        0x0d52a4d76be2edc96e893745fe3518c9,
        0xeab8405da593bc3db521dadd4ca11591,
    ],
    [
        0x0e3f0659258613520f2a7370b3c7dd6f,
        0x338998b2e4fde4c8ac5b7a55a2a9c0fb,
    ],
    [
        0x2399d7478eef4fd19b4e94b5a713f006,
        0xe340512beec0a0dcf1d4cb1e66e50961,
    ],
    [
        0x1d263cb0b11860e5f96cb2dd4e0fd9cf,
        0xf3b287783a516cf3fa90a76c54a2b01e,
    ],
    [
        0x23c9da1f22b05ad67e160afa80f299b0,
        0x633a9db06b51b8b0fcb2dcaa92b1103b,
    ],
    [
        0x07e59570543797da4724a956417a0a4d,
        0x84d3ed5d6ff4758831a07c5b54fc491e,
    ],
    [
        0x0363c38bf454400ebeaeafcd38e490b8,
        0x74573246e8471be767249b8b40795109,
    ],
    [
        0x1d164e5658573774d1a997e4c22a425c,
        0x3cbee908fad01b36080a9ae5e9c2c50d,
    ],
    [
        0x06b1b95b31b3f1d59e0845f1dfc62e92,
        0x7797ffc41233471191f74e735224a63e,
    ],
    [
        0x0e5bb4750733ca89e93b898541c1a532,
        0xe8a36f607cda14becf4a422ee749f6a7,
    ],
    [
        0x06f2a1d723239d3ecd0c407baaa2184e,
        0xce04e85821ec80568570bc3c6174892a,
    ],
    [
        0x293aa0e1600022f00ecc178e5c8c0bd0,
        0xa371b88b98690f320ba7cb732f03c84e,
    ],
    [
        0x1bb312be1bcf5af8be7c8c970c13dffe,
        0xb2bb57755e3ea035e895b511aca2961e,
    ],
    [
        0x235ceff4ee0ea50d0c11f7d8a1ff137d,
        0x3ecf51ddea722ecf82ddde2a61a3e72c,
    ],
    [
        0x2d971a97feaf712193ec467a251713e6,
        0xa66cd643270dfc41af27c260ee05ca5a,
    ],
    [
        0x067a6febfdb56a3c13abb1523695bd52,
        0x2ab047485bf5a1f8d461580a4cd38bf3,
    ],
    [
        0x23c04426a20b2d85cfe7958ee524484f,
        0x3ec88cdd4848e54412482c48a431c718,
    ],
    [
        0x2d373bf14259527dcc4b51e0bc265c25,
        0x8dca13227146f25dc6c32987db141b84,
    ],
    [
        0x1572cf7d43d3a0a459f14902eb73d846,
        0x6c38ede1ef92dce71bbec760b2444ff0,
    ],
    [
        0x0a88b1683de196e31692d1b5870ddd60,
        0xb7e41eac248a35f398f8ae841f3b261d,
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

pub fn hash_merkle_node(children: &[[u8; 32]; TREE_ARITY]) -> [u8; 32] {
    poseidon2_hash(children)
}

pub const fn compute_empty_roots() -> [[u8; 32]; TREE_DEPTH + 1] {
    EMPTY_ROOTS
}

pub fn compute_root_from_path(
    leaf: &[u8; 32],
    leaf_index: u128,
    siblings: &[[[u8; 32]; TREE_FRONTIER_WIDTH]; TREE_DEPTH],
) -> [u8; 32] {
    let mut current = *leaf;
    let mut index = leaf_index;
    for level_siblings in siblings {
        let position = (index % TREE_ARITY as u128) as usize;
        let children = match position {
            0 => [current, level_siblings[0], level_siblings[1]],
            1 => [level_siblings[0], current, level_siblings[1]],
            2 => [level_siblings[0], level_siblings[1], current],
            _ => unreachable!(),
        };
        current = hash_merkle_node(&children);
        index /= TREE_ARITY as u128;
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
            match index % TREE_ARITY as u128 {
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
                    index /= TREE_ARITY as u128;
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
            current = match index % TREE_ARITY as u128 {
                0 => hash_merkle_node(&[current, EMPTY_ROOTS[level], EMPTY_ROOTS[level]]),
                1 => hash_merkle_node(&[self.frontier[level][0], current, EMPTY_ROOTS[level]]),
                2 => hash_merkle_node(&[self.frontier[level][0], self.frontier[level][1], current]),
                _ => unreachable!(),
            };
            index /= TREE_ARITY as u128;
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

    pub fn append_three_commitments(
        &mut self,
        commitments: &[[u8; 32]; 3],
    ) -> Result<[u8; 32], TreeError> {
        if self.next_leaf_index > TREE_CAPACITY - 3 {
            return Err(TreeError::TreeFull);
        }
        for commitment in commitments {
            self.append_frontier(commitment)?;
        }
        Ok(self.refresh_root())
    }
}

impl Default for TreeState {
    fn default() -> Self {
        Self::new()
    }
}
