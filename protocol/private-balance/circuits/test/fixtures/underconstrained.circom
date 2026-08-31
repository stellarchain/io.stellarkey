pragma circom 2.1.6;

// Negative control for Gate A. This circuit must never pass under-constraint
// analysis: for any non-zero input, several (factor, quotient) witnesses
// satisfy the same public input while producing different public outputs.
template UnderconstrainedFixture() {
    signal input in;
    signal output out;
    signal factor;
    signal quotient;

    factor <-- 1;
    quotient <-- in;
    factor * quotient === in;
    out <== factor;
}

component main = UnderconstrainedFixture();
