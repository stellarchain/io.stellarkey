pragma circom 2.1.6;

include "poseidon2.circom";

template Nullifier() {
    signal input contextField;
    signal input nk;
    signal input rho;
    signal input leafIndex;
    signal input cm;
    signal output out;

    var DOMAIN_NULLIFIER = 18852096319358378764148341035066066019156424927623416075041018694204746208236;

    component hasher = Poseidon2Hash(6);
    hasher.in[0] <== DOMAIN_NULLIFIER;
    hasher.in[1] <== contextField;
    hasher.in[2] <== nk;
    hasher.in[3] <== rho;
    hasher.in[4] <== leafIndex;
    hasher.in[5] <== cm;

    out <== hasher.out;
}

template DummyNullifier() {
    signal input contextField;
    signal input dummySecret;
    signal output out;

    var DOMAIN_DUMMY_NULLIFIER = 11079287110993094273924039464477300343037036643499336743423997609200409937317;

    component hasher = Poseidon2Hash(3);
    hasher.in[0] <== DOMAIN_DUMMY_NULLIFIER;
    hasher.in[1] <== contextField;
    hasher.in[2] <== dummySecret;

    out <== hasher.out;
}
