use private_balance_protocol::{constants::{TREE_ARITY, TREE_DEPTH}, tree::*};

#[test]
fn test_tree_empty_and_append() {
    assert_eq!(TREE_ARITY, 3);
    assert_eq!(TREE_DEPTH, 17);
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
fn ternary_empty_roots_are_compile_time_constants() {
    assert_eq!(compute_empty_roots(), EMPTY_ROOTS);
    for level in 0..TREE_DEPTH {
        assert_eq!(
            hash_merkle_node(&[EMPTY_ROOTS[level]; TREE_ARITY]),
            EMPTY_ROOTS[level + 1],
        );
    }
}
