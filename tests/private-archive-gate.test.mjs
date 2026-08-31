import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCHIVE_GATE_PROTOCOL_VERSION,
  archiveGateExecutableExtensionLedgers,
  archiveGateObservationCycles,
  buildArchiveGateCaptiveCoreConfig,
  buildArchiveGateCoreConfig,
  buildLowTtlProfile,
  parseArchiveGateArguments,
  sanitizeArchiveGateEvidence,
} from "../protocol/private-balance/spikes/scripts/archive-gate-lib.mjs";
import {
  submitFreshAutoRestore,
} from "../protocol/private-balance/spikes/scripts/run-archive-gate.mjs";

test("archive gate uses the protocol supported by the pinned SDK", () => {
  assert.equal(ARCHIVE_GATE_PROTOCOL_VERSION, 27);
});

test("archive gate observes beyond the selected bucket promotion boundary", () => {
  assert.equal(archiveGateObservationCycles(1, 4), 8);
  assert.equal(archiveGateExecutableExtensionLedgers(1, 4), 96);
});

test("archive gate initializes Core's separate eviction iterator", () => {
  const config = buildArchiveGateCoreConfig("NETWORK_PASSPHRASE=\"__NETWORK__\"\n");
  assert.ok(config.startsWith("# StellarKey controlled archive gate only."));
  assert.match(config, /OVERRIDE_EVICTION_PARAMS_FOR_TESTING=true/);
  assert.match(config, /TESTING_STARTING_EVICTION_SCAN_LEVEL=1/);
  assert.match(config, /TESTING_MAX_ENTRIES_TO_ARCHIVE=1000/);
  assert.doesNotMatch(config, /TESTING_EVICTION_SCAN_SIZE/);
});

test("archive gate emits an RPC-compatible captive-Core config", () => {
  const config = buildArchiveGateCaptiveCoreConfig(
    "NETWORK_PASSPHRASE=\"__NETWORK__\"\n",
  );
  assert.ok(config.startsWith("# StellarKey controlled archive gate only."));
  assert.match(config, /OVERRIDE_EVICTION_PARAMS_FOR_TESTING=true/);
  assert.match(config, /TESTING_STARTING_EVICTION_SCAN_LEVEL=1/);
  assert.match(config, /TESTING_MAX_ENTRIES_TO_ARCHIVE=1000/);
  assert.doesNotMatch(config, /TESTING_EVICTION_SCAN_SIZE/);
  assert.equal(
    config,
    buildArchiveGateCoreConfig("NETWORK_PASSPHRASE=\"__NETWORK__\"\n"),
  );
});

test("archive gate profile changes only the state archival limits", () => {
  const source = {
    updated_entry: [
      { contract_max_size_bytes: 131072 },
      {
        state_archival: {
          max_entry_ttl: 1_054_080,
          min_temporary_ttl: 16,
          min_persistent_ttl: 4096,
          persistent_rent_rate_denominator: "1215",
          temp_rent_rate_denominator: "2430",
          max_entries_to_archive: 100,
          live_soroban_state_size_window_sample_size: 30,
          live_soroban_state_size_window_sample_period: 64,
          eviction_scan_size: 500000,
          starting_eviction_scan_level: 7,
        },
      },
    ],
  };

  const result = buildLowTtlProfile(source);
  assert.deepEqual(result.updated_entry[0], source.updated_entry[0]);
  assert.deepEqual(result.updated_entry[1].state_archival, {
    ...source.updated_entry[1].state_archival,
    max_entry_ttl: 1_054_080,
    min_temporary_ttl: 16,
    min_persistent_ttl: 16,
    max_entries_to_archive: 1000,
    live_soroban_state_size_window_sample_period: 1,
    starting_eviction_scan_level: 1,
  });
  assert.equal(source.updated_entry[1].state_archival.max_entry_ttl, 1_054_080);
});

test("archive gate profile rejects a missing or duplicate state archival entry", () => {
  assert.throws(() => buildLowTtlProfile({ updated_entry: [] }), /exactly one state_archival/i);
  assert.throws(
    () => buildLowTtlProfile({
      updated_entry: [
        { state_archival: { max_entry_ttl: 1 } },
        { state_archival: { max_entry_ttl: 2 } },
      ],
    }),
    /exactly one state_archival/i,
  );
});

test("archive gate arguments require explicit consent and a dedicated target", () => {
  assert.throws(() => parseArchiveGateArguments([], {}), /--run/i);
  assert.throws(
    () => parseArchiveGateArguments(["--run"], {}),
    /PRIVATE_BALANCE_ARCHIVE_GATE=1/,
  );
  assert.throws(
    () => parseArchiveGateArguments(["--run", "--container", "postgres"], {
      PRIVATE_BALANCE_ARCHIVE_GATE: "1",
    }),
    /dedicated archive-gate container/i,
  );
  assert.throws(
    () => parseArchiveGateArguments(["--run", "--port", "80"], {
      PRIVATE_BALANCE_ARCHIVE_GATE: "1",
    }),
    /port/i,
  );
  assert.deepEqual(
    parseArchiveGateArguments(["--run", "--keep-container"], {
      PRIVATE_BALANCE_ARCHIVE_GATE: "1",
    }),
    {
      container: "stellar-stellarkey-archive-gate",
      keepContainer: true,
      port: 8010,
      run: true,
    },
  );
});

test("archive gate evidence recursively removes secret material", () => {
  assert.deepEqual(
    sanitizeArchiveGateEvidence({
      account: "GABC",
      secretSeed: "SABC",
      nested: { privateKey: "hidden", passed: true },
      list: [{ mnemonic: "hidden" }, { check: "ok" }],
    }),
    {
      account: "GABC",
      nested: { passed: true },
      list: [{}, { check: "ok" }],
    },
  );
});

test("each archived-key restore is freshly simulated before submission", async () => {
  const events = [];
  const result = await submitFreshAutoRestore({
    simulate: async () => {
      events.push("simulate");
      return { simulation: { sequence: 2 } };
    },
    validate: simulation => {
      events.push(`validate-${simulation.sequence}`);
      return { minResourceFee: "123" };
    },
    submit: async attempt => {
      events.push(`submit-${attempt.simulation.sequence}`);
      return "transaction-hash";
    },
  });

  assert.deepEqual(events, ["simulate", "validate-2", "submit-2"]);
  assert.deepEqual(result, {
    minResourceFee: "123",
    transactionHash: "transaction-hash",
  });
});
