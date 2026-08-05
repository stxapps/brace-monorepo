import {
  emptySyncOutcome,
  getSyncPhase,
  recordBlocked,
  SYNC_PHASE_LABELS,
  syncBlockedDetail,
} from './status';

// The two-field → one-phase collapse every status surface shares. Covered here
// rather than in each surface because the surfaces are supposed to be dumb: if
// this derivation is right, bracemark-web's Data card, the expo Data card and
// the extension popup pill all agree by construction.
describe('getSyncPhase', () => {
  it('lets the store gate outrank the background indicator', () => {
    // While the gate is still working there is no background cycle to report.
    expect(getSyncPhase('checking', 'error')).toBe('checking');
    expect(getSyncPhase('syncing-initial', 'blocked-plan')).toBe('initial-syncing');
    expect(getSyncPhase('error', 'idle')).toBe('initial-error');
  });

  it('reports a blocked cycle as its own phase, not as an error', () => {
    // The distinction the whole state exists for: the cycle COMPLETED and the
    // local store is correct — only the plan's limit stopped part of the push.
    // Collapsing this into 'cycle-error' would send the user hunting for a
    // network problem instead of showing them the paywall.
    expect(getSyncPhase('ready', 'blocked-plan')).toBe('plan-blocked');
    expect(SYNC_PHASE_LABELS['plan-blocked']).not.toBe(SYNC_PHASE_LABELS['cycle-error']);
  });

  it('keeps the two block reasons distinct all the way to the label', () => {
    // A paying customer who is out of BYTES must not be told to upgrade — the
    // reason the status splits in two rather than carrying one 'blocked'.
    expect(getSyncPhase('ready', 'blocked-capacity')).toBe('capacity-blocked');
    expect(SYNC_PHASE_LABELS['capacity-blocked']).not.toBe(SYNC_PHASE_LABELS['plan-blocked']);
  });

  it('prefers a real failure over a quota block', () => {
    // Blocked is settled and only clears by upgrading; 'error' is retryable.
    // When a cycle somehow reports both, the retryable one is the actionable one.
    expect(getSyncPhase('ready', 'error')).toBe('cycle-error');
  });

  it('reports an in-flight cycle over any previous outcome', () => {
    expect(getSyncPhase('ready', 'syncing')).toBe('syncing');
  });

  it('settles to idle', () => {
    expect(getSyncPhase('ready', 'idle')).toBe('idle');
  });
});

// The accumulator both engines write through. Its rules live in shared precisely
// so web-react and expo-react can't drift on them.
describe('recordBlocked', () => {
  it('starts clean', () => {
    expect(emptySyncOutcome()).toEqual({ blockedBy: null, blockedCount: 0 });
  });

  it('sums the refused ops across chunks', () => {
    const outcome = emptySyncOutcome();
    recordBlocked(outcome, 'plan', 3);
    recordBlocked(outcome, 'plan', 4);
    expect(outcome).toEqual({ blockedBy: 'plan', blockedCount: 7 });
  });

  it('lets capacity outrank plan whichever order they arrive in', () => {
    // Being out of bytes blocks every namespace, so it is the larger blockage
    // and its advice still applies after an upgrade.
    const planFirst = emptySyncOutcome();
    recordBlocked(planFirst, 'plan', 1);
    recordBlocked(planFirst, 'capacity', 1);
    expect(planFirst.blockedBy).toBe('capacity');

    const capacityFirst = emptySyncOutcome();
    recordBlocked(capacityFirst, 'capacity', 1);
    recordBlocked(capacityFirst, 'plan', 1);
    expect(capacityFirst.blockedBy).toBe('capacity');

    // Either way both refusals are counted.
    expect(planFirst.blockedCount).toBe(2);
    expect(capacityFirst.blockedCount).toBe(2);
  });
});

describe('syncBlockedDetail', () => {
  it('gives each reason its own fix', () => {
    expect(syncBlockedDetail('plan-blocked', 12)).toContain('Upgrade');
    expect(syncBlockedDetail('capacity-blocked', 12)).toContain('Free up space');
  });

  it('counts the refused ops, singular and plural', () => {
    expect(syncBlockedDetail('plan-blocked', 1)).toContain('1 change ');
    expect(syncBlockedDetail('plan-blocked', 12)).toContain('12 changes ');
  });

  it('stays vague rather than saying "0 changes"', () => {
    expect(syncBlockedDetail('plan-blocked', 0)).toContain('Some changes');
  });

  it('has nothing to say about the non-blocked phases', () => {
    expect(syncBlockedDetail('idle', 0)).toBeNull();
    expect(syncBlockedDetail('cycle-error', 3)).toBeNull();
  });
});
