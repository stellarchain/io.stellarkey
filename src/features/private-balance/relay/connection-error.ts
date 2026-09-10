/** Safe, non-wallet diagnostics: never carry SDK errors, URLs or peer IDs. */
export interface PrivateRelayConfigurationProblem {
  readonly code: 'waku-cluster-mismatch';
  readonly configuredClusterId: number;
  readonly peerClusterIds: readonly number[];
}

function isClusterId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 65_535;
}

export function describePrivateRelayConfigurationProblem(problem: PrivateRelayConfigurationProblem): string {
  return `This relay session uses Waku cluster ${problem.configuredClusterId}, but your configured service nodes report cluster ${problem.peerClusterIds.join(' or ')}. Set the matching Waku cluster under Relay connections and save.`;
}

export class PrivateRelayConfigurationError extends Error {
  readonly code = 'waku-cluster-mismatch' as const;
  readonly configuredClusterId: number;
  readonly peerClusterIds: readonly number[];
  readonly problem: PrivateRelayConfigurationProblem;

  constructor(configuredClusterId: number, peerClusterIds: readonly number[]) {
    const distinct = [...new Set(peerClusterIds)].sort((left, right) => left - right);
    if (!isClusterId(configuredClusterId) || distinct.length === 0 || distinct.length > 4 ||
      distinct.some(value => !isClusterId(value) || value === configuredClusterId)) {
      throw new Error('Invalid Waku configuration diagnostic');
    }
    const problem: PrivateRelayConfigurationProblem = Object.freeze({
      code: 'waku-cluster-mismatch', configuredClusterId, peerClusterIds: Object.freeze(distinct),
    });
    super(describePrivateRelayConfigurationProblem(problem));
    this.name = 'PrivateRelayConfigurationError';
    this.configuredClusterId = configuredClusterId;
    this.peerClusterIds = problem.peerClusterIds;
    this.problem = problem;
  }
}
