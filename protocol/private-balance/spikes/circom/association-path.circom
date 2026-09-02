pragma circom 2.1.6;

include "../../circuits/circom/merkle.circom";

// Measures the exact marginal R1CS cost of proving membership in one
// additional depth-17 ternary tree. This is an experiment, not a production
// association-set circuit.
template AssociationPathSpike() {
    signal input expectedRoot;
    signal input leaf;
    signal input leafIndex;
    signal input siblings[17][2];
    signal input positions[17];

    component path = MerklePath(17);
    path.leaf <== leaf;
    path.leafIndex <== leafIndex;
    for (var level = 0; level < 17; level++) {
        path.siblings[level][0] <== siblings[level][0];
        path.siblings[level][1] <== siblings[level][1];
        path.positions[level] <== positions[level];
    }
    path.root === expectedRoot;
}

component main { public [expectedRoot] } = AssociationPathSpike();
