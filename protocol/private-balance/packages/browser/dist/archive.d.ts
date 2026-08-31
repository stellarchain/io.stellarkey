import { OutputPackageModel } from './action.js';
import { MerkleTree } from './tree.js';
export declare const DOMAIN_ARCHIVE_RECORD = "SKSB_ARCHIVE_RECORD_V1";
export declare const DOMAIN_ARCHIVE_GENESIS = "SKSB_ARCHIVE_GENESIS_V1";
export interface ArchiveRecordModel {
    actionIndex: number;
    ledgerSequence: number;
    startingLeafIndex: number;
    actionKind: number;
    asset: {
        kind: number;
        payload: Uint8Array;
    };
    actionNonce: Uint8Array;
    anchorRoot: Uint8Array;
    treeRootAfter: Uint8Array;
    nullifiers: [Uint8Array, Uint8Array];
    outputs: [OutputPackageModel, OutputPackageModel];
    publicValue: bigint;
    depositSource?: {
        kind: number;
        payload: Uint8Array;
    };
    publicRecipient?: {
        kind: number;
        payload: Uint8Array;
    };
    relayerFee: bigint;
    relayer?: {
        kind: number;
        payload: Uint8Array;
    };
}
export declare function computeRecordHash(record: ArchiveRecordModel, protocolVersion: number, priorRecordHash: Uint8Array): Uint8Array;
export declare function computeGenesisRecordHash(contextHash: Uint8Array, deploymentBindingHash: Uint8Array): Uint8Array;
export declare function applyArchiveRecord(tree: MerkleTree, record: ArchiveRecordModel): Promise<Uint8Array>;
