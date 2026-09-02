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
  deposit_source: string;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
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
  public_value: u64;
  relayer: string;
  relayer_fee: u64;
}


export interface WithdrawAction {
  action_nonce: Buffer;
  anchor_root: Buffer;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
  public_recipient: string;
  public_value: u64;
  relayer: string;
  relayer_fee: u64;
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
  14: {message:"ArchivePageLimit"},
  15: {message:"ArchiveCorrupt"},
  16: {message:"UnauthorizedGuardian"}
}




export interface ArchiveMeta {
  action_count: u32;
  transcript_head: Buffer;
}


export interface ArchiveRecord {
  action_index: u32;
  action_kind: u32;
  action_nonce: Buffer;
  anchor_root: Buffer;
  asset: string;
  deposit_source: Option<string>;
  ledger_sequence: u32;
  nullifier_0: Buffer;
  nullifier_1: Buffer;
  output_0: OutputPackage;
  output_1: OutputPackage;
  public_recipient: Option<string>;
  public_value: u64;
  relayer: Option<string>;
  relayer_fee: u64;
  starting_leaf_index: u32;
  tree_root_after: Buffer;
}

export type DataKey = {tag: "Config", values: void} | {tag: "Asset", values: void} | {tag: "DepositPause", values: void} | {tag: "Tree", values: void} | {tag: "Meta", values: void} | {tag: "Nullifier", values: readonly [Buffer]} | {tag: "KnownRoot", values: readonly [Buffer]} | {tag: "ArchiveRecord", values: readonly [u32]};


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
  network_id: Buffer;
  page_capacity: u32;
  poseidon2_parameter_hash: Buffer;
  protocol_version: u32;
  realm_id: Buffer;
  root_window_ledgers: u32;
  tree_depth: u32;
  verification_key_hash: Buffer;
}


export interface TreeStorage {
  current_root: Buffer;
  frontier: Array<Buffer>;
  next_index: u64;
}


export interface SpentNullifier {
  spent_at_action: u32;
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
  asset: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config: (options?: MethodOptions) => Promise<AssembledTransaction<PoolConfig>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({action, proof}: {action: DepositAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transfer: ({action, proof}: {action: TransferAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw: ({action, proof}: {action: WithdrawAction, proof: Proof}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a tree_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  tree_state: (options?: MethodOptions) => Promise<AssembledTransaction<TreeStorage>>

  /**
   * Construct and simulate a archive_meta transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  archive_meta: (options?: MethodOptions) => Promise<AssembledTransaction<ArchiveMeta>>

  /**
   * Construct and simulate a deposits_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposits_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a set_deposits_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_deposits_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {protocol_version, network_id, realm_id, guardian, asset, poseidon2_parameter_hash, circuit_hash, verification_key_hash, tree_depth, root_window_ledgers, page_capacity, deployment_binding_hash}: {protocol_version: u32, network_id: Buffer, realm_id: Buffer, guardian: string, asset: string, poseidon2_parameter_hash: Buffer, circuit_hash: Buffer, verification_key_hash: Buffer, tree_depth: u32, root_window_ledgers: u32, page_capacity: u32, deployment_binding_hash: Buffer},
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
    return ContractClient.deploy({protocol_version, network_id, realm_id, guardian, asset, poseidon2_parameter_hash, circuit_hash, verification_key_hash, tree_depth, root_window_ledgers, page_capacity, deployment_binding_hash}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAADURlcG9zaXRBY3Rpb24AAAAAAAAIAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAADmRlcG9zaXRfc291cmNlAAAAAAATAAAAAAAAAAtudWxsaWZpZXJfMAAAAAPuAAAAIAAAAAAAAAALbnVsbGlmaWVyXzEAAAAD7gAAACAAAAAAAAAACG91dHB1dF8wAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAAAhvdXRwdXRfMQAAB9AAAAANT3V0cHV0UGFja2FnZQAAAAAAAAAAAAAMcHVibGljX3ZhbHVlAAAABg==",
        "AAAAAQAAAAAAAAAAAAAADU91dHB1dFBhY2thZ2UAAAAAAAADAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAARb3V0Z29pbmdfZW52ZWxvcGUAAAAAAAPuAAAAnQAAAAAAAAAScmVjaXBpZW50X2VudmVsb3BlAAAAAAPuAAAAtQ==",
        "AAAAAQAAAAAAAAAAAAAADlRyYW5zZmVyQWN0aW9uAAAAAAAJAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAAC251bGxpZmllcl8wAAAAA+4AAAAgAAAAAAAAAAtudWxsaWZpZXJfMQAAAAPuAAAAIAAAAAAAAAAIb3V0cHV0XzAAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAACG91dHB1dF8xAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAAAxwdWJsaWNfdmFsdWUAAAAGAAAAAAAAAAdyZWxheWVyAAAAABMAAAAAAAAAC3JlbGF5ZXJfZmVlAAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAADldpdGhkcmF3QWN0aW9uAAAAAAAKAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAAC251bGxpZmllcl8wAAAAA+4AAAAgAAAAAAAAAAtudWxsaWZpZXJfMQAAAAPuAAAAIAAAAAAAAAAIb3V0cHV0XzAAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAACG91dHB1dF8xAAAH0AAAAA1PdXRwdXRQYWNrYWdlAAAAAAAAAAAAABBwdWJsaWNfcmVjaXBpZW50AAAAEwAAAAAAAAAMcHVibGljX3ZhbHVlAAAABgAAAAAAAAAHcmVsYXllcgAAAAATAAAAAAAAAAtyZWxheWVyX2ZlZQAAAAAG",
        "AAAABAAAAAAAAAAAAAAACVBvb2xFcnJvcgAAAAAAABAAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAAAAAAATVW5zdXBwb3J0ZWRQcm90b2NvbAAAAAACAAAAAAAAABRJbnZhbGlkQ29uZmlndXJhdGlvbgAAAAMAAAAAAAAADkRlcG9zaXRzUGF1c2VkAAAAAAAEAAAAAAAAABJJbnZhbGlkQWN0aW9uU2hhcGUAAAAAAAUAAAAAAAAAFE5vbmNhbm9uaWNhbEVuY29kaW5nAAAABgAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAcAAAAAAAAAC1Vua25vd25Sb290AAAAAAgAAAAAAAAAC1Jvb3RFeHBpcmVkAAAAAAkAAAAAAAAAFU51bGxpZmllckFscmVhZHlTcGVudAAAAAAAAAoAAAAAAAAAEUludmFsaWRDb21taXRtZW50AAAAAAAACwAAAAAAAAAMSW52YWxpZFByb29mAAAADAAAAAAAAAAIVHJlZUZ1bGwAAAANAAAAAAAAABBBcmNoaXZlUGFnZUxpbWl0AAAADgAAAAAAAAAOQXJjaGl2ZUNvcnJ1cHQAAAAAAA8AAAAAAAAAFFVuYXV0aG9yaXplZEd1YXJkaWFuAAAAEA==",
        "AAAABQAAAAAAAAAAAAAADkRlcG9zaXRzUGF1c2VkAAAAAAABAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAAAAAAA=",
        "AAAABQAAAAAAAAAAAAAADlNoaWVsZGVkQWN0aW9uAAAAAAABAAAAD3NoaWVsZGVkX2FjdGlvbgAAAAABAAAAAAAAAAZyZWNvcmQAAAAAB9AAAAANQXJjaGl2ZVJlY29yZAAAAAAAAAAAAAAA",
        "AAAAAQAAAAAAAAAAAAAAC0FyY2hpdmVNZXRhAAAAAAIAAAAAAAAADGFjdGlvbl9jb3VudAAAAAQAAAAAAAAAD3RyYW5zY3JpcHRfaGVhZAAAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAADUFyY2hpdmVSZWNvcmQAAAAAAAARAAAAAAAAAAxhY3Rpb25faW5kZXgAAAAEAAAAAAAAAAthY3Rpb25fa2luZAAAAAAEAAAAAAAAAAxhY3Rpb25fbm9uY2UAAAPuAAAAIAAAAAAAAAALYW5jaG9yX3Jvb3QAAAAD7gAAACAAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAOZGVwb3NpdF9zb3VyY2UAAAAAA+gAAAATAAAAAAAAAA9sZWRnZXJfc2VxdWVuY2UAAAAABAAAAAAAAAALbnVsbGlmaWVyXzAAAAAD7gAAACAAAAAAAAAAC251bGxpZmllcl8xAAAAA+4AAAAgAAAAAAAAAAhvdXRwdXRfMAAAB9AAAAANT3V0cHV0UGFja2FnZQAAAAAAAAAAAAAIb3V0cHV0XzEAAAfQAAAADU91dHB1dFBhY2thZ2UAAAAAAAAAAAAAEHB1YmxpY19yZWNpcGllbnQAAAPoAAAAEwAAAAAAAAAMcHVibGljX3ZhbHVlAAAABgAAAAAAAAAHcmVsYXllcgAAAAPoAAAAEwAAAAAAAAALcmVsYXllcl9mZWUAAAAABgAAAAAAAAATc3RhcnRpbmdfbGVhZl9pbmRleAAAAAAEAAAAAAAAAA90cmVlX3Jvb3RfYWZ0ZXIAAAAD7gAAACA=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACAAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAFQXNzZXQAAAAAAAAAAAAAAAAAAAxEZXBvc2l0UGF1c2UAAAAAAAAAAAAAAARUcmVlAAAAAAAAAAAAAAAETWV0YQAAAAEAAAAAAAAACU51bGxpZmllcgAAAAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAACUtub3duUm9vdAAAAAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAADUFyY2hpdmVSZWNvcmQAAAAAAAABAAAABA==",
        "AAAAAQAAAAAAAAAAAAAACUtub3duUm9vdAAAAAAAAAIAAAAAAAAAEWNyZWF0ZWRfYXRfbGVkZ2VyAAAAAAAABAAAAAAAAAASdmFsaWRfdW50aWxfbGVkZ2VyAAAAAAAE",
        "AAAAAQAAAAAAAAAAAAAAClBvb2xDb25maWcAAAAAAA0AAAAAAAAADGNpcmN1aXRfaGFzaAAAA+4AAAAgAAAAAAAAAA1jb250ZXh0X2ZpZWxkAAAAAAAD7gAAACAAAAAAAAAADGNvbnRleHRfaGFzaAAAA+4AAAAgAAAAAAAAABdkZXBsb3ltZW50X2JpbmRpbmdfaGFzaAAAAAPuAAAAIAAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAAAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAAAAAAAANcGFnZV9jYXBhY2l0eQAAAAAAAAQAAAAAAAAAGHBvc2VpZG9uMl9wYXJhbWV0ZXJfaGFzaAAAA+4AAAAgAAAAAAAAABBwcm90b2NvbF92ZXJzaW9uAAAABAAAAAAAAAAIcmVhbG1faWQAAAPuAAAAIAAAAAAAAAATcm9vdF93aW5kb3dfbGVkZ2VycwAAAAAEAAAAAAAAAAp0cmVlX2RlcHRoAAAAAAAEAAAAAAAAABV2ZXJpZmljYXRpb25fa2V5X2hhc2gAAAAAAAPuAAAAIA==",
        "AAAAAQAAAAAAAAAAAAAAC1RyZWVTdG9yYWdlAAAAAAMAAAAAAAAADGN1cnJlbnRfcm9vdAAAA+4AAAAgAAAAAAAAAAhmcm9udGllcgAAA+oAAAPuAAAAIAAAAAAAAAAKbmV4dF9pbmRleAAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAADlNwZW50TnVsbGlmaWVyAAAAAAACAAAAAAAAAA9zcGVudF9hdF9hY3Rpb24AAAAABAAAAAAAAAAPc3BlbnRfYXRfbGVkZ2VyAAAAAAQ=",
        "AAAAAAAAAAAAAAAFYXNzZXQAAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAKUG9vbENvbmZpZwAA",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAANRGVwb3NpdEFjdGlvbgAAAAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAEAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAACAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAAOVHJhbnNmZXJBY3Rpb24AAAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAEAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAId2l0aGRyYXcAAAACAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAAOV2l0aGRyYXdBY3Rpb24AAAAAAAAAAAAFcHJvb2YAAAAAAAfQAAAABVByb29mAAAAAAAAAQAAA+kAAAAEAAAH0AAAAAlQb29sRXJyb3IAAAA=",
        "AAAAAAAAAAAAAAAKdHJlZV9zdGF0ZQAAAAAAAAAAAAEAAAfQAAAAC1RyZWVTdG9yYWdlAA==",
        "AAAAAAAAAAAAAAAMYXJjaGl2ZV9tZXRhAAAAAAAAAAEAAAfQAAAAC0FyY2hpdmVNZXRhAA==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAwAAAAAAAAAEHByb3RvY29sX3ZlcnNpb24AAAAEAAAAAAAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAAAAAAAAIcmVhbG1faWQAAAPuAAAAIAAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAGHBvc2VpZG9uMl9wYXJhbWV0ZXJfaGFzaAAAA+4AAAAgAAAAAAAAAAxjaXJjdWl0X2hhc2gAAAPuAAAAIAAAAAAAAAAVdmVyaWZpY2F0aW9uX2tleV9oYXNoAAAAAAAD7gAAACAAAAAAAAAACnRyZWVfZGVwdGgAAAAAAAQAAAAAAAAAE3Jvb3Rfd2luZG93X2xlZGdlcnMAAAAABAAAAAAAAAANcGFnZV9jYXBhY2l0eQAAAAAAAAQAAAAAAAAAF2RlcGxveW1lbnRfYmluZGluZ19oYXNoAAAAA+4AAAAgAAAAAA==",
        "AAAAAAAAAAAAAAAPZGVwb3NpdHNfcGF1c2VkAAAAAAAAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAATc2V0X2RlcG9zaXRzX3BhdXNlZAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAfQAAAACVBvb2xFcnJvcgAAAA==",
        "AAAAAQAAAAAAAAAAAAAABVByb29mAAAAAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    asset: this.txFromJSON<string>,
        config: this.txFromJSON<PoolConfig>,
        deposit: this.txFromJSON<Result<u32>>,
        transfer: this.txFromJSON<Result<u32>>,
        withdraw: this.txFromJSON<Result<u32>>,
        tree_state: this.txFromJSON<TreeStorage>,
        archive_meta: this.txFromJSON<ArchiveMeta>,
        deposits_paused: this.txFromJSON<boolean>,
        set_deposits_paused: this.txFromJSON<Result<void>>
  }
}