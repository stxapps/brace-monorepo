import { getSyncPhase, SYNC_PHASE_LABELS } from './status';

// The two-field → one-phase collapse every status surface shares. Covered here
// rather than in each surface because the surfaces are supposed to be dumb: if
// this derivation is right, bracemark-web's Data card, the expo Data card and
// the extension popup pill all agree by construction.
describe('getSyncPhase', () => {
  it('lets the store gate outrank the background indicator', () => {
    // While the gate is still working there is no background cycle to report.
    expect(getSyncPhase('checking', 'error')).toBe('checking');
    expect(getSyncPhase('syncing-initial', 'blocked')).toBe('initial-syncing');
    expect(getSyncPhase('error', 'idle')).toBe('initial-error');
  });

  it('reports a quota-blocked cycle as its own phase, not as an error', () => {
    // The distinction the whole state exists for: the cycle COMPLETED and the
    // local store is correct — only the plan's limit stopped part of the push.
    // Collapsing this into 'cycle-error' would send the user hunting for a
    // network problem instead of showing them the paywall.
    expect(getSyncPhase('ready', 'blocked')).toBe('quota-blocked');
    expect(SYNC_PHASE_LABELS['quota-blocked']).not.toBe(SYNC_PHASE_LABELS['cycle-error']);
  });

  it('prefers a real failure over a quota block', () => {
    // 'blocked' is settled and only clears by upgrading; 'error' is retryable.
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
