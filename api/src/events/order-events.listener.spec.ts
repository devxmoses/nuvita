import { Test, TestingModule } from '@nestjs/testing';
import { OrderEventsListener } from './order-events.listener';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailProducer } from '../queues/email.producer';
import { CacheService } from '../cache/cache.service';
import { cacheServiceMock } from '../common/testing/infra-test-providers';
import { OrderPlacedEvent } from './domain-events';

describe('OrderEventsListener', () => {
  let listener: OrderEventsListener;
  let notifications: { create: jest.Mock; createMany: jest.Mock };
  let email: Record<string, jest.Mock>;
  let cache: ReturnType<typeof cacheServiceMock>;

  const PLACED: OrderPlacedEvent = {
    orderId: 'o1',
    buyerId: 'buyer1',
    total: 250000,
    itemsTotal: 200000,
    deliveryTotal: 50000,
    vendorOrders: [
      { vendorOrderId: 'vo1', vendorId: 'v1', vendorOwnerId: 'owner1', subtotal: 100000, deliveryFee: 25000, itemCount: 2 },
      { vendorOrderId: 'vo2', vendorId: 'v2', vendorOwnerId: 'owner2', subtotal: 100000, deliveryFee: 25000, itemCount: 1 },
    ],
  };

  beforeEach(async () => {
    notifications = {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue([]),
    };
    email = {
      orderConfirmation: jest.fn().mockResolvedValue(undefined),
      vendorNewOrder: jest.fn().mockResolvedValue(undefined),
      orderStatusChanged: jest.fn().mockResolvedValue(undefined),
      vendorApproved: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderEventsListener,
        { provide: NotificationsService, useValue: notifications },
        { provide: EmailProducer, useValue: email },
        { provide: CacheService, useValue: (cache = cacheServiceMock()) },
      ],
    }).compile();
    listener = module.get(OrderEventsListener);
  });

  afterEach(() => jest.clearAllMocks());

  describe('order.placed', () => {
    it('notifies the buyer and every vendor owner', async () => {
      await listener.onOrderPlaced(PLACED);

      const recipients = notifications.createMany.mock.calls[0][0].map((n: any) => n.userId);
      expect(recipients).toEqual(['buyer1', 'owner1', 'owner2']);
    });

    it('gives each vendor only their own subtotal and item count', async () => {
      await listener.onOrderPlaced(PLACED);

      const forOwner1 = notifications.createMany.mock.calls[0][0][1];
      expect(forOwner1.body).toContain('2 item');
      expect(forOwner1.data).toMatchObject({ vendorOrderId: 'vo1', vendorId: 'v1' });
    });

    it('enqueues one buyer confirmation and one email per vendor', async () => {
      await listener.onOrderPlaced(PLACED);

      expect(email.orderConfirmation).toHaveBeenCalledTimes(1);
      expect(email.vendorNewOrder).toHaveBeenCalledTimes(2);
    });

    it('invalidates the product cache, because stock moved', async () => {
      await listener.onOrderPlaced(PLACED);

      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });

    // Listeners are not awaited by the emitter, so an unhandled rejection here
    // would surface as a process-level warning and nothing else. Each side is
    // guarded so one failure cannot take out the others.
    it('still enqueues emails when writing notifications fails', async () => {
      notifications.createMany.mockRejectedValue(new Error('db down'));

      await expect(listener.onOrderPlaced(PLACED)).resolves.toBeUndefined();
      expect(email.orderConfirmation).toHaveBeenCalled();
    });

    it('still invalidates the cache when the queue is unreachable', async () => {
      email.orderConfirmation.mockRejectedValue(new Error('redis down'));

      await listener.onOrderPlaced(PLACED);

      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });

    it('never throws out of the listener', async () => {
      notifications.createMany.mockRejectedValue(new Error('x'));
      email.orderConfirmation.mockRejectedValue(new Error('y'));
      cache.invalidate.mockRejectedValue(new Error('z'));

      await expect(listener.onOrderPlaced(PLACED)).resolves.toBeUndefined();
    });
  });

  describe('order.cancelled', () => {
    it('notifies the buyer and each affected vendor owner', async () => {
      await listener.onOrderCancelled({
        orderId: 'o1',
        buyerId: 'buyer1',
        vendorOwnerIds: ['owner1', 'owner2'],
      });

      expect(notifications.createMany.mock.calls[0][0]).toHaveLength(3);
    });

    it('invalidates the product cache, because stock came back', async () => {
      await listener.onOrderCancelled({ orderId: 'o1', buyerId: 'b1', vendorOwnerIds: [] });

      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });
  });

  describe('vendor-order.status-changed', () => {
    const CHANGED = {
      orderId: 'o1',
      vendorOrderId: 'vo1',
      buyerId: 'buyer1',
      vendorId: 'v1',
      vendorName: 'Green Valley',
      from: 'ACCEPTED' as const,
      to: 'SHIPPED' as const,
    };

    it('notifies the buyer, not the vendor', async () => {
      await listener.onVendorOrderStatusChanged(CHANGED);

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'buyer1' }),
      );
    });

    it('carries the ids a client needs to deep-link', async () => {
      await listener.onVendorOrderStatusChanged(CHANGED);

      expect(notifications.create.mock.calls[0][0].data).toMatchObject({
        orderId: 'o1',
        vendorOrderId: 'vo1',
        status: 'SHIPPED',
      });
    });

    it('enqueues the status email', async () => {
      await listener.onVendorOrderStatusChanged(CHANGED);

      expect(email.orderStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SHIPPED', vendorName: 'Green Valley' }),
      );
    });
  });

  describe('vendor.approved', () => {
    it('notifies the owner and invalidates both listings', async () => {
      await listener.onVendorApproved({ vendorId: 'v1', vendorName: 'Green Valley', ownerId: 'u1' });

      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
      expect(cache.invalidate).toHaveBeenCalledWith('vendors');
      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });

    it('enqueues the approval email', async () => {
      await listener.onVendorApproved({ vendorId: 'v1', vendorName: 'Green Valley', ownerId: 'u1' });

      expect(email.vendorApproved).toHaveBeenCalled();
    });
  });
});
