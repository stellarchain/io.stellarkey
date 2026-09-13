const DEFAULT_CONTAINER = "stellar-stellarkey-archive-gate";
const DEFAULT_PORT = 8010;
const SAFE_CONTAINER = /^stellar-stellarkey-archive-gate(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

// The workspace pins soroban-sdk 27.0.6 and Stellar CLI 27. A protocol-26
// host cannot simulate Wasm produced by that toolchain.
export const ARCHIVE_GATE_PROTOCOL_VERSION = 27;

export const ARCHIVE_GATE_LIMITS = Object.freeze({
  max_entry_ttl: 1_054_080,
  min_temporary_ttl: 16,
  min_persistent_ttl: 16,
  max_entries_to_archive: 1000,
  live_soroban_state_size_window_sample_period: 1,
  // Match Stellar Core's deterministic archival tests while keeping this
  // controlled gate fast enough for repeatable local and CI execution.
  starting_eviction_scan_level: 1,
});

export function archiveGateObservationCycles(bucketLevel, ledgersPerCycle) {
  if (
    !Number.isSafeInteger(bucketLevel) || bucketLevel < 0 ||
    !Number.isSafeInteger(ledgersPerCycle) || ledgersPerCycle <= 0
  ) {
    throw new Error("Archive observation inputs must be non-negative integers.");
  }
  // Stellar Core's BucketList levelHalf(level) is 2 * 4^level. Observe one
  // additional quarter-window so the eviction iterator can scan after the
  // entry has been promoted into the selected level.
  const promotionLedgers = 2 * (4 ** bucketLevel);
  const bucketObservationLedgers = promotionLedgers + promotionLedgers / 4;
  const ttlObservationLedgers = ARCHIVE_GATE_LIMITS.min_persistent_ttl * 2;
  return Math.ceil(
    Math.max(bucketObservationLedgers, ttlObservationLedgers) / ledgersPerCycle,
  );
}

export function archiveGateExecutableExtensionLedgers(bucketLevel, ledgersPerCycle) {
  return archiveGateObservationCycles(bucketLevel, ledgersPerCycle) * ledgersPerCycle + 64;
}

function buildArchiveGateCoreConfigBase(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Quickstart Core config must be non-empty text.");
  }
  return "# StellarKey controlled archive gate only.\n" +
    "OVERRIDE_EVICTION_PARAMS_FOR_TESTING=true\n" +
    `TESTING_STARTING_EVICTION_SCAN_LEVEL=${ARCHIVE_GATE_LIMITS.starting_eviction_scan_level}\n` +
    `TESTING_MAX_ENTRIES_TO_ARCHIVE=${ARCHIVE_GATE_LIMITS.max_entries_to_archive}\n\n` +
    `${source.trimEnd()}\n`;
}

export function buildArchiveGateCoreConfig(source) {
  return buildArchiveGateCoreConfigBase(source);
}

export function buildArchiveGateCaptiveCoreConfig(source) {
  // stellar-rpc v28 validates captive-Core config through go-stellar-sdk's
  // strict allowlist. Keep its genesis-affecting overrides byte-for-byte equal
  // to the validator node; TESTING_EVICTION_SCAN_SIZE is intentionally absent.
  return buildArchiveGateCoreConfigBase(source);
}

export function buildLowTtlProfile(source) {
  if (!source || typeof source !== "object" || !Array.isArray(source.updated_entry)) {
    throw new Error("Quickstart limits profile must contain updated_entry.");
  }
  const indexes = source.updated_entry
    .map((entry, index) => entry && typeof entry === "object" && "state_archival" in entry
      ? index
      : -1)
    .filter(index => index >= 0);
  if (indexes.length !== 1) {
    throw new Error("Quickstart limits profile must contain exactly one state_archival entry.");
  }
  const result = structuredClone(source);
  const archival = result.updated_entry[indexes[0]].state_archival;
  if (!archival || typeof archival !== "object" || Array.isArray(archival)) {
    throw new Error("Quickstart state_archival entry is invalid.");
  }
  Object.assign(archival, ARCHIVE_GATE_LIMITS);
  return result;
}

export function parseArchiveGateArguments(argv, environment = process.env) {
  const parsed = {
    container: DEFAULT_CONTAINER,
    keepContainer: false,
    port: DEFAULT_PORT,
    run: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run") {
      parsed.run = true;
      continue;
    }
    if (argument === "--keep-container") {
      parsed.keepContainer = true;
      continue;
    }
    if (argument === "--container" || argument === "--port") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--container") parsed.container = value;
      else parsed.port = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown archive-gate argument: ${argument}`);
  }
  if (!parsed.run) throw new Error("Pass --run to execute the controlled archive gate.");
  if (environment.PRIVATE_BALANCE_ARCHIVE_GATE !== "1") {
    throw new Error("Set PRIVATE_BALANCE_ARCHIVE_GATE=1 to confirm controlled network mutation.");
  }
  if (!SAFE_CONTAINER.test(parsed.container)) {
    throw new Error("Use a dedicated archive-gate container name.");
  }
  if (!Number.isSafeInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535) {
    throw new Error("Archive-gate port must be an unprivileged TCP port.");
  }
  return parsed;
}

export function sanitizeArchiveGateEvidence(value) {
  const forbidden = /secret|seed|mnemonic|private.?key|config.?dir/i;
  if (Array.isArray(value)) return value.map(sanitizeArchiveGateEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, child]) => [key, sanitizeArchiveGateEvidence(child)]),
  );
}
