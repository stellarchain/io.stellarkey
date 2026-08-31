#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc as SorobanRpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import {
  ARCHIVE_GATE_PROTOCOL_VERSION,
  ARCHIVE_GATE_LIMITS,
  archiveGateExecutableExtensionLedgers,
  archiveGateObservationCycles,
  buildArchiveGateCaptiveCoreConfig,
  buildArchiveGateCoreConfig,
  buildLowTtlProfile,
  parseArchiveGateArguments,
  sanitizeArchiveGateEvidence,
} from "./archive-gate-lib.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PRIVATE_ROOT = path.join(PROJECT_ROOT, "protocol/private-balance");
const CARGO_MANIFEST = path.join(PRIVATE_ROOT, "Cargo.toml");
const RESULT_PATH = path.join(PRIVATE_ROOT, "results/archive-gate.json");
const QUICKSTART_IMAGE = "stellar/quickstart:testing";
const PROFILE_SOURCE = "/opt/stellar-default/local/core/etc/config-settings/p26/testnet.json";
const PROFILE_TARGET = "/opt/stellar-default/local/core/etc/config-settings/p26/lowttl.json";
const CORE_CONFIG_SOURCE = "/opt/stellar-default/local/core/etc/stellar-core.cfg";
const RPC_CORE_CONFIG_SOURCE =
  "/opt/stellar-default/local/stellar-rpc/etc/stellar-captive-core.cfg";
const NETWORK_PASSPHRASE = "Standalone Network ; February 2017";
const PROTOCOL_VERSION = ARCHIVE_GATE_PROTOCOL_VERSION;
const NULLIFIER = Buffer.alloc(32, 0x77);
const PAGE_VALUE = Buffer.alloc(32, 0x99);
const PAGE_ID = 0;
const LEDGERS_PER_EVICTION_CYCLE = 4;

function command(command, args, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "unknown command failure")
      .trim()
      .slice(0, 2_000);
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout ?? "").trim();
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function containerExists(name) {
  return spawnSync("docker", ["inspect", name], { stdio: "ignore" }).status === 0;
}

function stopDedicatedContainer(name) {
  if (!containerExists(name)) return;
  command("docker", ["stop", name], "Stopping the dedicated archive-gate container");
  if (containerExists(name)) {
    const removal = spawnSync("docker", ["rm", name], { encoding: "utf8" });
    const detail = String(removal.stderr || removal.stdout || "").trim();
    if (removal.status !== 0 && !/no such container/i.test(detail)) {
      throw new Error(`Removing the dedicated archive-gate container failed: ${detail}`);
    }
  }
}

async function rpcRequest(url, method) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error || !payload.result) throw new Error(`RPC ${method} returned an error`);
  return payload.result;
}

async function waitForRpc(url, minimumLedger = 0, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await rpcRequest(url, "getHealth");
      if (health.status === "healthy" && Number(health.latestLedger) >= minimumLedger) {
        return Number(health.latestLedger);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    `Archive-gate RPC did not reach ledger ${minimumLedger}` +
    (lastError instanceof Error ? `: ${lastError.message}` : ""),
  );
}

async function waitForNetworkReady(container, rpcUrl, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const state = spawnSync("docker", [
      "inspect", "--format", "{{.State.Running}}", container,
    ], { encoding: "utf8" });
    if (state.status !== 0 || state.stdout.trim() !== "true") {
      throw new Error("Archive-gate container exited before RPC/Friendbot became ready");
    }
    const friendbot = spawnSync("docker", [
      "exec", container, "supervisorctl", "status", "friendbot",
    ], { encoding: "utf8" });
    const friendbotReady = friendbot.status === 0 && /\bRUNNING\b/.test(friendbot.stdout);
    try {
      const health = await rpcRequest(rpcUrl, "getHealth");
      if (friendbotReady && health.status === "healthy") {
        return Number(health.latestLedger);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(
    "Archive-gate RPC/Friendbot did not become ready" +
    (lastError instanceof Error ? `: ${lastError.message}` : ""),
  );
}

async function fundAccount(baseUrl, publicKey) {
  const url = new URL("/friendbot", baseUrl);
  url.searchParams.set("addr", publicKey);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Local Friendbot returned HTTP ${response.status}`);
  }
}

function buildContract(outputDirectory) {
  command("stellar", [
    "contract", "build",
    "--manifest-path", CARGO_MANIFEST,
    "--package", "private-balance-archive-gate",
    "--locked",
    "--optimize=false",
    "--out-dir", outputDirectory,
  ], "Building the archive-gate contract");
  const wasm = readdirSync(outputDirectory).filter(name => name.endsWith(".wasm"));
  if (wasm.length !== 1) throw new Error(`Expected one archive-gate Wasm, found ${wasm.length}`);
  return path.join(outputDirectory, wasm[0]);
}

function deployContract({ wasmPath, sourceSecret, rpcUrl }) {
  const output = command("stellar", [
    "contract", "deploy",
    "--wasm", wasmPath,
    "--optimize=false",
    "--source-account", sourceSecret,
    "--rpc-url", rpcUrl,
    "--network-passphrase", NETWORK_PASSPHRASE,
  ], "Deploying the archive-gate contract");
  const ids = output.match(/C[A-Z2-7]{55}/g) ?? [];
  const contractId = ids.at(-1);
  if (!contractId) throw new Error("Stellar CLI did not return an archive-gate contract ID");
  return contractId;
}

async function simulateInvocation(server, source, operation) {
  const account = await server.getAccount(source);
  const transaction = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(operation).setTimeout(60).build();
  return {
    transaction,
    simulation: await server.simulateTransaction(transaction),
  };
}

async function submitAndConfirm(server, transaction, signer) {
  transaction.sign(signer);
  const expectedHash = Buffer.from(transaction.hash()).toString("hex");
  const sent = await server.sendTransaction(transaction);
  if (sent.hash.toLowerCase() !== expectedHash) {
    throw new Error("RPC returned a different archive-gate transaction hash");
  }
  if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
    throw new Error(`Archive-gate submission returned ${sent.status}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const result = await server.getTransaction(expectedHash);
    if (result.status === "SUCCESS") return expectedHash;
    if (result.status === "FAILED") throw new Error("Archive-gate transaction failed on chain");
  }
  throw new Error("Archive-gate transaction did not finalize before the polling deadline");
}

async function invoke(server, signer, operation) {
  const { transaction, simulation } = await simulateInvocation(
    server,
    signer.publicKey(),
    operation,
  );
  if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
    const detail = SorobanRpc.Api.isSimulationError(simulation) ? simulation.error : "restore required";
    throw new Error(`Archive-gate invocation did not simulate successfully: ${detail}`);
  }
  const assembled = SorobanRpc.assembleTransaction(transaction, simulation).build();
  const transactionHash = await submitAndConfirm(server, assembled, signer);
  return { simulation, transactionHash };
}

function ledgerKey(contractId, variant, value) {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: Address.fromString(contractId).toScAddress(),
    key: xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol(variant),
      value,
    ]),
    durability: xdr.ContractDataDurability.persistent,
  }));
}

function xdrBase64(value) {
  return value.toXDR("base64");
}

function assertExactAutoRestore(simulation, expectedKey, label) {
  if (
    !SorobanRpc.Api.isSimulationSuccess(simulation) ||
    SorobanRpc.Api.isSimulationRestore(simulation)
  ) {
    throw new Error(`${label} did not return a successful auto-restore simulation`);
  }
  const data = simulation.transactionData.build();
  if (data.ext.type !== "resourceExt") {
    throw new Error(`${label} did not declare archived Soroban entries`);
  }
  const footprint = data.resources.footprint;
  const archivedKeys = data.ext.value.archivedSorobanEntries.map(index => {
    const key = footprint.readWrite[index];
    if (!key) throw new Error(`${label} returned an invalid auto-restore index`);
    return key;
  });
  if (
    archivedKeys.length !== 1 ||
    xdrBase64(archivedKeys[0]) !== xdrBase64(expectedKey)
  ) {
    throw new Error(`${label} auto-restore set was not the exact archived key`);
  }
  return { minResourceFee: simulation.minResourceFee };
}

async function submitSimulatedInvocation(server, signer, attempt) {
  const transaction = SorobanRpc.assembleTransaction(
    attempt.transaction,
    attempt.simulation,
  ).build();
  return submitAndConfirm(server, transaction, signer);
}

export async function submitFreshAutoRestore({ simulate, validate, submit }) {
  const attempt = await simulate();
  const restoration = validate(attempt.simulation);
  restoration.transactionHash = await submit(attempt);
  return restoration;
}

async function closeLedgers(container, rpcUrl, count) {
  void container;
  const before = await waitForRpc(rpcUrl);
  return waitForRpc(rpcUrl, before + count, Math.max(120_000, count * 8_000));
}

function extendExecutable({ contractId, extensionLedgers, wasmPath, sourceSecret, rpcUrl }) {
  const common = [
    "--ledgers-to-extend", String(extensionLedgers),
    "--source-account", sourceSecret,
    "--rpc-url", rpcUrl,
    "--network-passphrase", NETWORK_PASSPHRASE,
  ];
  command("stellar", ["contract", "extend", "--id", contractId, ...common],
    "Extending the archive-gate contract instance");
  command("stellar", ["contract", "extend", "--wasm", wasmPath, ...common],
    "Extending the archive-gate contract Wasm");
}

async function entryCount(server, key) {
  const response = await server.getLedgerEntries(key);
  return response.entries.length;
}

async function liveEntry(server, key, label) {
  const response = await server.getLedgerEntries(key);
  const entry = response.entries[0];
  if (!entry || !Number.isSafeInteger(entry.liveUntilLedgerSeq)) {
    throw new Error(`${label} was not live with an observable TTL`);
  }
  return entry;
}

async function archivedEntry(server, key, label) {
  const response = await server.getLedgerEntries(key);
  const entry = response.entries[0];
  if (!entry || entry.liveUntilLedgerSeq !== 0) {
    throw new Error(`${label} was not returned as archived with the RPC TTL placeholder`);
  }
  return entry;
}

function version(commandName, args) {
  return command(commandName, args, `${commandName} version`).split("\n")[0];
}

export async function runArchiveGate(argv = process.argv.slice(2), environment = process.env) {
  const parsed = parseArchiveGateArguments(argv, environment);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "stellarkey-archive-gate-"));
  const buildDirectory = path.join(temporaryRoot, "wasm");
  const profilePath = path.join(temporaryRoot, "lowttl.json");
  const coreConfigPath = path.join(temporaryRoot, "stellar-core.cfg");
  const rpcCoreConfigPath = path.join(temporaryRoot, "stellar-rpc-captive-core.cfg");
  const rpcUrl = `http://127.0.0.1:${parsed.port}/rpc`;
  const baseUrl = `http://127.0.0.1:${parsed.port}`;
  let started = false;
  try {
    mkdirSync(buildDirectory, { recursive: true });
    const template = JSON.parse(command("docker", [
      "run", "--rm", "--entrypoint", "cat", QUICKSTART_IMAGE, PROFILE_SOURCE,
    ], "Reading the Quickstart protocol profile"));
    const profile = buildLowTtlProfile(template);
    writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
    const coreConfig = command("docker", [
      "run", "--rm", "--entrypoint", "cat", QUICKSTART_IMAGE, CORE_CONFIG_SOURCE,
    ], "Reading the Quickstart Core config");
    writeFileSync(coreConfigPath, buildArchiveGateCoreConfig(coreConfig), { mode: 0o600 });
    const rpcCoreConfig = command("docker", [
      "run", "--rm", "--entrypoint", "cat", QUICKSTART_IMAGE, RPC_CORE_CONFIG_SOURCE,
    ], "Reading the Quickstart RPC captive-Core config");
    writeFileSync(
      rpcCoreConfigPath,
      buildArchiveGateCaptiveCoreConfig(rpcCoreConfig),
      { mode: 0o600 },
    );

    stopDedicatedContainer(parsed.container);
    command("docker", [
      "run", "-d",
      "--name", parsed.container,
      "-p", `127.0.0.1:${parsed.port}:8000`,
      "-v", `${profilePath}:${PROFILE_TARGET}:ro`,
      "-v", `${coreConfigPath}:${CORE_CONFIG_SOURCE}:ro`,
      "-v", `${rpcCoreConfigPath}:${RPC_CORE_CONFIG_SOURCE}:ro`,
      QUICKSTART_IMAGE,
      "--local",
      "--protocol-version", String(PROTOCOL_VERSION),
      "--enable", "core,rpc",
      "--limits", "lowttl",
    ], "Starting the dedicated archive-gate network");
    started = true;
    const startingLedger = await waitForNetworkReady(parsed.container, rpcUrl);

    const signer = Keypair.random();
    await fundAccount(baseUrl, signer.publicKey());
    const wasmPath = buildContract(buildDirectory);
    const wasmSha256 = sha256File(wasmPath);
    const contractId = deployContract({
      wasmPath,
      sourceSecret: signer.secret(),
      rpcUrl,
    });
    const contract = new Contract(contractId);
    const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    const observationCycles = archiveGateObservationCycles(
      ARCHIVE_GATE_LIMITS.starting_eviction_scan_level,
      LEDGERS_PER_EVICTION_CYCLE,
    );
    const executableExtensionLedgers = archiveGateExecutableExtensionLedgers(
      ARCHIVE_GATE_LIMITS.starting_eviction_scan_level,
      LEDGERS_PER_EVICTION_CYCLE,
    );
    extendExecutable({
      contractId,
      extensionLedgers: executableExtensionLedgers,
      wasmPath,
      sourceSecret: signer.secret(),
      rpcUrl,
    });
    const pageKey = ledgerKey(contractId, "ArchivePage", xdr.ScVal.scvU32(PAGE_ID));
    const nullifierKey = ledgerKey(
      contractId,
      "Nullifier",
      xdr.ScVal.scvBytes(NULLIFIER),
    );

    await invoke(server, signer, contract.call(
      "write_page",
      xdr.ScVal.scvU32(PAGE_ID),
      xdr.ScVal.scvBytes(PAGE_VALUE),
    ));
    await invoke(server, signer, contract.call("spend", xdr.ScVal.scvBytes(NULLIFIER)));
    const pageLiveEntry = await liveEntry(server, pageKey, "Archive page");
    const nullifierLiveEntry = await liveEntry(server, nullifierKey, "Spent nullifier");
    const liveLedger = await waitForRpc(rpcUrl);
    const maximumInitialLiveUntil = liveLedger + ARCHIVE_GATE_LIMITS.min_persistent_ttl;
    if (
      pageLiveEntry.liveUntilLedgerSeq > maximumInitialLiveUntil ||
      nullifierLiveEntry.liveUntilLedgerSeq > maximumInitialLiveUntil
    ) {
      throw new Error("Archive-gate entries did not use the configured minimum persistent TTL");
    }
    if (await entryCount(server, pageKey) !== 1 || await entryCount(server, nullifierKey) !== 1) {
      throw new Error("Archive-gate entries were not live before expiry");
    }

    const archivedAtLedger = await closeLedgers(
      parsed.container,
      rpcUrl,
      observationCycles * LEDGERS_PER_EVICTION_CYCLE,
    );
    const recoverySigner = Keypair.random();
    await fundAccount(baseUrl, recoverySigner.publicKey());
    await archivedEntry(server, pageKey, "Archive page");
    await archivedEntry(server, nullifierKey, "Spent nullifier");

    const pageRestore = await submitFreshAutoRestore({
      simulate: () => simulateInvocation(
        server,
        recoverySigner.publicKey(),
        contract.call("touch_page", xdr.ScVal.scvU32(PAGE_ID)),
      ),
      validate: simulation => assertExactAutoRestore(
        simulation,
        pageKey,
        "Archive page",
      ),
      submit: attempt => submitSimulatedInvocation(server, recoverySigner, attempt),
    });
    const restoredPage = await liveEntry(server, pageKey, "Restored archive page");
    if (restoredPage.liveUntilLedgerSeq === 0) {
      throw new Error("Restored archive page was not readable");
    }

    const nullifierRestore = await submitFreshAutoRestore({
      simulate: () => simulateInvocation(
        server,
        recoverySigner.publicKey(),
        contract.call("is_spent", xdr.ScVal.scvBytes(NULLIFIER)),
      ),
      validate: simulation => assertExactAutoRestore(
        simulation,
        nullifierKey,
        "Spent nullifier",
      ),
      submit: attempt => submitSimulatedInvocation(server, recoverySigner, attempt),
    });
    const restoredNullifier = await liveEntry(server, nullifierKey, "Restored nullifier");
    if (restoredNullifier.liveUntilLedgerSeq === 0) {
      throw new Error("Restored nullifier did not return to live state");
    }
    const spentView = await simulateInvocation(
      server,
      recoverySigner.publicKey(),
      contract.call("is_spent", xdr.ScVal.scvBytes(NULLIFIER)),
    );
    if (
      !SorobanRpc.Api.isSimulationSuccess(spentView.simulation) ||
      scValToNative(spentView.simulation.result.retval) !== true
    ) {
      throw new Error("Restored nullifier was not reported as spent");
    }
    const replay = await simulateInvocation(
      server,
      recoverySigner.publicKey(),
      contract.call("spend", xdr.ScVal.scvBytes(NULLIFIER)),
    );
    if (!SorobanRpc.Api.isSimulationError(replay.simulation)) {
      throw new Error("Archived nullifier replay simulated as an allowed spend");
    }

    const finalLedger = await waitForRpc(rpcUrl);
    const evidence = sanitizeArchiveGateEvidence({
      schemaVersion: 1,
      scope: "controlled-core-archival-replay-gate",
      passed: true,
      completedAt: new Date().toISOString(),
      network: {
        passphrase: NETWORK_PASSPHRASE,
        protocolVersion: PROTOCOL_VERSION,
        startingLedger,
        archivedAtLedger,
        finalLedger,
        limits: ARCHIVE_GATE_LIMITS,
      },
      software: {
        quickstartImage: QUICKSTART_IMAGE,
        quickstartImageId: command("docker", [
          "image", "inspect", QUICKSTART_IMAGE, "--format", "{{.Id}}",
        ], "Reading the Quickstart image ID"),
        stellarCli: version("stellar", ["--version"]),
        stellarCore: command("docker", [
          "exec", parsed.container, "stellar-core", "version",
        ], "Reading Stellar Core version").split("\n")[0],
        stellarRpc: command("docker", [
          "exec", parsed.container, "stellar-rpc", "version",
        ], "Reading Stellar RPC version").split("\n")[0],
      },
      probe: {
        contractId,
        wasmSha256,
        account: signer.publicKey(),
        sourceHashes: {
          gateContract: sha256File(path.join(
            PRIVATE_ROOT,
            "contracts/archive-gate/src/lib.rs",
          )),
          poolNullifier: sha256File(path.join(PRIVATE_ROOT, "contracts/pool/src/nullifier.rs")),
          poolStorage: sha256File(path.join(PRIVATE_ROOT, "contracts/pool/src/storage.rs")),
        },
      },
      checks: {
        pageLiveBeforeExpiry: true,
        nullifierLiveBeforeExpiry: true,
        pageArchivedWithZeroTtl: true,
        nullifierArchivedWithZeroTtl: true,
        pageAutoRestoreSetExact: true,
        nullifierAutoRestoreSetExact: true,
        pageRestoredAndReadable: true,
        nullifierRestoredAsSpent: true,
        duplicateRejectedAfterRestore: true,
      },
      restoration: {
        page: pageRestore,
        nullifier: nullifierRestore,
        duplicateSimulationError: String(replay.simulation.error).slice(0, 1_000),
      },
      limitations: [
        "The test-only contract mirrors the release pool storage pattern; it is not deployed in production.",
        "This gate proves current Core archival and replay semantics, not independent audit approval.",
      ],
    });
    mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
    writeFileSync(RESULT_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } catch (error) {
    if (started && containerExists(parsed.container)) {
      const logs = spawnSync("docker", ["logs", "--tail", "120", parsed.container], {
        encoding: "utf8",
      });
      if (logs.stdout || logs.stderr) {
        process.stderr.write(`${String(logs.stdout)}${String(logs.stderr)}`.slice(-12_000));
      }
    }
    throw error;
  } finally {
    if (started && !parsed.keepContainer) stopDedicatedContainer(parsed.container);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const evidence = await runArchiveGate();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
