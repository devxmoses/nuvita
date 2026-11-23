import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AddressesService', () => {
  let service: AddressesService;
  let prisma: any;
  let tx: any;

  const ADDRESS = {
    id: 'a1', userId: 'u1', label: 'Home', line1: '12 Agodi Road', line2: null,
    city: 'Ibadan', state: 'Oyo', postalCode: null, country: 'NG',
    phone: null, isDefault: true,
  };
  const BASE = { line1: '12 Agodi Road', city: 'Ibadan', state: 'Oyo' };

  beforeEach(async () => {
    tx = {
      address: {
        create: jest.fn().mockResolvedValue(ADDRESS),
        update: jest.fn().mockResolvedValue(ADDRESS),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue(ADDRESS),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    prisma = {
      address: {
        findMany: jest.fn().mockResolvedValue([ADDRESS]),
        findFirst: jest.fn().mockResolvedValue(ADDRESS),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AddressesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AddressesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAllForUser', () => {
    it('scopes to the user and puts the default first', async () => {
      await service.findAllForUser('u1');

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('findOneForUser', () => {
    // scoped in the query, not checked after: a bare findUnique on the id
    // would hand one user another user's address
    it('scopes the lookup by userId in the same query', async () => {
      await service.findOneForUser('u1', 'a1');

      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { id: 'a1', userId: 'u1' },
      });
    });

    it('404s rather than 403s for somebody else address', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.findOneForUser('u2', 'a1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('makes the first saved address the default whatever was asked', async () => {
      prisma.address.count.mockResolvedValue(0);

      await service.create('u1', BASE);

      expect(tx.address.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isDefault: true, userId: 'u1' }),
      });
    });

    it('does not make a later address the default unless asked', async () => {
      prisma.address.count.mockResolvedValue(3);

      await service.create('u1', BASE);

      expect(tx.address.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isDefault: false }),
      });
    });

    it('clears the previous default before setting a new one', async () => {
      prisma.address.count.mockResolvedValue(2);

      await service.create('u1', { ...BASE, isDefault: true });

      expect(tx.address.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { isDefault: false },
      });
      expect(tx.address.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.address.create.mock.invocationCallOrder[0],
      );
    });

    it('does not touch other addresses when this one is not the default', async () => {
      prisma.address.count.mockResolvedValue(2);

      await service.create('u1', BASE);

      expect(tx.address.updateMany).not.toHaveBeenCalled();
    });

    it('defaults and upper-cases the country', async () => {
      prisma.address.count.mockResolvedValue(0);

      await service.create('u1', BASE);
      expect(tx.address.create.mock.calls[0][0].data.country).toBe('NG');

      jest.clearAllMocks();
      prisma.address.count.mockResolvedValue(0);
      await service.create('u1', { ...BASE, country: 'gh' });
      expect(tx.address.create.mock.calls[0][0].data.country).toBe('GH');
    });

    // clearing the old default and setting the new one has to be atomic, or a
    // crash between them leaves the user with no default at all
    it('does both writes in one transaction', async () => {
      prisma.address.count.mockResolvedValue(2);

      await service.create('u1', { ...BASE, isDefault: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('refuses to update an address that is not yours', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.update('u2', 'a1', { city: 'Lagos' }))
        .rejects.toThrow(NotFoundException);
      expect(tx.address.update).not.toHaveBeenCalled();
    });

    it('clears the other defaults when promoting this one', async () => {
      await service.update('u1', 'a1', { isDefault: true });

      expect(tx.address.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { isDefault: false },
      });
    });

    it('does not clear defaults for an unrelated edit', async () => {
      await service.update('u1', 'a1', { city: 'Lagos' });

      expect(tx.address.updateMany).not.toHaveBeenCalled();
    });

    it('does not clear defaults when explicitly setting isDefault false', async () => {
      await service.update('u1', 'a1', { isDefault: false });

      expect(tx.address.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('promotes another address when the default is deleted', async () => {
      prisma.address.findFirst.mockResolvedValue({ ...ADDRESS, isDefault: true });
      tx.address.findFirst.mockResolvedValue({ id: 'a2' });

      await service.remove('u1', 'a1');

      expect(tx.address.update).toHaveBeenCalledWith({
        where: { id: 'a2' },
        data: { isDefault: true },
      });
    });

    it('does not promote anything when a non-default is deleted', async () => {
      prisma.address.findFirst.mockResolvedValue({ ...ADDRESS, isDefault: false });

      await service.remove('u1', 'a1');

      expect(tx.address.update).not.toHaveBeenCalled();
    });

    it('copes with deleting the only address', async () => {
      prisma.address.findFirst.mockResolvedValue({ ...ADDRESS, isDefault: true });
      tx.address.findFirst.mockResolvedValue(null);

      await expect(service.remove('u1', 'a1')).resolves.toBeDefined();
      expect(tx.address.update).not.toHaveBeenCalled();
    });

    it('refuses to delete an address that is not yours', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.remove('u2', 'a1')).rejects.toThrow(NotFoundException);
      expect(tx.address.delete).not.toHaveBeenCalled();
    });
  });
});
