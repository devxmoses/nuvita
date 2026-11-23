import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveryZonesService } from './delivery-zones.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DeliveryZonesService', () => {
  let service: DeliveryZonesService;
  let prisma: any;

  const zone = (over: Record<string, unknown> = {}) => ({
    id: 'z1', vendorId: 'v1', name: 'Nationwide', country: 'NG',
    state: null, city: null, fee: 200000, freeAbove: null, isActive: true,
    ...over,
  });

  const IBADAN = { country: 'NG', state: 'Oyo', city: 'Ibadan' };

  beforeEach(async () => {
    prisma = {
      deliveryZone: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(zone()),
        create: jest.fn().mockResolvedValue(zone()),
        update: jest.fn().mockResolvedValue(zone()),
        delete: jest.fn().mockResolvedValue(zone()),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DeliveryZonesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DeliveryZonesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolve', () => {
    it('returns null when the vendor has no zone covering the address', async () => {
      prisma.deliveryZone.findMany.mockResolvedValue([]);

      await expect(service.resolve('v1', IBADAN, 100000)).resolves.toBeNull();
    });

    // a city row beats a state row beats a country row, so a vendor can price
    // its home city cheaply and still quote for everywhere else
    it('prefers a city zone over a state zone over a country zone', async () => {
      prisma.deliveryZone.findMany.mockResolvedValue([
        zone({ id: 'country', state: null, city: null, fee: 300000 }),
        zone({ id: 'state', state: 'Oyo', city: null, fee: 150000 }),
        zone({ id: 'city', state: 'Oyo', city: 'Ibadan', fee: 50000 }),
      ]);

      const result = await service.resolve('v1', IBADAN, 100000);

      expect(result).toMatchObject({ zoneId: 'city', fee: 50000 });
    });

    it('falls back to the state zone when no city zone exists', async () => {
      prisma.deliveryZone.findMany.mockResolvedValue([
        zone({ id: 'country', state: null, city: null, fee: 300000 }),
        zone({ id: 'state', state: 'Oyo', city: null, fee: 150000 }),
      ]);

      const result = await service.resolve('v1', IBADAN, 100000);

      expect(result).toMatchObject({ zoneId: 'state', fee: 150000 });
    });

    it('falls back to the country zone when that is all there is', async () => {
      prisma.deliveryZone.findMany.mockResolvedValue([zone({ id: 'country' })]);

      const result = await service.resolve('v1', IBADAN, 100000);

      expect(result).toMatchObject({ zoneId: 'country', fee: 200000 });
    });

    it('waives the fee once the subtotal reaches freeAbove', async () => {
      prisma.deliveryZone.findMany.mockResolvedValue([
        zone({ fee: 200000, freeAbove: 5000000 }),
      ]);

      await expect(service.resolve('v1', IBADAN, 5000000)).resolves.toMatchObject({ fee: 0 });
      await expect(service.resolve('v1', IBADAN, 4999999)).resolves.toMatchObject({ fee: 200000 });
    });

    it('never waives when freeAbove is null', async () => {
      prisma.deliveryZone.findMany.mockResolvedValue([zone({ fee: 200000, freeAbove: null })]);

      const result = await service.resolve('v1', IBADAN, 999999999);

      expect(result).toMatchObject({ fee: 200000 });
    });

    it('only considers active zones for the right vendor and country', async () => {
      await service.resolve('v1', IBADAN, 100000);

      expect(prisma.deliveryZone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ vendorId: 'v1', isActive: true, country: 'NG' }),
        }),
      );
    });

    it('upper-cases the country so "ng" matches a zone stored as "NG"', async () => {
      await service.resolve('v1', { ...IBADAN, country: 'ng' }, 100000);

      expect(prisma.deliveryZone.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ country: 'NG' }) }),
      );
    });

    // checkout passes its transaction in, so the zones it prices against cannot
    // change between quoting and writing the order
    it('reads through a client it is given instead of the base one', async () => {
      const tx = { deliveryZone: { findMany: jest.fn().mockResolvedValue([zone()]) } };

      await service.resolve('v1', IBADAN, 100000, tx as never);

      expect(tx.deliveryZone.findMany).toHaveBeenCalled();
      expect(prisma.deliveryZone.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('defaults the country and stores blank state and city as null', async () => {
      await service.create('v1', { name: 'Nationwide', fee: 200000, state: '  ', city: '' });

      expect(prisma.deliveryZone.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ country: 'NG', state: null, city: null }),
      });
    });

    it('upper-cases a supplied country', async () => {
      await service.create('v1', { name: 'Ghana', fee: 500000, country: 'gh' });

      expect(prisma.deliveryZone.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ country: 'GH' }),
      });
    });

    // Prisma cannot express a unique index over COALESCE(state,''), so two
    // country-wide rows would both be allowed - NULL is not equal to NULL
    it('refuses a second zone covering the same place', async () => {
      prisma.deliveryZone.findFirst.mockResolvedValue(zone());

      await expect(service.create('v1', { name: 'Again', fee: 1 }))
        .rejects.toThrow(ConflictException);

      expect(prisma.deliveryZone.create).not.toHaveBeenCalled();
    });

    it('scopes that clash check to the same vendor', async () => {
      await service.create('v1', { name: 'Nationwide', fee: 1 });

      expect(prisma.deliveryZone.findFirst).toHaveBeenCalledWith({
        where: { vendorId: 'v1', country: 'NG', state: null, city: null },
      });
    });
  });

  describe('update', () => {
    it('excludes the row being updated from its own clash check', async () => {
      await service.update('z1', { fee: 99 });

      expect(prisma.deliveryZone.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: { not: 'z1' } }),
      });
    });

    it('404s for a zone that does not exist', async () => {
      prisma.deliveryZone.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', { fee: 1 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('404s for a zone that does not exist', async () => {
      prisma.deliveryZone.findUnique.mockResolvedValue(null);

      await expect(service.remove('ghost')).rejects.toThrow(NotFoundException);
    });
  });
});
