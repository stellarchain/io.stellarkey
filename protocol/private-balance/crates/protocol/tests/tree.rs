use private_balance_protocol::{constants::DOMAIN_MERKLE_NODE, poseidon2::domain_field, tree::*};

#[test]
fn test_tree_empty_and_append() {
    let mut tree = TreeState::new();
    let empty_root = tree.root;
    assert_ne!(empty_root, [0u8; 32]);
    assert_eq!(tree.next_leaf_index, 0);

    let mut leaf0 = [0u8; 32];
    leaf0[31] = 1;
    let mut leaf1 = [0u8; 32];
    leaf1[31] = 2;

    let new_root = tree.append_two_commitments(&leaf0, &leaf1).unwrap();
    assert_ne!(new_root, empty_root);
    assert_eq!(tree.next_leaf_index, 2);
}

#[test]
fn frontier_append_matches_legacy_roots_and_defers_the_final_fold() {
    let mut optimized = TreeState::new();
    let mut legacy = TreeState::new();

    for value in 1u16..=300 {
        let mut leaf = [0u8; 32];
        leaf[30..].copy_from_slice(&value.to_be_bytes());
        optimized.append_frontier(&leaf).unwrap();
        legacy.append_leaf(&leaf).unwrap();
    }

    assert_eq!(optimized.next_leaf_index, 300);
    assert_ne!(
        optimized.root, legacy.root,
        "frontier append must defer root computation"
    );
    assert_eq!(optimized.refresh_root(), legacy.root);
    assert_eq!(optimized.root, legacy.root);
}

#[test]
fn empty_roots_and_merkle_domain_are_compile_time_constants() {
    assert_eq!(compute_empty_roots(), EMPTY_ROOTS);
    assert_eq!(
        domain_field(DOMAIN_MERKLE_NODE),
        [
            0x28, 0x5f, 0xf6, 0x78, 0x05, 0x15, 0x87, 0xf5, 0x8b, 0x40, 0x61, 0xd5, 0xca, 0xe6,
            0x41, 0x8f, 0x89, 0xd9, 0xe2, 0xdc, 0xfe, 0xda, 0x99, 0xa8, 0xf3, 0xaa, 0xf4, 0xfa,
            0xa5, 0x37, 0x0e, 0x28,
        ],
    );
}
