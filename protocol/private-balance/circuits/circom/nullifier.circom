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
