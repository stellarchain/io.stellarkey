pragma circom 2.1.6;

include "poseidon2.circom";

// A Merkle node occupies the full three-element Poseidon2 rate. The sponge's
// length IV separates by arity only. Every other arity-three protocol hash must
// reserve rate slot zero for its domain constant; this raw construction relies
// on Poseidon2 preimage and collision resistance to keep those constants from
// being engineered as reachable leaves or nodes.
template MerkleParent() {
    signal input children[3];
    signal output out;

    component hasher = Poseidon2Hash(3);
    for (var i = 0; i < 3; i++) {
        hasher.in[i] <== children[i];
    }

    out <== hasher.out;
}

template MerklePath(DEPTH) {
    signal input leaf;
    signal input leafIndex;
    // Siblings are ordered by child position with the current child omitted.
    signal input siblings[DEPTH][2];
    signal input positions[DEPTH];
    signal output root;

    var acc = 0;
    var power = 1;
    for (var i = 0; i < DEPTH; i++) {
        acc += positions[i] * power;
        power *= 3;
    }
    leafIndex === acc;

    signal current[DEPTH + 1];
    current[0] <== leaf;

    component parent[DEPTH];
    signal positionTimesPrevious[DEPTH];
    signal positionMinusOneTimesMinusTwo[DEPTH];
    signal children[DEPTH][3];

    for (var level = 0; level < DEPTH; level++) {
        // Enforce position in {0, 1, 2}. The quadratic terms also select the
        // current node's position among its two ordered siblings.
        positionTimesPrevious[level] <== positions[level] * (positions[level] - 1);
        positionMinusOneTimesMinusTwo[level] <==
            (positions[level] - 1) * (positions[level] - 2);
        positionTimesPrevious[level] * (positions[level] - 2) === 0;

        children[level][0] <== siblings[level][0]
            + positionMinusOneTimesMinusTwo[level]
                * (current[level] - siblings[level][0]) / 2;
        children[level][2] <== siblings[level][1]
            + positionTimesPrevious[level]
                * (current[level] - siblings[level][1]) / 2;
        children[level][1] <== current[level]
            + siblings[level][0]
            + siblings[level][1]
            - children[level][0]
            - children[level][2];

        parent[level] = MerkleParent();
        for (var child = 0; child < 3; child++) {
            parent[level].children[child] <== children[level][child];
        }
        current[level + 1] <== parent[level].out;
    }

    root <== current[DEPTH];
}
