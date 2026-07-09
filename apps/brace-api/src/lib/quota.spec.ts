import { describe, expect, it } from 'vitest';

import { entitlementsOf } from '@stxapps/shared';

import type { FileUsage } from '../do/user-data';
import { HttpError } from './errors';
import { checkPutQuota } from './quota';

// Pure-function coverage of the put-quota gate. The namespace-level `files/` plan
// gate is gone (free stores preview-image blobs now — see docs/business-model.md
// "tiers"), so the only gates left are: the free `maxLinks` cap (upgrade_required)
// and the byte/count backstop (quota_exceeded) that every plan shares.

const usage = (u: Partial<FileUsage> = {}): FileUsage => ({
  fileCount: 0,
  totalBytes: 0,
  linkCount: 0,
  ...u,
});

const free = entitlementsOf('free');
const plus = entitlementsOf('plus');

describe('checkPutQuota', () => {
  it('allows free-tier files/ puts (client-extracted preview images)', () => {
    expect(() => checkPutQuota(free, usage(), ['files/a.enc'])).not.toThrow();
  });

  it('allows a free links/ put under the cap', () => {
    expect(() => checkPutQuota(free, usage({ linkCount: 10 }), ['links/a.enc'])).not.toThrow();
  });

  it('rejects a free links/ put that would exceed maxLinks (upgrade_required)', () => {
    const at = usage({ linkCount: free.maxLinks! });
    try {
      checkPutQuota(free, at, ['links/a.enc']);
      throw new Error('expected checkPutQuota to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).code).toBe('upgrade_required');
    }
  });

  it('does not cap links/ puts on paid plans (maxLinks null)', () => {
    expect(() =>
      checkPutQuota(plus, usage({ linkCount: 10_000 }), ['links/a.enc']),
    ).not.toThrow();
  });

  it('rejects when the byte quota is already reached (quota_exceeded)', () => {
    const full = usage({ totalBytes: plus.maxBytes });
    try {
      checkPutQuota(plus, full, ['files/a.enc']);
      throw new Error('expected checkPutQuota to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe('quota_exceeded');
    }
  });

  it('rejects when the object-count cap would be exceeded (quota_exceeded)', () => {
    const full = usage({ fileCount: free.maxFiles });
    try {
      checkPutQuota(free, full, ['files/a.enc']);
      throw new Error('expected checkPutQuota to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).code).toBe('quota_exceeded');
    }
  });
});
