import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';
import { CacheNamespace, versionKey } from './cache-keys';

describe('CacheService', () => {
  let service: CacheService;
  let cache: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService, { provide: CACHE_MANAGER, useValue: cache }],
    }).compile();
    service = module.get(CacheService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('wrapList', () => {
    it('runs the factory and caches the result on a miss', async () => {
      const factory = jest.fn().mockResolvedValue({ data: [1] });

      const result = await service.wrapList(CacheNamespace.Products, { page: 1 }, 30, factory);

      expect(result).toEqual({ data: [1] });
      expect(factory).toHaveBeenCalledTimes(1);
      // ttl is passed to cache-manager in milliseconds, not seconds
      expect(cache.set).toHaveBeenCalledWith('products:v1:list:page=1', { data: [1] }, 30_000);
    });

    it('returns the cached value and does not run the factory on a hit', async () => {
      cache.get.mockImplementation((key: string) =>
        key.startsWith('ver:') ? undefined : { data: ['cached'] },
      );
      const factory = jest.fn();

      const result = await service.wrapList(CacheNamespace.Products, { page: 1 }, 30, factory);

      expect(result).toEqual({ data: ['cached'] });
      expect(factory).not.toHaveBeenCalled();
    });

    it('caches a legitimately empty page rather than treating it as a miss forever', async () => {
      const factory = jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } });

      await service.wrapList(CacheNamespace.Products, { page: 9 }, 30, factory);

      expect(cache.set).toHaveBeenCalled();
    });

    // A cache is an optimisation. If Redis is unreachable the catalogue must still
    // serve, so a failing store degrades to a miss instead of a 500.
    it('falls through to the factory when the cache store throws', async () => {
      cache.get.mockRejectedValue(new Error('ECONNREFUSED'));
      cache.set.mockRejectedValue(new Error('ECONNREFUSED'));
      const factory = jest.fn().mockResolvedValue({ data: ['live'] });

      const result = await service.wrapList(CacheNamespace.Products, { page: 1 }, 30, factory);

      expect(result).toEqual({ data: ['live'] });
    });

    // The opposite case: a database error is real and must not be swallowed.
    it('propagates an error thrown by the factory', async () => {
      const factory = jest.fn().mockRejectedValue(new Error('db is down'));

      await expect(
        service.wrapList(CacheNamespace.Products, { page: 1 }, 30, factory),
      ).rejects.toThrow('db is down');
    });

    it('reads the namespace version so a bump changes the key it looks up', async () => {
      cache.get.mockImplementation((key: string) => (key.startsWith('ver:') ? 7 : undefined));
      const factory = jest.fn().mockResolvedValue('x');

      await service.wrapList(CacheNamespace.Products, { page: 1 }, 30, factory);

      expect(cache.set).toHaveBeenCalledWith('products:v7:list:page=1', 'x', 30_000);
    });
  });

  describe('invalidate', () => {
    it('increments the namespace version', async () => {
      cache.get.mockResolvedValue(3);

      await service.invalidate(CacheNamespace.Products);

      expect(cache.set).toHaveBeenCalledWith(versionKey(CacheNamespace.Products), 4, 0);
    });

    it('starts at 1 so the first invalidation moves to 2', async () => {
      cache.get.mockResolvedValue(undefined);

      await service.invalidate(CacheNamespace.Vendors);

      expect(cache.set).toHaveBeenCalledWith(versionKey(CacheNamespace.Vendors), 2, 0);
    });

    // ttl 0 means "never expire". If the counter aged out, keys written at the old
    // version would become reachable again and serve stale data.
    it('stores the counter without a ttl', async () => {
      cache.get.mockResolvedValue(1);

      await service.invalidate(CacheNamespace.Products);

      expect(cache.set.mock.calls[0][2]).toBe(0);
    });

    it('does not throw when the store is unreachable', async () => {
      cache.get.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.invalidate(CacheNamespace.Products)).resolves.toBeUndefined();
    });

    it('only affects the namespace it was asked about', async () => {
      cache.get.mockResolvedValue(1);

      await service.invalidate(CacheNamespace.Products);

      expect(cache.set).toHaveBeenCalledWith(versionKey(CacheNamespace.Products), 2, 0);
      expect(cache.set).not.toHaveBeenCalledWith(versionKey(CacheNamespace.Vendors), 2, 0);
    });
  });
});
