import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let gateway: { pushToUser: jest.Mock };

  const ROW = { id: 'n1', userId: 'u1', type: 'ORDER_PLACED', title: 't', body: 'b', readAt: null };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue(ROW),
        findMany: jest.fn().mockResolvedValue([ROW]),
        findFirst: jest.fn().mockResolvedValue(ROW),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...ROW, readAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    gateway = { pushToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    // The row is the source of truth; the socket is a delivery optimisation.
    // Pushing first would let a connected client show something never persisted.
    it('writes the row before pushing over the socket', async () => {
      const order: string[] = [];
      prisma.notification.create.mockImplementation(async () => {
        order.push('db');
        return ROW;
      });
      gateway.pushToUser.mockImplementation(() => order.push('socket'));

      await service.create({ userId: 'u1', type: 'ORDER_PLACED', title: 't', body: 'b' });

      expect(order).toEqual(['db', 'socket']);
    });

    it('pushes to the recipient room only', async () => {
      await service.create({ userId: 'u1', type: 'ORDER_PLACED', title: 't', body: 'b' });

      expect(gateway.pushToUser).toHaveBeenCalledWith('u1', 'notification', ROW);
    });

    it('stores the deep-link ids as data', async () => {
      await service.create({
        userId: 'u1',
        type: 'VENDOR_ORDER_PLACED',
        title: 't',
        body: 'b',
        data: { orderId: 'o1', vendorOrderId: 'vo1' },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ data: { orderId: 'o1', vendorOrderId: 'vo1' } }),
        }),
      );
    });
  });

  describe('createMany', () => {
    it('writes every row in one transaction and pushes to each recipient', async () => {
      prisma.notification.create
        .mockResolvedValueOnce({ ...ROW, userId: 'buyer' })
        .mockResolvedValueOnce({ ...ROW, userId: 'vendor' });

      await service.createMany([
        { userId: 'buyer', type: 'ORDER_PLACED', title: 't', body: 'b' },
        { userId: 'vendor', type: 'VENDOR_ORDER_PLACED', title: 't', body: 'b' },
      ]);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(gateway.pushToUser).toHaveBeenCalledTimes(2);
      expect(gateway.pushToUser.mock.calls.map((c) => c[0])).toEqual(['buyer', 'vendor']);
    });
  });

  describe('findAllForUser', () => {
    it('scopes to the caller', async () => {
      await service.findAllForUser('u1', { page: 1, limit: 20 } as any);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });

    it('filters to unread when asked', async () => {
      await service.findAllForUser('u1', { page: 1, limit: 20, unreadOnly: 'true' } as any);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', readAt: null } }),
      );
    });

    it('reads the page and its total in one transaction so they cannot disagree', async () => {
      await service.findAllForUser('u1', { page: 1, limit: 20 } as any);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
    });
  });

  describe('markRead', () => {
    // Scoped by userId in the write itself: a caller cannot mark someone else's
    // notification read by guessing an id.
    it('scopes the update to the caller', async () => {
      await service.markRead('u1', 'n1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1', userId: 'u1', readAt: null } }),
      );
    });

    it('404s when the notification is not the caller own', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('u1', 'someone-elses')).rejects.toThrow(NotFoundException);
    });

    // Already-read is not an error - a client re-opening a notification should not
    // get a 404 for something it can see.
    it('returns the row when it was already read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue({ ...ROW, readAt: new Date() });

      await expect(service.markRead('u1', 'n1')).resolves.toMatchObject({ id: 'n1' });
    });
  });

  describe('markAllRead', () => {
    it('reports how many were marked, scoped to the caller unread rows', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });

      await expect(service.markAllRead('u1')).resolves.toEqual({ marked: 4 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', readAt: null } }),
      );
    });
  });

  describe('unreadCount', () => {
    it('counts only the caller unread rows', async () => {
      await service.unreadCount('u1');

      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'u1', readAt: null } });
    });
  });
});
