import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { PrismaService } from '../prisma/prisma.service';
import { FindVendorsQueryDto } from './dto/find-vendors-query.dto';
import { cacheServiceMock, eventEmitterMock, infraProviders } from '../common/testing/infra-test-providers';

describe('VendorsService', () => {
  let service: VendorsService;
  let prisma: any;
  let cache: ReturnType<typeof cacheServiceMock>;
  let events: ReturnType<typeof eventEmitterMock>;
  let tx: { vendor: Record<string, jest.Mock>; user: Record<string, jest.Mock> };

  const VENDOR = { id: 'v1', name: 'Green Valley Nutrition', slug: 'green-valley-nutrition', ownerId: 'u1' };

  beforeEach(async () => {
    tx = {
      vendor: { create: jest.fn().mockResolvedValue(VENDOR) },
      user: { update: jest.fn() },
    };
    // Deliberately no `vendor`/`user` on the base client: create() must do both
    // writes through the transaction, and touching this.prisma instead would
    // throw here rather than quietly escape the transaction.
    prisma = {
        // create() passes a callback; findAll() passes an array of operations
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
      ),
      vendor: {
        findMany: jest.fn().mockResolvedValue([VENDOR]),
        findUnique: jest.fn().mockResolvedValue(VENDOR),
        update: jest.fn().mockResolvedValue(VENDOR),
        delete: jest.fn().mockResolvedValue(VENDOR),
        count: jest.fn().mockResolvedValue(1),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorsService,
        { provide: PrismaService, useValue: prisma },
        ...infraProviders((cache = cacheServiceMock()), (events = eventEmitterMock())),
      ],
    }).compile();
    service = module.get(VendorsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('derives the slug from the name when none is given', async () => {
      await service.create('u1', { name: 'Green Valley Nutrition!' });

      expect(tx.vendor.create).toHaveBeenCalledWith({
        data: {
          name: 'Green Valley Nutrition!',
          description: undefined,
          slug: 'green-valley-nutrition',
          ownerId: 'u1',
        },
      });
    });

    it('normalises a slug that was supplied', async () => {
      await service.create('u1', { name: 'Anything', slug: '  Mixed CASE Slug  ' });

      expect(tx.vendor.create.mock.calls[0][0].data.slug).toBe('mixed-case-slug');
    });

    it('owns the vendor to the caller, not to anything in the body', async () => {
      await service.create('u1', { name: 'Green Valley Nutrition' });

      expect(tx.vendor.create.mock.calls[0][0].data.ownerId).toBe('u1');
    });

    // Creating the vendor and flipping isVendor must not be separable - a crash
    // between them would leave a vendor whose owner cannot act as one.
    it('flips the owner to isVendor inside the same transaction', async () => {
      await service.create('u1', { name: 'Green Valley Nutrition' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isVendor: true },
      });
    });

    it('returns the created vendor', async () => {
      await expect(service.create('u1', { name: 'Green Valley Nutrition' })).resolves.toEqual(VENDOR);
    });
  });

  describe('findOne', () => {
    it('returns the vendor', async () => {
      await expect(service.findOne('v1')).resolves.toEqual(VENDOR);
    });

    it('throws 404 when it does not exist', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

    describe('findAll', () => {
    const query = (over: Partial<FindVendorsQueryDto> = {}) =>
      ({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', ...over }) as FindVendorsQueryDto;

    it('returns the rows under data with pagination meta', async () => {
      prisma.vendor.count.mockResolvedValue(3);

      const result = await service.findAll(query());

      expect(result.data).toEqual([VENDOR]);
      expect(result.meta).toEqual({ total: 3, page: 1, limit: 20, pageCount: 1 });
    });

    it('translates page and limit into skip and take', async () => {
      await service.findAll(query({ page: 4, limit: 5 }));

      expect(prisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 15, take: 5 }),
      );
    });

    it('sorts by the requested field and direction', async () => {
      await service.findAll(query({ sortBy: 'name', order: 'asc' }));

      expect(prisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('runs the page and the count in one transaction', async () => {
      await service.findAll(query());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });
  });


  describe('update', () => {
    it('checks the vendor exists first', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(prisma.vendor.update).not.toHaveBeenCalled();
    });

    it('normalises a new slug', async () => {
      await service.update('v1', { slug: 'New SLUG Here' });

      expect(prisma.vendor.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { slug: 'new-slug-here' },
      });
    });

    // Passing `slug: undefined` through would null out a perfectly good slug.
    it('leaves the slug alone when the patch does not mention it', async () => {
      await service.update('v1', { name: 'Renamed' });

      const { data } = prisma.vendor.update.mock.calls[0][0];
      expect(data).toEqual({ name: 'Renamed' });
      expect(data).not.toHaveProperty('slug');
    });
  });

  describe('remove', () => {
    it('checks the vendor exists first', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
      expect(prisma.vendor.delete).not.toHaveBeenCalled();
    });

    it('deletes it', async () => {
      await expect(service.remove('v1')).resolves.toEqual(VENDOR);
      expect(prisma.vendor.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
    });
  });

  describe('findAll (public directory)', () => {
    // Regression guard. The isApproved filter was declared as a local and never
    // passed to the query, so the directory listed unapproved vendors and the
    // total counted them. Asserting on the arguments is the only way to catch
    // that - a mocked findMany returns rows whatever the where clause says.
    it('filters the page to approved vendors', async () => {
      await service.findAll({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' } as FindVendorsQueryDto);

      expect(prisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isApproved: true } }),
      );
    });

    it('applies the same filter to the count, so pagination has no phantom pages', async () => {
      await service.findAll({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' } as FindVendorsQueryDto);

      expect(prisma.vendor.count).toHaveBeenCalledWith({ where: { isApproved: true } });
    });

    it('reads the page through the cache', async () => {
      await service.findAll({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' } as FindVendorsQueryDto);

      expect(cache.wrapList).toHaveBeenCalledWith(
        'vendors',
        expect.objectContaining({ page: 1, limit: 20 }),
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('only lists and counts approved vendors', async () => {
    await service.findAll({ page: 1, limit: 10, sortBy: 'createdAt', order: 'desc' } as any);

    expect(prisma.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isApproved: true } }),
    );
    expect(prisma.vendor.count).toHaveBeenCalledWith({ where: { isApproved: true } });
  });

  });

  describe('approve', () => {
    it('emits vendor.approved with the owner, so the owner can be notified', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ ...VENDOR, isApproved: false });
      prisma.vendor.update.mockResolvedValue({ ...VENDOR, isApproved: true });

      await service.approve('v1');

      expect(events.emit).toHaveBeenCalledWith(
        'vendor.approved',
        expect.objectContaining({ vendorId: 'v1', ownerId: 'u1' }),
      );
    });

    it('sets approvedAt', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ ...VENDOR, isApproved: false });

      await service.approve('v1');

      expect(prisma.vendor.update.mock.calls[0][0].data.approvedAt).toBeInstanceOf(Date);
    });

    // Idempotent: an admin double-clicking must not move approvedAt or re-send
    // the approval email.
    it('emits nothing and writes nothing when already approved', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ ...VENDOR, isApproved: true });

      await service.approve('v1');

      expect(prisma.vendor.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('invalidates both listings so the vendor and its products appear', async () => {
      prisma.vendor.findUnique.mockResolvedValue({ ...VENDOR, isApproved: false });

      await service.approve('v1');

      expect(cache.invalidate).toHaveBeenCalledWith('vendors');
      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });
  });

  describe('revokeApproval', () => {
    it('clears the flag and the timestamp', async () => {
      await service.revokeApproval('v1');

      expect(prisma.vendor.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isApproved: false, approvedAt: null } }),
      );
    });

    // The storefront must disappear now, not when a 60 second ttl lapses.
    it('invalidates both listings immediately', async () => {
      await service.revokeApproval('v1');

      expect(cache.invalidate).toHaveBeenCalledWith('vendors');
      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });
  });
});
