pragma circom 2.1.6;

include "poseidon2.circom";

template OwnerCommitment() {
    signal input contextField;
    signal input ask;
    signal input nk;
    signal output out;

    var DOMAIN_OWNER = 6572291656506234975797969757609184236602078616932335549748672120887455719780;

    component hasher = Poseidon2Hash(4);
    hasher.in[0] <== DOMAIN_OWNER;
    hasher.in[1] <== contextField;
    hasher.in[2] <== ask;
    hasher.in[3] <== nk;

    out <== hasher.out;
}

template DiversifiedOwnerCommitment() {
    signal input baseOwnerCommitment;
    signal input diversifier;
    signal output out;

    var DOMAIN_DIVERSIFIED_OWNER = 10092330331475627654316475538447767172665893934138852183807994260952964801257;
    component hasher = Poseidon2Hash(3);
    hasher.in[0] <== DOMAIN_DIVERSIFIED_OWNER;
    hasher.in[1] <== baseOwnerCommitment;
    hasher.in[2] <== diversifier;
    out <== hasher.out;
}
