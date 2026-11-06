export declare const DOMAIN_ACTION = "SKSB_ACTION_V1";
export declare const DOMAIN_ASSET = "SKSB_ASSET_V1";
export interface OutputPackageModel {
    cm: Uint8Array;
    recipientEnvelope: Uint8Array;
    outgoingEnvelope: Uint8Array;
}
export interface ActionModel {
    protocolVersion: number;
    assetIndex?: number;
    asset?: {
        kind: number;
        payload: Uint8Array;
    };
    actionNonce: Uint8Array;
    anchorRoot: Uint8Array;
    nullifiers: [Uint8Array, Uint8Array];
    outputs: [OutputPackageModel, OutputPackageModel, OutputPackageModel];
    publicInflow: bigint;
    publicOutflow: bigint;
    appends: boolean;
    depositSource?: {
        kind: number;
        payload: Uint8Array;
    };
    publicRecipient?: {
        kind: number;
        payload: Uint8Array;
    };
}
export declare function serializeCanonicalActionBytes(action: ActionModel, networkId: Uint8Array, realmId: Uint8Array, poolId: Uint8Array): Uint8Array;
export declare function computeAssetField(asset: {
    kind: number;
    payload: Uint8Array;
}): Uint8Array;
export declare function computeActionField(action: ActionModel, networkId: Uint8Array, realmId: Uint8Array, poolId: Uint8Array): Uint8Array;
export declare function computePublicSignals(action: ActionModel, contextField: Uint8Array, networkId: Uint8Array, realmId: Uint8Array, poolId: Uint8Array): Promise<Uint8Array[]>;
