import { syncPathSchema } from './endpoints';
import * as paths from './paths';
import { ENC_SUFFIX, ID_KEYED_PREFIXES, SETTINGS_PREFIX } from './paths';

// Backstop for the easy-to-forget case (see paths.ts ID_KEYED_PREFIXES): add a
// `*_PREFIX` const but forget to wire it into validation, and this fails at test
// time instead of every client 400ing on the new namespace at runtime.
describe('syncPathSchema covers the whole path contract', () => {
  // Reflect over EVERY exported `*_PREFIX` — the trigger you can't forget is adding
  // the const itself — and assert each names an accepted sync path. 'general' is
  // lowercase alphanumerics, so one sample satisfies both the random-id charset
  // (id-keyed prefixes) and the lowercase concern charset (settings/).
  const allPrefixes = Object.entries(paths)
    .filter(([k, v]) => k.endsWith('_PREFIX') && typeof v === 'string')
    .map(([, v]) => v as string);

  it.each(allPrefixes)('accepts a path under the %s namespace', (prefix) => {
    expect(syncPathSchema.safeParse(`${prefix}general${ENC_SUFFIX}`).success).toBe(true);
  });

  it('accepts the id-keyed and settings shapes explicitly', () => {
    for (const prefix of ID_KEYED_PREFIXES) {
      expect(syncPathSchema.safeParse(`${prefix}aZ09_-${ENC_SUFFIX}`).success).toBe(true);
    }
    expect(syncPathSchema.safeParse(`${SETTINGS_PREFIX}general${ENC_SUFFIX}`).success).toBe(true);
  });

  it('rejects traversal, unknown namespaces, and wrong suffixes', () => {
    const bad = [
      '../meta/x.enc', // traversal out of the user root
      'meta/../files/x.enc', // embedded traversal
      'meta/x.txt', // wrong suffix
      'meta/.enc', // empty id segment
      'unknown/x.enc', // namespace not in the contract
      'settings/General.enc', // concern must be lowercase
      'meta/x.enc/y.enc', // smuggled second segment
    ];
    for (const path of bad) {
      expect(syncPathSchema.safeParse(path).success).toBe(false);
    }
  });
});
