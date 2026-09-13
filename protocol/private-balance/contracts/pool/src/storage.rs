use crate::{
    archive::{ArchiveMeta, ArchiveRecord},
    errors::PoolError,
};
use soroban_sdk::{Address, BytesN, Env, Vec, contracttype};

pub const ROOT_TTL_SAFETY_MARGIN: u32 = 64;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolConfig {
    pub protocol_version: u32,
    pub network_id: BytesN<32>,
    pub realm_id: BytesN<32>,
    pub guardian: Address,
    pub initial_asset_admin: Address,
    pub poseidon2_parameter_hash: BytesN<32>,
    pub circuit_hash: BytesN<32>,
    pub verification_key_hash: BytesN<32>,
    pub tree_depth: u32,
    pub root_window_ledgers: u32,
    pub deployment_binding_hash: BytesN<32>,
    pub context_hash: BytesN<32>,
    pub context_field: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AssetStatus {
    Active,
    ExitOnly,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetConfig {
    pub index: u32,
    pub asset: Address,
    pub asset_field: BytesN<32>,
    pub status: AssetStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreeStorage {
    pub next_index: u128,
    pub frontier: Vec<BytesN<32>>,
    pub current_root: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KnownRoot {
    pub created_at_ledger: u32,
    pub valid_until_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    AssetAdmin,
    PendingAssetAdmin,
    AssetCount,
    RegisteredAsset(u32),
    RegisteredAssetIndex(Address),
    DepositPause,
    Tree,
    Meta,
    Nullifier(BytesN<32>),
    KnownRoot(BytesN<32>),
    ArchiveRecord(u128),
}

pub fn get_asset_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::AssetAdmin)
}

pub fn set_asset_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::AssetAdmin, admin);
}

pub fn get_pending_asset_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAssetAdmin)
}

pub fn set_pending_asset_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::PendingAssetAdmin, admin);
}

pub fn clear_pending_asset_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAssetAdmin);
}

pub fn asset_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::AssetCount)
        .unwrap_or(0)
}

pub fn set_asset_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::AssetCount, &count);
}

pub fn get_registered_asset(env: &Env, index: u32) -> Option<AssetConfig> {
    let key = DataKey::RegisteredAsset(index);
    env.storage().persistent().get(&key)
}

pub fn set_registered_asset(env: &Env, config: &AssetConfig) {
    let key = DataKey::RegisteredAsset(config.index);
    env.storage().persistent().set(&key, config);
    let max_ttl = env.storage().max_ttl();
    env.storage()
        .persistent()
        .extend_ttl(&key, max_ttl, max_ttl);
}

pub fn registered_asset_index(env: &Env, asset: &Address) -> Option<u32> {
    let key = DataKey::RegisteredAssetIndex(asset.clone());
    env.storage().persistent().get(&key)
}

pub fn set_registered_asset_index(env: &Env, asset: &Address, index: u32) {
    let key = DataKey::RegisteredAssetIndex(asset.clone());
    env.storage().persistent().set(&key, &index);
    let max_ttl = env.storage().max_ttl();
    env.storage()
        .persistent()
        .extend_ttl(&key, max_ttl, max_ttl);
}

pub fn get_config(env: &Env) -> Option<PoolConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_config(env: &Env, config: &PoolConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn deposits_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::DepositPause)
        .unwrap_or(false)
}

pub fn set_deposits_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&DataKey::DepositPause, &paused);
}

pub fn get_tree(env: &Env) -> TreeStorage {
    env.storage()
        .instance()
        .get(&DataKey::Tree)
        .expect("tree initialized")
}

pub fn set_tree(env: &Env, tree: &TreeStorage) {
    env.storage().instance().set(&DataKey::Tree, tree);
}

pub fn get_meta(env: &Env) -> ArchiveMeta {
    env.storage()
        .instance()
        .get(&DataKey::Meta)
        .expect("meta initialized")
}

pub fn set_meta(env: &Env, meta: &ArchiveMeta) {
    env.storage().instance().set(&DataKey::Meta, meta);
}

pub fn known_root(env: &Env, root: &BytesN<32>) -> Result<KnownRoot, PoolError> {
    if root.to_array() == [0; 32] {
        return Err(PoolError::UnknownRoot);
    }
    let key = DataKey::KnownRoot(root.clone());
    let value: KnownRoot = env
        .storage()
        .temporary()
        .get(&key)
        .ok_or(PoolError::UnknownRoot)?;
    if env.ledger().sequence() > value.valid_until_ledger {
        return Err(PoolError::RootExpired);
    }
    Ok(value)
}

pub fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    known_root(env, root).is_ok()
}

pub fn add_known_root(
    env: &Env,
    root: &BytesN<32>,
    root_window_ledgers: u32,
) -> Result<KnownRoot, PoolError> {
    let extend_to = root_window_ledgers
        .checked_add(ROOT_TTL_SAFETY_MARGIN)
        .ok_or(PoolError::InvalidConfiguration)?;
    if extend_to > env.storage().max_ttl() {
        return Err(PoolError::InvalidConfiguration);
    }
    let created_at_ledger = env.ledger().sequence();
    let value = KnownRoot {
        created_at_ledger,
        valid_until_ledger: created_at_ledger
            .checked_add(root_window_ledgers)
            .ok_or(PoolError::InvalidConfiguration)?,
    };
    let key = DataKey::KnownRoot(root.clone());
    env.storage().temporary().set(&key, &value);
    env.storage()
        .temporary()
        .extend_ttl(&key, extend_to, extend_to);
    Ok(value)
}

pub fn get_archive_record(env: &Env, action_index: u128) -> Option<ArchiveRecord> {
    let key = DataKey::ArchiveRecord(action_index);
    env.storage().persistent().get(&key)
}

pub fn set_archive_record(
    env: &Env,
    action_index: u128,
    record: &ArchiveRecord,
) -> Result<(), PoolError> {
    let key = DataKey::ArchiveRecord(action_index);
    if env.storage().persistent().has(&key) {
        return Err(PoolError::ArchiveCorrupt);
    }
    env.storage().persistent().set(&key, record);
    let max_ttl = env.storage().max_ttl();
    env.storage()
        .persistent()
        .extend_ttl(&key, max_ttl, max_ttl);
    Ok(())
}
