pragma circom 2.1.6;
include "merkle.circom";

// Both the subtree root and its position remain private. The composed path is
// exactly one ternary tree; there is no public source-tree selector or registry.
template HierarchyPath(INNER, OUTER) {
    signal input leaf;
    signal input leafIndex;
    signal input siblings[INNER + OUTER][2];
    signal input positions[INNER + OUTER];
    signal output root;
    component inner = MerklePath(INNER);
    component outer = MerklePath(OUTER);
    var localIndex = 0;
    var subtree = 0;
    var power = 1;
    for (var i = 0; i < INNER; i++) {
        localIndex += positions[i] * power;
        power *= 3;
        inner.positions[i] <== positions[i];
        inner.siblings[i][0] <== siblings[i][0];
        inner.siblings[i][1] <== siblings[i][1];
    }
    var innerCapacity = power;
    power = 1;
    for (var i = 0; i < OUTER; i++) {
        subtree += positions[INNER + i] * power;
        power *= 3;
        outer.positions[i] <== positions[INNER + i];
        outer.siblings[i][0] <== siblings[INNER + i][0];
        outer.siblings[i][1] <== siblings[INNER + i][1];
    }
    inner.leaf <== leaf;
    inner.leafIndex <== localIndex;
    outer.leaf <== inner.root;
    outer.leafIndex <== subtree;
    leafIndex === localIndex + subtree * innerCapacity;
    root <== outer.root;
}
