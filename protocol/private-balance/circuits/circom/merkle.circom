pragma circom 2.1.6;

include "poseidon2.circom";

template MerkleParent() {
    signal input left;
    signal input right;
    signal output out;

    var DOMAIN_MERKLE_NODE = 18262065479814931418220923048312940830101943692329133834232213395922016996904;

    component hasher = Poseidon2Hash(3);
    hasher.in[0] <== DOMAIN_MERKLE_NODE;
    hasher.in[1] <== left;
    hasher.in[2] <== right;

    out <== hasher.out;
}

template MerklePath(DEPTH) {
    signal input leaf;
    signal input leafIndex;
    signal input siblings[DEPTH];
    signal input directionBits[DEPTH];
    signal output root;

    var acc = 0;
    for (var i = 0; i < DEPTH; i++) {
        directionBits[i] * (1 - directionBits[i]) === 0;
        acc += directionBits[i] * (1 << i);
    }
    leafIndex === acc;

    signal current[DEPTH + 1];
    current[0] <== leaf;

    component parent[DEPTH];
    signal left[DEPTH];
    signal right[DEPTH];

    for (var l = 0; l < DEPTH; l++) {
        parent[l] = MerkleParent();
        
        left[l] <== current[l] + directionBits[l] * (siblings[l] - current[l]);
        right[l] <== siblings[l] + directionBits[l] * (current[l] - siblings[l]);

        parent[l].left <== left[l];
        parent[l].right <== right[l];

        current[l + 1] <== parent[l].out;
    }

    root <== current[DEPTH];
}
