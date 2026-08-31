use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    UnsupportedProtocol = 2,
    InvalidConfiguration = 3,
    DepositsPaused = 4,
    InvalidActionShape = 5,
    NoncanonicalEncoding = 6,
    InvalidAmount = 7,
    UnknownRoot = 8,
    RootExpired = 9,
    NullifierAlreadySpent = 10,
    InvalidCommitment = 11,
    InvalidProof = 12,
    TreeFull = 13,
    ArchivePageLimit = 14,
    ArchiveCorrupt = 15,
    UnauthorizedGuardian = 16,
}
