import {
  NEW_PASSWORD_MIN_LENGTH,
  newPasswordSchema,
  passwordSchema,
  RESERVED_USERNAMES,
  usernameSchema,
} from './credentials';

// Two length schemas on purpose (docs/account.md — "password — rules and
// entropy"): sign-in stays permissive so it never strands a valid account;
// create/change enforces the policy floor. These specs pin that split.
describe('passwordSchema (sign-in — permissive)', () => {
  it('accepts an 8-char password (the loose sign-in floor)', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(true);
  });

  it('measures the TRIMMED length (whitespace-only fails min)', () => {
    expect(passwordSchema.safeParse('        ').success).toBe(false);
  });

  it('trims surrounding whitespace from the parsed value', () => {
    expect(passwordSchema.parse('  abcdefgh  ')).toBe('abcdefgh');
  });
});

describe('newPasswordSchema (create / change — policy floor)', () => {
  it('rejects a password shorter than the 12-char floor', () => {
    expect(newPasswordSchema.safeParse('abcdefghijk').success).toBe(false); // 11
  });

  it('accepts a password at the floor', () => {
    expect(newPasswordSchema.safeParse('abcdefghijkl').success).toBe(true); // 12
  });

  it('is stricter than sign-in: an 8-char password passes sign-in but not create', () => {
    const pw = 'abcdefgh';
    expect(passwordSchema.safeParse(pw).success).toBe(true);
    expect(newPasswordSchema.safeParse(pw).success).toBe(false);
  });

  it('measures the TRIMMED length against the floor', () => {
    // 12 visible chars + surrounding spaces still passes; 11 + padding does not.
    expect(newPasswordSchema.safeParse('  abcdefghijkl  ').success).toBe(true);
    expect(newPasswordSchema.safeParse('  abcdefghijk  ').success).toBe(false);
  });

  it('rejects passwords over the 128-char Argon2id bound', () => {
    expect(newPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(newPasswordSchema.safeParse('a'.repeat(128)).success).toBe(true);
  });

  it('exposes the floor as a shared constant', () => {
    expect(NEW_PASSWORD_MIN_LENGTH).toBe(12);
  });
});

describe('usernameSchema (reserved-name blocklist)', () => {
  it('accepts an ordinary username', () => {
    expect(usernameSchema.safeParse('alice_01').success).toBe(true);
  });

  it('rejects a reserved name', () => {
    const r = usernameSchema.safeParse('admin');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('This username is reserved');
  });

  it('blocks reserved names regardless of case or surrounding whitespace', () => {
    for (const u of ['ADMIN', 'Admin', '  admin  ', 'Support', 'BRACE']) {
      expect(usernameSchema.safeParse(u).success).toBe(false);
    }
  });

  it('only blocks EXACT reserved handles, not substrings', () => {
    for (const u of ['admin123', 'notadmin', 'supporter', 'brace_fan']) {
      expect(usernameSchema.safeParse(u).success).toBe(true);
    }
  });

  it('every reserved entry is itself charset-valid and ≥3 chars (no dead entries)', () => {
    for (const name of RESERVED_USERNAMES) {
      // Would a real user typing this exact handle be blocked? Only if the entry
      // could pass the length+charset rules to begin with.
      expect(name).toMatch(/^[a-z0-9_]{3,32}$/);
    }
  });
});
