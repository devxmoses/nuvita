import { CacheNamespace, itemKey, listKey, stableQueryKey, versionKey } from './cache-keys';

describe('cache keys', () => {
  describe('stableQueryKey', () => {
    it('produces the same key regardless of property order', () => {
      expect(stableQueryKey({ page: 1, limit: 20 })).toBe(stableQueryKey({ limit: 20, page: 1 }));
    });

    it('drops undefined, null and empty values so an absent filter is not part of the key', () => {
      expect(stableQueryKey({ page: 1, q: undefined, vendorId: null, categoryId: '' })).toBe('page=1');
    });

    it('sorts array values, so ?segments=PET&segments=HUMAN matches the reverse', () => {
      expect(stableQueryKey({ segments: ['PET', 'HUMAN'] })).toBe(
        stableQueryKey({ segments: ['HUMAN', 'PET'] }),
      );
    });

    it('distinguishes different values', () => {
      expect(stableQueryKey({ page: 1 })).not.toBe(stableQueryKey({ page: 2 }));
    });

    it('names the no-filter case rather than producing an empty string', () => {
      expect(stableQueryKey({})).toBe('all');
    });
  });

  it('namespaces and versions list keys, so a version bump orphans every old key', () => {
    const before = listKey(CacheNamespace.Products, 1, { page: 1 });
    const after = listKey(CacheNamespace.Products, 2, { page: 1 });

    expect(before).toBe('products:v1:list:page=1');
    expect(after).not.toBe(before);
  });

  it('keeps item keys separate from list keys at the same version', () => {
    expect(itemKey(CacheNamespace.Products, 1, 'p1')).not.toBe(
      listKey(CacheNamespace.Products, 1, { id: 'p1' }),
    );
  });

  it('keeps each namespace version counter separate', () => {
    expect(versionKey(CacheNamespace.Products)).not.toBe(versionKey(CacheNamespace.Vendors));
  });
});
