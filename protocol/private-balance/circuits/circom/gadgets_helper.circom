pragma circom 2.1.6;

include "poseidon2.circom";
include "owner.circom";
include "note.circom";
include "nullifier.circom";
include "merkle.circom";
include "action_binding.circom";

template GadgetsHelper() {
    signal input contextField;
    signal input assetField;
    signal input ask;
    signal input nk;
    signal input diversifier;
    signal input rho;
    signal input value;
    signal input leafIndex;
    signal input siblings[32];
    signal input directionBits[32];
    signal input actionField;

    signal output ownerCommitment;
    signal output noteCommitment;
    signal output nullifier;
    signal output actionBinding;
    signal output merkleRoot;

    component oc = OwnerCommitment();
    oc.contextField <== contextField;
    oc.ask <== ask;
    oc.nk <== nk;
    component diversifiedOwner = DiversifiedOwnerCommitment();
    diversifiedOwner.baseOwnerCommitment <== oc.out;
    diversifiedOwner.diversifier <== diversifier;
    ownerCommitment <== diversifiedOwner.out;

    component nc = NoteCommitment();
    nc.contextField <== contextField;
    nc.assetField <== assetField;
    nc.ownerCommitment <== diversifiedOwner.out;
    nc.value <== value;
    nc.rho <== rho;
    noteCommitment <== nc.out;

    component nf = Nullifier();
    nf.contextField <== contextField;
    nf.nk <== nk;
    nf.rho <== rho;
    nf.leafIndex <== leafIndex;
    nf.cm <== nc.out;
    nullifier <== nf.out;

    component ab = ActionBinding();
    ab.contextField <== contextField;
    ab.actionField <== actionField;
    actionBinding <== ab.out;

    component mp = MerklePath(32);
    mp.leaf <== nc.out;
    mp.leafIndex <== leafIndex;
    for (var i = 0; i < 32; i++) {
        mp.siblings[i] <== siblings[i];
        mp.directionBits[i] <== directionBits[i];
    }
    merkleRoot <== mp.root;
}

component main = GadgetsHelper();
