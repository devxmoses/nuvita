import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '../../generated/prisma/enums';
import { DeliveryZonesService } from '../delivery-zones/delivery-zones.service';
import { cacheServiceMock, eventEmitterMock, infraProviders } from '../common/testing/infra-test-providers';

// every checkout test ships to the same saved address
const ADDRESS = {
  id: 'addr1', userId: 'buyer1', label: 'Home',
  line1: '12 Agodi Road', line2: null, city: 'Ibadan', state: 'Oyo',
  postalCode: null, country: 'NG', phone: null, isDefault: true,
};
const ORDER_DTO = { shippingAddressId: ADDRESS.id };

type TxMock = {
  cart: { findUnique: jest.Mock };
  cartItem: { deleteMany: jest.Mock };
  product: { updateMany: jest.Mock; update: jest.Mock };
  productVariant: { updateMany: jest.Mock; update: jest.Mock };
  address: { findFirst: jest.Mock };
  vendor: { findUnique: jest.Mock };
  vendorOrder: { create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
  orderItem: { createMany: jest.Mock };
  order: { create: jest.Mock; findUnique: jest.Mock; findUniqueOrThrow: jest.Mock; update: jest.Mock };
};

describe('OrdersService', () => {
  let service: OrdersService;
  let events: ReturnType<typeof eventEmitterMock>;
  let tx: TxMock;
  let prisma: {
    order: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    orderItem: { findMany: jest.Mock };
    vendorOrder: { findMany: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let deliveryZones: { resolve: jest.Mock };

  const aProduct = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    name: 'Cold Pressed Ginger Shot',
    price: 1000,
    stock: 10,
    vendorId: 'v1',
    isActive: true,
    ...over,
  });

  const aCart = (...items: Array<{ quantity: number; product: ReturnType<typeof aProduct> }>) => ({
    id: 'cart1',
    // checkout reads cartItem.variant; a product-only line carries null
    items: items.map((item) => ({ ...item, variant: null })),
  });

  beforeEach(async () => {
    tx = {
      cart: { findUnique: jest.fn() },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      product: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      address: { findFirst: jest.fn().mockResolvedValue(ADDRESS) },
      vendor: { findUnique: jest.fn().mockResolvedValue({ name: 'Green Valley Nutrition' }) },
      vendorOrder: {
        create: jest.fn().mockResolvedValue({ id: 'vo1' }),
        findMany: jest.fn().mockResolvedValue([{ status: 'PENDING' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'vo1', status: 'ACCEPTED' }),
      },
      orderItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'order1' }),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'order1',
          total: 2000,
          itemsTotal: 2000,
          deliveryTotal: 0,
          items: [],
          vendorOrders: [
            {
              id: 'vo1',
              vendorId: 'v1',
              subtotal: 2000,
              deliveryFee: 0,
              items: [{ id: 'oi1' }],
              vendor: { ownerId: 'owner1' },
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({
          id: 'order1',
          buyerId: 'buyer1',
          status: 'CANCELLED',
          items: [],
          vendorOrders: [{ vendor: { ownerId: 'owner1' } }],
        }),
      },
    };

    // NOTE: cart / cartItem / product are deliberately absent from the base client mock.
    // Anything inside a $transaction that reaches for this.prisma instead of tx will
    // throw a TypeError here, which is the regression guard for transaction-scope bugs.
    prisma = {
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'order1' }),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      vendorOrder: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: (t: TxMock) => unknown) => cb(tx)),
    };

    // every vendor delivers, free, unless a test says otherwise
    deliveryZones = {
      resolve: jest.fn().mockResolvedValue({ zoneId: 'z1', zoneName: 'Ibadan metro', fee: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: DeliveryZonesService, useValue: deliveryZones },
        ...infraProviders(cacheServiceMock(), (events = eventEmitterMock())),
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create (checkout)', () => {
    it('rejects checkout when the buyer has no cart at all', async () => {
      tx.cart.findUnique.mockResolvedValue(null);

      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(BadRequestException);
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('rejects checkout when the cart exists but has been emptied', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart());

      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(BadRequestException);
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('rejects checkout when a product has been deactivated, before touching stock', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct({ isActive: false }) }));

      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(BadRequestException);
      expect(tx.product.updateMany).not.toHaveBeenCalled();
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('decrements stock with a gte guard so oversold rows cannot match', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 2, product: aProduct() }));

      await service.create('buyer1', ORDER_DTO);

      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
    });

    it('aborts with a conflict when the guarded decrement matches no row', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 99, product: aProduct() }));
      tx.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(ConflictException);
      expect(tx.order.create).not.toHaveBeenCalled();
      expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('computes the total from live product prices, not anything client supplied', async () => {
      tx.cart.findUnique.mockResolvedValue(
        aCart(
          { quantity: 2, product: aProduct({ id: 'p1', price: 1000 }) },
          { quantity: 3, product: aProduct({ id: 'p2', price: 250 }) },
        ),
      );

      await service.create('buyer1', ORDER_DTO);

      expect(tx.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ total: 2750 }) }),
      );
    });

    it('snapshots name, unit price and vendor onto each order item', async () => {
      tx.cart.findUnique.mockResolvedValue(
        aCart({ quantity: 2, product: aProduct({ name: 'Cold Pressed Ginger Shot', price: 1000, vendorId: 'v1' }) }),
      );

      await service.create('buyer1', ORDER_DTO);

      // items are written by createMany now, with both foreign keys: an OrderItem
      // belongs to the Order and to the VendorOrder, so neither can nest-create it
      expect(tx.orderItem.createMany).toHaveBeenCalledWith({
        data: [
          {
            productId: 'p1',
            vendorId: 'v1',
            variantId: null,
            productName: 'Cold Pressed Ginger Shot',
            variantName: null,
            quantity: 2,
            unitPrice: 1000,
            orderId: 'order1',
            vendorOrderId: 'vo1',
          },
        ],
      });
    });

    it('freezes a copy of the shipping address onto the order', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));

      await service.create('buyer1', ORDER_DTO);

      const { data } = tx.order.create.mock.calls[0][0];
      expect(data.shippingAddressId).toBe('addr1');
      expect(data.shippingSnapshot).toMatchObject({
        line1: '12 Agodi Road', city: 'Ibadan', state: 'Oyo', country: 'NG',
      });
    });

    it('scopes the address lookup to the buyer', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));

      await service.create('buyer1', ORDER_DTO);

      expect(tx.address.findFirst).toHaveBeenCalledWith({
        where: { id: 'addr1', userId: 'buyer1' },
      });
    });

    it('404s when the address is not the buyer own', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));
      tx.address.findFirst.mockResolvedValue(null);

      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(NotFoundException);
    });

    it('creates one vendor order per vendor, each with its own subtotal', async () => {
      tx.cart.findUnique.mockResolvedValue(
        aCart(
          { quantity: 2, product: aProduct({ id: 'p1', vendorId: 'v1', price: 1000 }) },
          { quantity: 1, product: aProduct({ id: 'p2', vendorId: 'v2', price: 5000 }) },
        ),
      );

      await service.create('buyer1', ORDER_DTO);

      expect(tx.vendorOrder.create).toHaveBeenCalledTimes(2);
      const subtotals = tx.vendorOrder.create.mock.calls.map((c: any) => c[0].data.subtotal);
      expect(subtotals.sort((a: number, b: number) => a - b)).toEqual([2000, 5000]);
    });

    it('groups two products from one vendor into a single vendor order', async () => {
      tx.cart.findUnique.mockResolvedValue(
        aCart(
          { quantity: 1, product: aProduct({ id: 'p1', vendorId: 'v1', price: 1000 }) },
          { quantity: 1, product: aProduct({ id: 'p2', vendorId: 'v1', price: 2000 }) },
        ),
      );

      await service.create('buyer1', ORDER_DTO);

      expect(tx.vendorOrder.create).toHaveBeenCalledTimes(1);
      expect(tx.vendorOrder.create.mock.calls[0][0].data.subtotal).toBe(3000);
    });

    it('adds each vendor delivery fee into the order total', async () => {
      tx.cart.findUnique.mockResolvedValue(
        aCart(
          { quantity: 1, product: aProduct({ id: 'p1', vendorId: 'v1', price: 1000 }) },
          { quantity: 1, product: aProduct({ id: 'p2', vendorId: 'v2', price: 2000 }) },
        ),
      );
      deliveryZones.resolve.mockResolvedValue({ zoneId: 'z1', zoneName: 'Ibadan', fee: 500 });

      await service.create('buyer1', ORDER_DTO);

      const { data } = tx.order.create.mock.calls[0][0];
      expect(data.itemsTotal).toBe(3000);
      expect(data.deliveryTotal).toBe(1000); // 500 per vendor, two vendors
      expect(data.total).toBe(4000);
    });

    // a vendor with no zone covering the address cannot fulfil, and silently
    // charging zero would commit it to a delivery it never agreed to
    it('refuses checkout when a vendor does not deliver to the address', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));
      deliveryZones.resolve.mockResolvedValue(null);

      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(BadRequestException);
      await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(/does not deliver/i);
    });

    it('resolves delivery inside the transaction, not on the base client', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));

      await service.create('buyer1', ORDER_DTO);

      expect(deliveryZones.resolve).toHaveBeenCalledWith(
        'v1',
        { country: 'NG', state: 'Oyo', city: 'Ibadan' },
        1000,
        tx,
      );
    });

    describe('variant lines', () => {
      const aVariant = (over: Record<string, unknown> = {}) => ({
        id: 'var1', productId: 'p1', name: '25kg', price: 150000,
        stock: 20, isActive: true, ...over,
      });

      it('prices the line from the variant, not the product', async () => {
        tx.cart.findUnique.mockResolvedValue({
          id: 'cart1',
          items: [{ quantity: 1, product: aProduct({ price: 1000 }), variant: aVariant({ price: 7500 }) }],
        });

        await service.create('buyer1', ORDER_DTO);

        const row = tx.orderItem.createMany.mock.calls[0][0].data[0];
        expect(row.unitPrice).toBe(7500);
        expect(row.variantId).toBe('var1');
        expect(row.variantName).toBe('25kg');
      });

      it('decrements variant stock, never the product stock', async () => {
        tx.cart.findUnique.mockResolvedValue({
          id: 'cart1',
          items: [{ quantity: 3, product: aProduct(), variant: aVariant() }],
        });

        await service.create('buyer1', ORDER_DTO);

        expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
          where: { id: 'var1', stock: { gte: 3 } },
          data: { stock: { decrement: 3 } },
        });
        expect(tx.product.updateMany).not.toHaveBeenCalled();
      });

      it('409s when the variant is short, naming the variant', async () => {
        tx.cart.findUnique.mockResolvedValue({
          id: 'cart1',
          items: [{ quantity: 99, product: aProduct(), variant: aVariant() }],
        });
        tx.productVariant.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(ConflictException);
        await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow('25kg');
      });

      it('rejects a line whose variant has been deactivated', async () => {
        tx.cart.findUnique.mockResolvedValue({
          id: 'cart1',
          items: [{ quantity: 1, product: aProduct(), variant: aVariant({ isActive: false }) }],
        });

        await expect(service.create('buyer1', ORDER_DTO)).rejects.toThrow(BadRequestException);
      });
    });

    it('clears the cart only after the order row exists', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));

      await service.create('buyer1', ORDER_DTO);

      expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'cart1' } });
      expect(tx.order.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.cartItem.deleteMany.mock.invocationCallOrder[0],
      );
    });

    it('runs every write through the transaction client', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));

      await service.create('buyer1', ORDER_DTO);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const pendingOrder = (items: Array<{ productId: string; quantity: number }>) => ({
      id: 'order1',
      status: 'PENDING',
      items,
    });

    it('404s when the order does not exist', async () => {
      tx.order.findUnique.mockResolvedValue(null);

      await expect(service.cancel('missing')).rejects.toThrow(NotFoundException);
      expect(tx.product.update).not.toHaveBeenCalled();
    });

    it('refuses to cancel an order that has moved past PENDING, and does not restock', async () => {
      tx.order.findUnique.mockResolvedValue({ id: 'order1', status: 'PAID', items: [] });

      await expect(service.cancel('order1')).rejects.toThrow(ConflictException);
      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('restocks every line item by its ordered quantity', async () => {
      tx.order.findUnique.mockResolvedValue(
        pendingOrder([
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 5 },
        ]),
      );

      await service.cancel('order1');

      expect(tx.product.update).toHaveBeenCalledTimes(2);
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { stock: { increment: 2 } },
      });
      expect(tx.product.update).toHaveBeenCalledWith({
        where: { id: 'p2' },
        data: { stock: { increment: 5 } },
      });
    });

    it('marks the order CANCELLED', async () => {
      tx.order.findUnique.mockResolvedValue(pendingOrder([{ productId: 'p1', quantity: 1 }]));

      await service.cancel('order1');

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order1' }, data: { status: 'CANCELLED' } }),
      );
    });
  });

  describe('updateStatus', () => {
    it('refuses CANCELLED so cancellation cannot skip the restock path', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'order1', items: [] });

      await expect(service.updateStatus('order1', { status: OrderStatus.CANCELLED })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('applies any other status', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'order1', items: [] });

      await service.updateStatus('order1', { status: OrderStatus.SHIPPED });

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order1' },
        data: { status: 'SHIPPED' },
      });
    });

    it('404s before updating when the order is missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus('missing', { status: OrderStatus.SHIPPED })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('read paths', () => {
    it('findOne 404s when the order is missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('findAllForBuyer scopes the query to that buyer', async () => {
      await service.findAllForBuyer('buyer1');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buyerId: 'buyer1' } }),
      );
    });

    // a vendor sees VendorOrders, not raw order items: that is the unit it
    // accepts and ships, and it exposes nothing about the other vendors on the
    // same buyer order
    it('findAllForVendor scopes vendor orders to that vendor', async () => {
      await service.findAllForVendor('v1');

      expect(prisma.vendorOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: 'v1' } }),
      );
    });

    it('findAllForVendor narrows by status when one is given', async () => {
      await service.findAllForVendor('v1', 'SHIPPED');

      expect(prisma.vendorOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vendorId: 'v1', status: 'SHIPPED' } }),
      );
    });
  });

  describe('domain events', () => {
    // Emitting inside the transaction would still fire if it went on to roll
    // back, and the email it queues would reference an order that never existed.
    it('emits order.placed only after the transaction resolves', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const result = await cb(tx);
        order.push('commit');
        return result;
      });
      (events.emit as jest.Mock).mockImplementation(() => {
        order.push('emit');
        return true;
      });

      await service.create('buyer1', { shippingAddressId: 'a1' });

      expect(order).toEqual(['commit', 'emit']);
    });

    it('emits order.placed with one entry per vendor order, carrying the owner', async () => {
      tx.cart.findUnique.mockResolvedValue(aCart({ quantity: 1, product: aProduct() }));

      await service.create('buyer1', { shippingAddressId: 'a1' });

      const [name, payload] = (events.emit as jest.Mock).mock.calls[0];
      expect(name).toBe('order.placed');
      expect(payload.vendorOrders).toEqual([
        expect.objectContaining({ vendorOrderId: 'vo1', vendorOwnerId: 'owner1', itemCount: 1 }),
      ]);
    });

    it('does not emit when checkout fails', async () => {
      tx.cart.findUnique.mockResolvedValue({ id: 'c1', items: [] });

      await expect(service.create('buyer1', { shippingAddressId: 'a1' })).rejects.toThrow();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('emits vendor-order.status-changed with both the old and the new status', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue({
        id: 'vo1', status: 'ACCEPTED', orderId: 'o1', items: [],
      });
      tx.vendorOrder.update.mockResolvedValue({
        id: 'vo1', orderId: 'o1', vendorId: 'v1', status: 'SHIPPED',
        items: [], vendor: { name: 'Green Valley' }, order: { buyerId: 'buyer1' },
      });

      await service.updateVendorOrderStatus('vo1', 'SHIPPED');

      expect(events.emit).toHaveBeenCalledWith(
        'vendor-order.status-changed',
        expect.objectContaining({ from: 'ACCEPTED', to: 'SHIPPED', buyerId: 'buyer1' }),
      );
    });

    it('does not emit when the transition is refused', async () => {
      prisma.vendorOrder.findUnique.mockResolvedValue({
        id: 'vo1', status: 'DELIVERED', orderId: 'o1', items: [],
      });

      await expect(service.updateVendorOrderStatus('vo1', 'PENDING')).rejects.toThrow();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('emits order.cancelled with de-duplicated vendor owners', async () => {
      tx.order.findUnique.mockResolvedValue({ id: 'o1', status: 'PENDING', items: [] });
      tx.order.update.mockResolvedValue({
        id: 'o1', buyerId: 'buyer1', status: 'CANCELLED', items: [],
        // the same owner runs two vendors on this order
        vendorOrders: [{ vendor: { ownerId: 'owner1' } }, { vendor: { ownerId: 'owner1' } }],
      });

      await service.cancel('o1');

      expect(events.emit).toHaveBeenCalledWith(
        'order.cancelled',
        expect.objectContaining({ vendorOwnerIds: ['owner1'] }),
      );
    });
  });
});
