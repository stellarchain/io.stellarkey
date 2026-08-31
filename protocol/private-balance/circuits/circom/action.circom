pragma circom 2.1.6;

include "poseidon2.circom";
include "owner.circom";
include "note.circom";
include "nullifier.circom";
include "merkle.circom";
include "action_binding.circom";

template IsZero() {
    signal input in;
    signal output out;

    signal inv;
    inv <-- in != 0 ? 1 / in : 0;
    out <== 1 - in * inv;
    in * out === 0;
}

template CheckBits(BITS) {
    signal input in;
    signal bits[BITS];
    var acc = 0;

    for (var i = 0; i < BITS; i++) {
        bits[i] <-- (in >> i) & 1;
        bits[i] * (1 - bits[i]) === 0;
        acc += bits[i] * (1 << i);
    }
    in === acc;
}

template ActionCircuit() {
    // The verifier receives exactly these thirteen public signals, in this order.
    signal input contextField;
    signal input assetField;
    signal input actionKindField;
    signal input anchorRoot;
    signal input publicValueField;
    signal input relayerFeeField;
    signal input relayerField;
    signal input actionField;
    signal input actionBinding;
    signal input nullifier[2];
    signal input outputCommitment[2];

    // One spending authority controls every real input in an action.
    signal input ask;
    signal input nk;

    signal input inputEnabled[2];
    signal input inputOwnerCommitment[2];
    signal input inputDiversifier[2];
    signal input inputValue[2];
    signal input inputRho[2];
    signal input inputLeafIndex[2];
    signal input inputSiblings[2][32];
    signal input inputDirectionBits[2][32];

    signal input outputEnabled[2];
    signal input outputOwnerCommitment[2];
    signal input outputValue[2];
    signal input outputRho[2];

    component binding = ActionBinding();
    binding.contextField <== contextField;
    binding.actionField <== actionField;
    binding.out === actionBinding;

    component assetZero = IsZero();
    assetZero.in <== assetField;
    assetZero.out === 0;

    // actionKindField must be exactly Deposit (1), Transfer (2), or Withdraw (3).
    signal kindMinusOne;
    signal kindMinusTwo;
    signal kindMinusThree;
    signal kindProduct;
    kindMinusOne <== actionKindField - 1;
    kindMinusTwo <== actionKindField - 2;
    kindMinusThree <== actionKindField - 3;
    kindProduct <== kindMinusOne * kindMinusTwo;
    kindProduct * kindMinusThree === 0;

    component depositKind = IsZero();
    component transferKind = IsZero();
    component withdrawKind = IsZero();
    depositKind.in <== kindMinusOne;
    transferKind.in <== kindMinusTwo;
    withdrawKind.in <== kindMinusThree;
    signal isDeposit;
    signal isTransfer;
    signal isWithdraw;
    isDeposit <== depositKind.out;
    isTransfer <== transferKind.out;
    isWithdraw <== withdrawKind.out;
    isDeposit + isTransfer + isWithdraw === 1;

    component publicValueRange = CheckBits(63);
    component publicValueZero = IsZero();
    publicValueRange.in <== publicValueField;
    publicValueZero.in <== publicValueField;
    component relayerFeeRange = CheckBits(63);
    component relayerFieldZero = IsZero();
    relayerFeeRange.in <== relayerFeeField;
    relayerFieldZero.in <== relayerField;

    // Shared owner authorization is computed once and selected by every real input.
    component actionOwner = OwnerCommitment();
    actionOwner.contextField <== contextField;
    actionOwner.ask <== ask;
    actionOwner.nk <== nk;

    component askZero = IsZero();
    component nkZero = IsZero();
    askZero.in <== ask;
    nkZero.in <== nk;

    component inputValueRange[2];
    component inputValueZero[2];
    component inputOwnerZero[2];
    component inputRhoZero[2];
    component inputNullifierZero[2];
    component inputNote[2];
    component inputNullifier[2];
    component inputPath[2];
    component inputDiversifierRange[2];
    component inputDiversifiedOwner[2];
    signal inputDisabled[2];

    for (var i = 0; i < 2; i++) {
        inputEnabled[i] * (1 - inputEnabled[i]) === 0;
        inputDisabled[i] <== 1 - inputEnabled[i];

        inputValueRange[i] = CheckBits(63);
        inputValueRange[i].in <== inputValue[i];
        inputValueZero[i] = IsZero();
        inputValueZero[i].in <== inputValue[i];
        inputOwnerZero[i] = IsZero();
        inputOwnerZero[i].in <== inputOwnerCommitment[i];
        inputRhoZero[i] = IsZero();
        inputRhoZero[i].in <== inputRho[i];
        inputNullifierZero[i] = IsZero();
        inputNullifierZero[i].in <== nullifier[i];

        // A disabled lane is the unique all-zero dummy representation.
        inputDisabled[i] * inputValue[i] === 0;
        inputDisabled[i] * inputOwnerCommitment[i] === 0;
        inputDisabled[i] * inputDiversifier[i] === 0;
        inputDisabled[i] * inputRho[i] === 0;
        inputDisabled[i] * inputLeafIndex[i] === 0;
        inputDisabled[i] * nullifier[i] === 0;
        for (var l = 0; l < 32; l++) {
            inputDisabled[i] * inputSiblings[i][l] === 0;
            inputDisabled[i] * inputDirectionBits[i][l] === 0;
        }

        // A real lane has nonzero note fields and the shared owner.
        inputEnabled[i] * inputValueZero[i].out === 0;
        inputEnabled[i] * inputOwnerZero[i].out === 0;
        inputEnabled[i] * inputRhoZero[i].out === 0;
        inputEnabled[i] * inputNullifierZero[i].out === 0;
        inputDiversifierRange[i] = CheckBits(32);
        inputDiversifierRange[i].in <== inputDiversifier[i];
        inputDiversifiedOwner[i] = DiversifiedOwnerCommitment();
        inputDiversifiedOwner[i].baseOwnerCommitment <== actionOwner.out;
        inputDiversifiedOwner[i].diversifier <== inputDiversifier[i];
        inputEnabled[i] * (inputOwnerCommitment[i] - inputDiversifiedOwner[i].out) === 0;

        inputNote[i] = NoteCommitment();
        inputNote[i].contextField <== contextField;
        inputNote[i].assetField <== assetField;
        inputNote[i].ownerCommitment <== inputOwnerCommitment[i];
        inputNote[i].value <== inputValue[i];
        inputNote[i].rho <== inputRho[i];

        inputNullifier[i] = Nullifier();
        inputNullifier[i].contextField <== contextField;
        inputNullifier[i].nk <== nk;
        inputNullifier[i].rho <== inputRho[i];
        inputNullifier[i].leafIndex <== inputLeafIndex[i];
        inputNullifier[i].cm <== inputNote[i].out;
        inputEnabled[i] * (inputNullifier[i].out - nullifier[i]) === 0;

        inputPath[i] = MerklePath(32);
        inputPath[i].leaf <== inputNote[i].out;
        inputPath[i].leafIndex <== inputLeafIndex[i];
        for (var p = 0; p < 32; p++) {
            inputPath[i].siblings[p] <== inputSiblings[i][p];
            inputPath[i].directionBits[p] <== inputDirectionBits[i][p];
        }
        inputEnabled[i] * (inputPath[i].root - anchorRoot) === 0;
    }

    // Real lanes are left-packed, making inputEnabled[0] the has-inputs bit.
    inputEnabled[1] * (1 - inputEnabled[0]) === 0;
    (1 - inputEnabled[0]) * ask === 0;
    (1 - inputEnabled[0]) * nk === 0;
    inputEnabled[0] * askZero.out === 0;
    inputEnabled[0] * nkZero.out === 0;

    signal bothInputsEnabled;
    bothInputsEnabled <== inputEnabled[0] * inputEnabled[1];
    component duplicateNullifier = IsZero();
    component duplicateLeafIndex = IsZero();
    duplicateNullifier.in <== nullifier[0] - nullifier[1];
    duplicateLeafIndex.in <== inputLeafIndex[0] - inputLeafIndex[1];
    bothInputsEnabled * duplicateNullifier.out === 0;
    bothInputsEnabled * duplicateLeafIndex.out === 0;

    component outputValueRange[2];
    component outputValueZero[2];
    component outputOwnerZero[2];
    component outputRhoZero[2];
    component outputCommitmentZero[2];
    component outputNote[2];
    signal outputDisabled[2];

    for (var j = 0; j < 2; j++) {
        outputEnabled[j] * (1 - outputEnabled[j]) === 0;
        outputDisabled[j] <== 1 - outputEnabled[j];

        outputValueRange[j] = CheckBits(63);
        outputValueRange[j].in <== outputValue[j];
        outputValueZero[j] = IsZero();
        outputValueZero[j].in <== outputValue[j];
        outputOwnerZero[j] = IsZero();
        outputOwnerZero[j].in <== outputOwnerCommitment[j];
        outputRhoZero[j] = IsZero();
        outputRhoZero[j].in <== outputRho[j];
        outputCommitmentZero[j] = IsZero();
        outputCommitmentZero[j].in <== outputCommitment[j];

        outputDisabled[j] * outputValue[j] === 0;
        outputDisabled[j] * outputOwnerCommitment[j] === 0;
        outputDisabled[j] * outputRho[j] === 0;
        outputDisabled[j] * outputCommitment[j] === 0;

        outputEnabled[j] * outputValueZero[j].out === 0;
        outputEnabled[j] * outputOwnerZero[j].out === 0;
        outputEnabled[j] * outputRhoZero[j].out === 0;
        outputEnabled[j] * outputCommitmentZero[j].out === 0;

        outputNote[j] = NoteCommitment();
        outputNote[j].contextField <== contextField;
        outputNote[j].assetField <== assetField;
        outputNote[j].ownerCommitment <== outputOwnerCommitment[j];
        outputNote[j].value <== outputValue[j];
        outputNote[j].rho <== outputRho[j];
        outputEnabled[j] * (outputNote[j].out - outputCommitment[j]) === 0;
    }

    outputEnabled[1] * (1 - outputEnabled[0]) === 0;
    signal bothOutputsEnabled;
    bothOutputsEnabled <== outputEnabled[0] * outputEnabled[1];
    component duplicateOutput = IsZero();
    duplicateOutput.in <== outputCommitment[0] - outputCommitment[1];
    bothOutputsEnabled * duplicateOutput.out === 0;

    signal depositValue;
    signal withdrawValue;
    signal totalInput;
    signal totalOutput;
    depositValue <== isDeposit * publicValueField;
    withdrawValue <== isWithdraw * publicValueField;
    totalInput <== inputValue[0] + inputValue[1] + depositValue;
    totalOutput <== outputValue[0] + outputValue[1] + withdrawValue + relayerFeeField;
    totalInput === totalOutput;

    component totalInputRange = CheckBits(63);
    component totalOutputRange = CheckBits(63);
    totalInputRange.in <== totalInput;
    totalOutputRange.in <== totalOutput;

    component anchorZero = IsZero();
    anchorZero.in <== anchorRoot;

    // Deposit: zero anchor/inputs, positive public value, and at least one output.
    isDeposit * anchorRoot === 0;
    isDeposit * inputEnabled[0] === 0;
    isDeposit * inputEnabled[1] === 0;
    isDeposit * nullifier[0] === 0;
    isDeposit * nullifier[1] === 0;
    isDeposit * (1 - outputEnabled[0]) === 0;
    isDeposit * publicValueZero.out === 0;
    isDeposit * relayerFeeField === 0;
    isDeposit * relayerField === 0;

    // Transfer: nonzero anchor, at least one input/output, and no public value.
    isTransfer * anchorZero.out === 0;
    isTransfer * (1 - inputEnabled[0]) === 0;
    isTransfer * (1 - outputEnabled[0]) === 0;
    isTransfer * publicValueField === 0;
    isTransfer * relayerFieldZero.out === 0;

    // Withdraw: nonzero anchor/input and a positive public withdrawal amount.
    isWithdraw * anchorZero.out === 0;
    isWithdraw * (1 - inputEnabled[0]) === 0;
    isWithdraw * publicValueZero.out === 0;
    isWithdraw * relayerFieldZero.out === 0;
}

component main {public [contextField, assetField, actionKindField, anchorRoot, publicValueField, relayerFeeField, relayerField, actionField, actionBinding, nullifier, outputCommitment]} = ActionCircuit();
