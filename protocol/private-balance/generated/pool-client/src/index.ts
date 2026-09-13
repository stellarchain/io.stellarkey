import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





export interface DepositAction {
  action_nonce: Buffer;
  anchor_root: Buffer;
  asset_index: u32;
  deposit_source: string;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
  output_2: OutputPackage;
  public_value: u64;
}


export interface OutputPackage {
  commitment: Buffer;
  outgoing_envelope: Buffer;
  recipient_envelope: Buffer;
}


export interface TransferAction {
  action_nonce: Buffer;
  anchor_root: Buffer;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
  output_2: OutputPackage;
  public_value: u64;
}


export interface WithdrawAction {
  action_nonce: Buffer;
  anchor_root: Buffer;
  asset_index: u32;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
  output_2: OutputPackage;
  public_recipient: string;
  public_value: u64;
}

export const PoolError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"UnsupportedProtocol"},
  3: {message:"InvalidConfiguration"},
  4: {message:"DepositsPaused"},
  5: {message:"InvalidActionShape"},
  6: {message:"NoncanonicalEncoding"},
  7: {message:"InvalidAmount"},
  8: {message:"UnknownRoot"},
  9: {message:"RootExpired"},
  10: {message:"NullifierAlreadySpent"},
  11: {message:"InvalidCommitment"},
  12: {message:"InvalidProof"},
  13: {message:"TreeFull"},
  14: {message:"ActionCountOverflow"},
  15: {message:"ArchiveCorrupt"},
  16: {message:"UnauthorizedGuardian"},
  17: {message:"AssetAlreadyRegistered"},
  18: {message:"UnknownAsset"},
  19: {message:"AssetExitOnly"},
  20: {message:"AssetIndexOverflow"},
  21: {message:"NoPendingAssetAdmin"}
}








export interface ArchiveMeta {
  action_count: u128;
  transcript_head: Buffer;
}


export interface ArchiveRecord {
  action_index: u128;
  action_kind: u32;
  action_nonce: Buffer;
  anchor_root: Buffer;
  asset: Option<string>;
  asset_index: Option<u32>;
  deposit_source: Option<string>;
  ledger_sequence: u32;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
  output_2: OutputPackage;
  public_recipient: Option<string>;
  public_value: u64;
  starting_leaf_index: u128;
  tree_root_after: Buffer;
}

export type DataKey = {tag: "Config", values: void} | {tag: "AssetAdmin", values: void} | {tag: "PendingAssetAdmin", values: void} | {tag: "AssetCount", values: void} | {tag: "RegisteredAsset", values: readonly [u32]} | {tag: "RegisteredAssetIndex", values: readonly [string]} | {tag: "DepositPause", values: void} | {tag: "Tree", values: void} | {tag: "Meta", values: void} | {tag: "Nullifier", values: readonly [Buffer]} | {tag: "KnownRoot", values: readonly [Buffer]} | {tag: "ArchiveRecord", values: readonly [u128]};


export interface KnownRoot {
  created_at_ledger: u32;
  valid_until_ledger: u32;
}


export interface PoolConfig {
  circuit_hash: Buffer;
  context_field: Buffer;
  context_hash: Buffer;
  deployment_binding_hash: Buffer;
  guardian: string;
  initial_asset_admin: string;
  network_id: Buffer;
  poseidon2_parameter_hash: Buffer;
  protocol_version: u32;
  realm_id: Buffer;
  root_window_ledgers: u32;
  tree_depth: u32;
  verification_key_hash: Buffer;
}


export interface AssetConfig {
  asset: string;
  asset_field: Buffer;
  index: u32;
  status: AssetStatus;
}

export type AssetStatus = {tag: "Active", values: void} | {tag: "ExitOnly", values: void};


export interface TreeStorage {
  current_root: Buffer;
  frontier: Array<Buffer>;
  next_index: u128;
}


export interface SpentNullifier {
  spent_at_action: u128;
  spent_at_ledger: u32;
}


export interface Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}

export interface Client {
  /**
   * Construct and simulate a asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  asset: ({index}: {index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<AssetConfig>>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<PoolConfig>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({action, proof}: {action: DepositAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u128>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({action, proof}: {action: TransferAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u128>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw: ({action, proof}: {action: WithdrawAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u128>>>

  /**
   * Construct and simulate a add_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_asset: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a touch_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Re-registers the current tree root without moving value. This is
   * permissionless so an idle pool remains spendable while deposits are
   * paused, and repeated calls only refresh the same canonical root.
   */
  touch_root: (options?: MethodOptions) => Promise<AssembledTransaction<Result<KnownRoot>>>

  /**
   * Construct and simulate a tree_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  tree_state: (options?: MethodOptions) => Promise<AssembledTransaction<TreeStorage>>

  /**
   * Construct and simulate a asset_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  asset_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a asset_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  asset_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a asset_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  asset_index: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u32>>>

  /**
   * Construct and simulate a archive_meta transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  archive_meta: (options?: MethodOptions) => Promise<AssembledTransaction<ArchiveMeta>>

  /**
   * Construct and simulate a deposits_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposits_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a full_input_exit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Consumes selected inputs completely, without reserving output capacity.
   */
  full_input_exit: ({action, proof}: {action: WithdrawAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u128>>>

  /**
   * Construct and simulate a set_asset_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_asset_status: ({index, status}: {index: u32, status: AssetStatus}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a accept_asset_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  accept_asset_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pending_asset_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_asset_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a propose_asset_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_asset_admin: ({next}: {next: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_deposits_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_deposits_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {protocol_version, network_id, realm_id, guardian, asset_admin, poseidon2_parameter_hash, circuit_hash, verification_key_hash, tree_depth, root_window_ledgers, deployment_binding_hash}: {protocol_version: u32, network_id: Buffer, realm_id: Buffer, guardian: string, asset_admin: string, poseidon2_parameter_hash: Buffer, circuit_hash: Buffer, verification_key_hash: Buffer, tree_depth: u32, root_window_ledgers: u32, deployment_binding_hash: Buffer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({protocol_version, network_id, realm_id, guardian, asset_admin, poseidon2_parameter_hash, circuit_hash, verification_key_hash, tree_depth, root_window_ledgers, deployment_binding_hash}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAADURlcG9zaXRBY3Rpb24AAAAAAAAKAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAAAAAAADmRlcG9zaXRfc291cmNlAAAAAAATAAAAAAAAAAtudWxsaWZpZXJfMAAAAAPuAAAAIAAAAAAAAAALbnVsbGlmaWVyXzEAAAAD7gAAACAAAAAAAAAACG91dHB1dF8wAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAAAhvdXRwdXRfMQAAB9AAAAANT3V0cHV0UGFja2FnZQAAAAAAAAAAAAAIb3V0cHV0XzIAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAADHB1YmxpY192YWx1ZQAAAAY=",
        "AAAAAQAAAAAAAAAAAAAADU91dHB1dFBhY2thZ2UAAAAAAAADAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAARb3V0Z29pbmdfZW52ZWxvcGUAAAAAAAPuAAAAnQAAAAAAAAAScmVjaXBpZW50X2VudmVsb3BlAAAAAAPuAAAAtQ==",
        "AAAAAQAAAAAAAAAAAAAADlRyYW5zZmVyQWN0aW9uAAAAAAAIAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAAC251bGxpZmllcl8wAAAAA+4AAAAgAAAAAAAAAAtudWxsaWZpZXJfMQAAAAPuAAAAIAAAAAAAAAAIb3V0cHV0XzAAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAACG91dHB1dF8xAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAAAhvdXRwdXRfMgAAB9AAAAANT3V0cHV0UGFja2FnZQAAAAAAAAAAAAAMcHVibGljX3ZhbHVlAAAABg==",
        "AAAAAQAAAAAAAAAAAAAADldpdGhkcmF3QWN0aW9uAAAAAAAKAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAAC2Fzc2V0X2luZGV4AAAAAAQAAAAAAAAAC251bGxpZmllcl8wAAAAA+4AAAAgAAAAAAAAAAtudWxsaWZpZXJfMQAAAAPuAAAAIAAAAAAAAAAIb3V0cHV0XzAAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAACG91dHB1dF8xAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAAAhvdXRwdXRfMgAAB9AAAAANT3V0cHV0UGFja2FnZQAAAAAAAAAAAAAQcHVibGljX3JlY2lwaWVudAAAABMAAAAAAAAADHB1YmxpY192YWx1ZQAAAAY=",
        "AAAABAAAAAAAAAAAAAAACVBvb2xFcnJvcgAAAAAAABUAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAATVW5zdXBwb3J0ZWRQcm90b2NvbAAAAAACAAAAAAAAABRJbnZhbGlkQ29uZmlndXJhdGlvbgAAAAMAAAAAAAAADkRlcG9zaXRzUGF1c2VkAAAAAAAEAAAAAAAAABJJbnZhbGlkQWN0aW9uU2hhcGUAAAAAAAUAAAAAAAAAFE5vbmNhbm9uaWNhbEVuY29kaW5nAAAABgAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAcAAAAAAAAAC1Vua25vd25Sb290AAAAAAgAAAAAAAAAC1Jvb3RFeHBpcmVkAAAAAAkAAAAAAAAAFU51bGxpZmllckFscmVhZHlTcGVudAAAAAAAAAoAAAAAAAAAEUludmFsaWRDb21taXRtZW50AAAAAAAACwAAAAAAAAAMSW52YWxpZFByb29mAAAADAAAAAAAAAAIVHJlZUZ1bGwAAAANAAAAAAAAABNBY3Rpb25Db3VudE92ZXJmbG93AAAAAA4AAAAAAAAADkFyY2hpdmVDb3JydXB0AAAAAAAPAAAAAAAAABRVbmF1dGhvcml6ZWRHdWFyZGlhbgAAABAAAAAAAAAAFkFzc2V0QWxyZWFkeVJlZ2lzdGVyZWQAAAAAABEAAAAAAAAADFVua25vd25Bc3NldAAAABIAAAAAAAAADUFzc2V0RXhpdE9ubHkAAAAAAAATAAAAAAAAABJBc3NldEluZGV4T3ZlcmZsb3cAAAAAABQAAAAAAAAAE05vUGVuZGluZ0Fzc2V0QWRtaW4AAAAAFQ==",
        "AAAABQAAAAAAAAAAAAAACkFzc2V0QWRkZWQAAAAAAAEAAAALYXNzZXRfYWRkZWQAAAAAAgAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAAAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkRlcG9zaXRzUGF1c2VkAAAAAAABAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAAAAAAA=",
        "AAAABQAAAAAAAAAAAAAADlNoaWVsZGVkQWN0aW9uAAAAAAABAAAAD3NoaWVsZGVkX2FjdGlvbgAAAAABAAAAAAAAAAZyZWNvcmQAAAAAB9AAAAANQXJjaGl2ZVJlY29yZAAAAAAAAAAAAAAA",
        "AAAABQAAAAAAAAAAAAAAEUFzc2V0QWRtaW5DaGFuZ2VkAAAAAAAAAQAAABNhc3NldF9hZG1pbl9jaGFuZ2VkAAAAAAIAAAAAAAAACHByZXZpb3VzAAAAEwAAAAAAAAAAAAAAB2N1cnJlbnQAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEkFzc2V0QWRtaW5Qcm9wb3NlZAAAAAAAAQAAABRhc3NldF9hZG1pbl9wcm9wb3NlZAAAAAEAAAAAAAAABG5leHQAAAATAAAAAAAAAAA=",
        "AAAABQAAAAAAAAAAAAAAEkFzc2V0U3RhdHVzQ2hhbmdlZAAAAAAAAQAAAAxhc3NldF9zdGF0dXMAAAACAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAALQXNzZXRTdGF0dXMAAAAAAAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAAC0FyY2hpdmVNZXRhAAAAAAIAAAAAAAAADGFjdGlvbl9jb3VudAAAAAoAAAAAAAAAD3RyYW5zY3JpcHRfaGVhZAAAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAADUFyY2hpdmVSZWNvcmQAAAAAAAARAAAAAAAAAAxhY3Rpb25faW5kZXgAAAAKAAAAAAAAAAthY3Rpb25fa2luZAAAAAAEAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAABWFzc2V0AAAAAAAD6AAAABMAAAAAAAAAC2Fzc2V0X2luZGV4AAAAA+gAAAAEAAAAAAAAAA5kZXBvc2l0X3NvdXJjZQAAAAAD6AAAABMAAAAAAAAAD2xlZGdlcl9zZXF1ZW5jZQAAAAAEAAAAAAAAAAtudWxsaWZpZXJfMAAAAAPuAAAAIAAAAAAAAAALbnVsbGlmaWVyXzEAAAAD7gAAACAAAAAAAAAACG91dHB1dF8wAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAAAhvdXRwdXRfMQAAB9AAAAANT3V0cHV0UGFja2FnZQAAAAAAAAAAAAAIb3V0cHV0XzIAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAAEHB1YmxpY19yZWNpcGllbnQAAAPoAAAAEwAAAAAAAAAMcHVibGljX3ZhbHVlAAAABgAAAAAAAAATc3RhcnRpbmdfbGVhZl9pbmRleAAAAAAKAAAAAAAAAA90cmVlX3Jvb3RfYWZ0ZXIAAAAD7gAAACA=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADAAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAKQXNzZXRBZG1pbgAAAAAAAAAAAAAAAAARUGVuZGluZ0Fzc2V0QWRtaW4AAAAAAAAAAAAAAAAAAApBc3NldENvdW50AAAAAAABAAAAAAAAAA9SZWdpc3RlcmVkQXNzZXQAAAAAAQAAAAQAAAABAAAAAAAAABRSZWdpc3RlcmVkQXNzZXRJbmRleAAAAAEAAAATAAAAAAAAAAAAAAAMRGVwb3NpdFBhdXNlAAAAAAAAAAAAAAAEVHJlZQAAAAAAAAAAAAAABE1ldGEAAAABAAAAAAAAAAlOdWxsaWZpZXIAAAAAAAABAAAD7gAAACAAAAABAAAAAAAAAAlLbm93blJvb3QAAAAAAAABAAAD7gAAACAAAAABAAAAAAAAAA1BcmNoaXZlUmVjb3JkAAAAAAAAAQAAAAo=",
        "AAAAAQAAAAAAAAAAAAAACUtub3duUm9vdAAAAAAAAAIAAAAAAAAAEWNyZWF0ZWRfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAASdmFsaWRfdW50aWxfbGVkZ2VyAAAAAAAE",
        "AAAAAQAAAAAAAAAAAAAAClBvb2xDb25maWcAAAAAAA0AAAAAAAAADGNpcmN1aXRfaGFzaAAAA+4AAAAgAAAAAAAAAA1jb250ZXh0X2ZpZWxkAAAAAAAD7gAAACAAAAAAAAAADGNvbnRleHRfaGFzaAAAA+4AAAAgAAAAAAAAABdkZXBsb3ltZW50X2JpbmRpbmdfaGFzaAAAAAPuAAAAIAAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAAAAABNpbml0aWFsX2Fzc2V0X2FkbWluAAAAABMAAAAAAAAACm5ldHdvcmtfaWQAAAAAA+4AAAAgAAAAAAAAABhwb3NlaWRvbjJfcGFyYW1ldGVyX2hhc2gAAAPuAAAAIAAAAAAAAAAQcHJvdG9jb2xfdmVyc2lvbgAAAAQAAAAAAAAACHJlYWxtX2lkAAAD7gAAACAAAAAAAAAAE3Jvb3Rfd2luZG93X2xlZGdlcnMAAAAABAAAAAAAAAAKdHJlZV9kZXB0aAAAAAAABAAAAAAAAAAVdmVyaWZpY2F0aW9uX2tleV9oYXNoAAAAAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAAC0Fzc2V0Q29uZmlnAAAAAAQAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAALYXNzZXRfZmllbGQAAAAD7gAAACAAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAC0Fzc2V0U3RhdHVzAA==",
        "AAAAAgAAAAAAAAAAAAAAC0Fzc2V0U3RhdHVzAAAAAAIAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACEV4aXRPbmx5",
        "AAAAAQAAAAAAAAAAAAAAC1RyZWVTdG9yYWdlAAAAAAMAAAAAAAAADGN1cnJlbnRfcm9vdAAAA+4AAAAgAAAAAAAAAAhmcm9udGllcgAAA+oAAAPuAAAAIAAAAAAAAAAKbmV4dF9pbmRleAAAAAAACg==",
        "AAAAAQAAAAAAAAAAAAAADlNwZW50TnVsbGlmaWVyAAAAAAACAAAAAAAAAA9zcGVudF9hdF9hY3Rpb24AAAAACgAAAAAAAAAPc3BlbnRfYXRfbGVkZ2VyAAAAAAQ=",
        "AAAAAAAAAAAAAAAFYXNzZXQAAAAAAAABAAAAAAAAAAVpbmRleAAAAAAAAAQAAAABAAAD6QAAB9AAAAALQXNzZXRDb25maWcAAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAKUG9vbENvbmZpZwAA",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAANRGVwb3NpdEFjdGlvbgAAAAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAKAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAACAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAAOVHJhbnNmZXJBY3Rpb24AAAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAKAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAACAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAAOV2l0aGRyYXdBY3Rpb24AAAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAKAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAJYWRkX2Fzc2V0AAAAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAA+kAAAAEAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAMVSZS1yZWdpc3RlcnMgdGhlIGN1cnJlbnQgdHJlZSByb290IHdpdGhvdXQgbW92aW5nIHZhbHVlLiBUaGlzIGlzCnBlcm1pc3Npb25sZXNzIHNvIGFuIGlkbGUgcG9vbCByZW1haW5zIHNwZW5kYWJsZSB3aGlsZSBkZXBvc2l0cyBhcmUKcGF1c2VkLCBhbmQgcmVwZWF0ZWQgY2FsbHMgb25seSByZWZyZXNoIHRoZSBzYW1lIGNhbm9uaWNhbCByb290LgAAAAAAAAp0b3VjaF9yb290AAAAAAAAAAAAAQAAA+kAAAfQAAAACUtub3duUm9vdAAAAAAAB9AAAAAJUG9vbEVycm9yAAAA",
        "AAAAAAAAAAAAAAAKdHJlZV9zdGF0ZQAAAAAAAAAAAAEAAAfQAAAAC1RyZWVTdG9yYWdlAA==",
        "AAAAAAAAAAAAAAALYXNzZXRfYWRtaW4AAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAALYXNzZXRfY291bnQAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAALYXNzZXRfaW5kZXgAAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAA+gAAAAE",
        "AAAAAAAAAAAAAAAMYXJjaGl2ZV9tZXRhAAAAAAAAAAEAAAfQAAAAC0FyY2hpdmVNZXRhAA==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAsAAAAAAAAAEHByb3RvY29sX3ZlcnNpb24AAAAEAAAAAAAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAAAAAAAAIcmVhbG1faWQAAAPuAAAAIAAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAAAAAAthc3NldF9hZG1pbgAAAAATAAAAAAAAABhwb3NlaWRvbjJfcGFyYW1ldGVyX2hhc2gAAAPuAAAAIAAAAAAAAAAMY2lyY3VpdF9oYXNoAAAD7gAAACAAAAAAAAAAFXZlcmlmaWNhdGlvbl9rZXlfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAp0cmVlX2RlcHRoAAAAAAAEAAAAAAAAABNyb290X3dpbmRvd19sZWRnZXJzAAAAAAQAAAAAAAAAF2RlcGxveW1lbnRfYmluZGluZ19oYXNoAAAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAAAAAAAPZGVwb3NpdHNfcGF1c2VkAAAAAAAAAAABAAAAAQ==",
        "AAAAAAAAAEdDb25zdW1lcyBzZWxlY3RlZCBpbnB1dHMgY29tcGxldGVseSwgd2l0aG91dCByZXNlcnZpbmcgb3V0cHV0IGNhcGFjaXR5LgAAAAAPZnVsbF9pbnB1dF9leGl0AAAAAAIAAAAAAAAABmFjdGlvbgAAAAAH0AAAAA5XaXRoZHJhd0FjdGlvbgAAAAAAAAAAAAVwcm9vZgAAAAAAB9AAAAAFUHJvb2YAAAAAAAABAAAD6QAAAAoAAAfQAAAACVBvb2xFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAQc2V0X2Fzc2V0X3N0YXR1cwAAAAIAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAC0Fzc2V0U3RhdHVzAAAAAAEAAAPpAAAAAgAAB9AAAAAJUG9vbEVycm9yAAAA",
        "AAAAAAAAAAAAAAASYWNjZXB0X2Fzc2V0X2FkbWluAAAAAAAAAAAAAQAAA+kAAAACAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAATcGVuZGluZ19hc3NldF9hZG1pbgAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAAAAAAATcHJvcG9zZV9hc3NldF9hZG1pbgAAAAABAAAAAAAAAARuZXh0AAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAJUG9vbEVycm9yAAAA",
        "AAAAAAAAAAAAAAATc2V0X2RlcG9zaXRzX3BhdXNlZAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAfQAAAACVBvb2xFcnJvcgAAAA==",
        "AAAAAQAAAAAAAAAAAAAABVByb29mAAAAAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    asset: this.txFromJSON<Result<AssetConfig>>,
        config: this.txFromJSON<PoolConfig>,
        deposit: this.txFromJSON<Result<u128>>,
        transfer: this.txFromJSON<Result<u128>>,
        withdraw: this.txFromJSON<Result<u128>>,
        add_asset: this.txFromJSON<Result<u32>>,
        touch_root: this.txFromJSON<Result<KnownRoot>>,
        tree_state: this.txFromJSON<TreeStorage>,
        asset_admin: this.txFromJSON<string>,
        asset_count: this.txFromJSON<u32>,
        asset_index: this.txFromJSON<Option<u32>>,
        archive_meta: this.txFromJSON<ArchiveMeta>,
        deposits_paused: this.txFromJSON<boolean>,
        full_input_exit: this.txFromJSON<Result<u128>>,
        set_asset_status: this.txFromJSON<Result<void>>,
        accept_asset_admin: this.txFromJSON<Result<void>>,
        pending_asset_admin: this.txFromJSON<Option<string>>,
        propose_asset_admin: this.txFromJSON<Result<void>>,
        set_deposits_paused: this.txFromJSON<Result<void>>
  }
}