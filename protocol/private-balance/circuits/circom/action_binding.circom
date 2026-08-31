pragma circom 2.1.6;

include "poseidon2.circom";

template ActionBinding() {
    signal input contextField;
    signal input actionField;
    signal output out;

    var DOMAIN_ACTION_BINDING = 17365170631394812078082042073070794658064087641845391218072061672105615249472;

    component hasher = Poseidon2Hash(3);
    hasher.in[0] <== DOMAIN_ACTION_BINDING;
    hasher.in[1] <== contextField;
    hasher.in[2] <== actionField;

    out <== hasher.out;
}
