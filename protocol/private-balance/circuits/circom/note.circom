pragma circom 2.1.6;

include "poseidon2.circom";

template NoteCommitment() {
    signal input contextField;
    signal input assetField;
    signal input ownerCommitment;
    signal input value;
    signal input rho;
    signal output out;

    var DOMAIN_NOTE_COMMITMENT = 12305356573583967990145829509939363390395175012772578063495555266515310494866;

    component hasher = Poseidon2Hash(6);
    hasher.in[0] <== DOMAIN_NOTE_COMMITMENT;
    hasher.in[1] <== contextField;
    hasher.in[2] <== assetField;
    hasher.in[3] <== ownerCommitment;
    hasher.in[4] <== value;
    hasher.in[5] <== rho;

    out <== hasher.out;
}
