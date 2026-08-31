mod common;

use common::{payload, register_pool};
use private_balance_pool::{archive, storage};
use private_balance_protocol::{
    action::{Action, ActionKind},
    constants::PROTOCOL_VERSION,
    encryption::OutputPackage,
};
use soroban_sdk::{BytesN, Env};

fn deposit(index: u32, source: (u8, [u8; 32]), asset: (u8, [u8; 32])) -> Action {
    let mut commitment = [0; 32];
    commitment[28..].copy_from_slice(&(index + 1).to_be_bytes());
    Action {
        protocol_version: PROTOCOL_VERSION,
        kind: ActionKind::Deposit,
        asset,
        action_nonce: [index as u8; 32],
        anchor_root: [0; 32],
        nullifiers: [[0; 32]; 2],
        outputs: [
            OutputPackage {
                cm: commitment,
                recipient_envelope: [index as u8; 181],
            },
            OutputPackage::dummy(),
        ],
        public_value: 1,
        deposit_source: Some(source),
        public_recipient: None,
        relayer_fee: 0,
        relayer: None,
    }
}

#[test]
fn actions_are_written_once_as_independent_archive_records() {
    let env = Env::default();
    env.mock_all_auths();
    let fixture = register_pool(&env);
    let config = env.as_contract(&fixture.pool_id, || storage::get_config(&env).unwrap());
    let source = payload(&fixture.guardian);

    for index in 0..3 {
        let action = deposit(index, source, payload(&fixture.asset));
        let signals = env.as_contract(&fixture.pool_id, || {
            private_balance_pool::action::public_signals(&env, &config, &action).unwrap()
        });
        env.as_contract(&fixture.pool_id, || {
            archive::append_record(
                &env,
                &config,
                &action,
                &fixture.asset,
                &BytesN::from_array(&env, &signals[7]),
                u64::from(index) * 2,
                &BytesN::from_array(&env, &[index as u8 + 1; 32]),
                Some(&fixture.guardian),
                None,
            )
            .unwrap();
        });
    }

    env.as_contract(&fixture.pool_id, || {
        let meta = storage::get_meta(&env);
        assert_eq!(meta.action_count, 3);
        assert_ne!(meta.transcript_head.to_array(), [0; 32]);
        for index in 0..3 {
            let record = storage::get_archive_record(&env, index).unwrap();
            assert_eq!(record.action_index, index);
        }
        assert!(storage::get_archive_record(&env, 3).is_none());
    });
}
