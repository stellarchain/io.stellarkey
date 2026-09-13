use private_balance_protocol::{
    constants::{TREE_CAPACITY, TREE_DEPTH},
    note::compute_nullifier,
    tree::{compute_root_from_path, hash_merkle_node, TreeState, EMPTY_ROOTS},
};

#[test]
fn hierarchy_has_no_u64_position_cliff() {
    assert_eq!(TREE_DEPTH, 64);
    assert_eq!(TREE_CAPACITY, 3u128.pow(64));
    let mut tree = TreeState::new();
    tree.next_leaf_index = 3u128.pow(41);
    let leaf = [1; 32];
    let siblings = core::array::from_fn(|level| [EMPTY_ROOTS[level]; 2]);
    let expected = compute_root_from_path(&leaf, tree.next_leaf_index, &siblings);
    tree.append_leaf(&leaf).unwrap();
    assert_eq!(tree.root, expected);
}

#[test]
fn final_leaf_carries_to_root_and_refuses_another_append() {
    let mut tree = TreeState::new();
    tree.next_leaf_index = TREE_CAPACITY - 1;
    let leaf = [1; 32];
    let mut expected = leaf;
    for empty in EMPTY_ROOTS.iter().take(TREE_DEPTH) {
        expected = hash_merkle_node(&[*empty, *empty, expected]);
    }
    assert_eq!(tree.append_leaf(&leaf).unwrap(), expected);
    let full = tree.clone();
    assert!(tree.append_leaf(&leaf).is_err());
    assert_eq!(tree, full);
}

#[test]
fn nullifier_commits_to_all_global_position_bits() {
    let base = compute_nullifier(&[1; 32], &[2; 32], &[3; 32], 7, &[4; 32]);
    for bit in [32, 53, 64, 100] {
        let other = compute_nullifier(&[1; 32], &[2; 32], &[3; 32], 7 + (1u128 << bit), &[4; 32]);
        assert_ne!(base, other);
    }
}
