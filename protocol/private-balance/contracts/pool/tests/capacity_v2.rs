// Opt-in experiment: generated local fixtures are intentionally not release
// artifacts. This harness is a standalone test target and is ignored in the
// ordinary v1 suite. See the experiment README for its required local gate.
#[path = "../../../experiments/capacity-v2/contract.test.rs"]
mod prototype;
