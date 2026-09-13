use private_balance_protocol::deployment::DeploymentBinding;

fn binding() -> DeploymentBinding {
    DeploymentBinding {
        protocol_version: 1,
        network_id: [1; 32],
        realm_id: [2; 32],
        pool_id: [3; 32],
        asset_admin: (0, [4; 32]),
        guardian: (0, [5; 32]),
        poseidon2_parameter_hash: [6; 32],
        circuit_hash: [7; 32],
        verification_key_hash: [8; 32],
        tree_depth: 32,
        root_window_ledgers: 1_440,
        private_address_payload_bytes: 68,
        private_address_ascii_bytes: 170,
        address_context_tag_bytes: 0,
        address_checksum_bytes: 6,
        hpke_kem_id: 0x0020,
        hpke_kdf_id: 0x0001,
        hpke_aead_id: 0x0001,
    }
}

#[test]
fn deployment_binding_is_deterministic_and_binds_every_field() {
    let expected = binding().hash().expect("valid binding");
    assert_eq!(
        hex::encode(expected),
        "cfa6a37d5a58463e8749d7603ee6c554ce7d0d9793d2c8d79f348524f6aa4b77"
    );
    assert_ne!(expected, [0; 32]);

    let mut mutations = std::vec::Vec::new();
    let mut value = binding();
    value.protocol_version = 2;
    mutations.push(value);
    let mut value = binding();
    value.network_id[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.realm_id[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.pool_id[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.asset_admin.1[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.guardian.1[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.poseidon2_parameter_hash[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.circuit_hash[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.verification_key_hash[0] ^= 1;
    mutations.push(value);
    let mut value = binding();
    value.tree_depth += 1;
    mutations.push(value);
    let mut value = binding();
    value.root_window_ledgers += 1;
    mutations.push(value);
    let mut value = binding();
    value.private_address_payload_bytes += 1;
    mutations.push(value);
    let mut value = binding();
    value.private_address_ascii_bytes += 1;
    mutations.push(value);
    let mut value = binding();
    value.address_context_tag_bytes += 1;
    mutations.push(value);
    let mut value = binding();
    value.address_checksum_bytes += 1;
    mutations.push(value);
    let mut value = binding();
    value.hpke_kem_id += 1;
    mutations.push(value);
    let mut value = binding();
    value.hpke_kdf_id += 1;
    mutations.push(value);
    let mut value = binding();
    value.hpke_aead_id += 1;
    mutations.push(value);

    for mutation in mutations {
        assert_ne!(mutation.hash().expect("valid mutation"), expected);
    }
}

#[test]
fn deployment_binding_rejects_invalid_guardian_kind() {
    let mut invalid = binding();
    invalid.guardian.0 = 2;
    assert!(invalid.hash().is_err());
}

#[test]
fn deployment_binding_rejects_invalid_asset_admin_kind() {
    let mut invalid = binding();
    invalid.asset_admin.0 = 2;
    assert!(invalid.hash().is_err());
}
