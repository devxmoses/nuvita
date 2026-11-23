import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartsService } from './carts.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CartsService', () => {
  let service: CartsService;
  let prisma: any;

  const PRODUCT = {
    id: 'p1', name: 'Cold Pressed Ginger Shot 250ml', price: 4999,
    stock: 10, isActive: true, vendorId: 'v1', variants: [],
  };
  const VARIANT = {
    id: 'var1', productId: 'p1', name: '25kg', price: 150000,
    stock: 20, isActive: true,
  };
  const CART = { id: 'cart1', userId: 'u1' };
  const ITEM = { id: 'item1', cartId: 'cart1', productId: 'p1', variantId: null, quantity: 2 };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(PRODUCT) },
      productVariant: { findUnique: jest.fn().mockResolvedValue(VARIANT) },
      cart: {
        findUnique: jest.fn().mockResolvedValue(CART),
        upsert: jest.fn().mockResolvedValue(CART),
      },
      cartItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(ITEM),
        update: jest.fn().mockResolvedValue(ITEM),
        delete: jest.fn().mockResolvedValue(ITEM),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CartsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<CartsService>(CartsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getCart', () => {
    it('loads the cart by userId with its items, products and variants', async () => {
      await service.getCart('u1');

      expect(prisma.cart.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        include: { items: { include: { product: true, variant: true } } },
      });
    });

    it('returns an empty cart shape without creating a row', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);

      await expect(service.getCart('u1')).resolves.toEqual({ userId: 'u1', items: [] });
      expect(prisma.cart.upsert).not.toHaveBeenCalled();
    });
  });

  describe('addItem', () => {
    it('404s when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.addItem('u1', { productId: 'ghost', quantity: 1 }))
        .rejects.toThrow(NotFoundException);
    });

    it('rejects a deactivated product', async () => {
      prisma.product.findUnique.mockResolvedValue({ ...PRODUCT, isActive: false });

      await expect(service.addItem('u1', { productId: 'p1', quantity: 1 }))
        .rejects.toThrow(BadRequestException);
    });

    it('upserts the cart by userId so a first add cannot race itself', async () => {
      await service.addItem('u1', { productId: 'p1', quantity: 1 });

      expect(prisma.cart.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        update: {},
        create: { userId: 'u1' },
      });
    });

    it('increments an existing line instead of duplicating it', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(ITEM);

      await service.addItem('u1', { productId: 'p1', quantity: 3 });

      expect(prisma.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item1' },
          data: { quantity: { increment: 3 } },
        }),
      );
      expect(prisma.cartItem.create).not.toHaveBeenCalled();
    });

    // the (cart, product, variant) key cannot be a Prisma compound unique because
    // variantId is nullable, so the lookup has to spell out the null explicitly
    it('looks an existing line up by an explicit null variantId', async () => {
      await service.addItem('u1', { productId: 'p1', quantity: 1 });

      expect(prisma.cartItem.findFirst).toHaveBeenCalledWith({
        where: { cartId: 'cart1', productId: 'p1', variantId: null },
      });
    });

    describe('variants', () => {
      const withVariants = { ...PRODUCT, variants: [{ id: 'var1' }, { id: 'var2' }] };

      it('refuses a product sold by variant when no variant is chosen', async () => {
        prisma.product.findUnique.mockResolvedValue(withVariants);

        await expect(service.addItem('u1', { productId: 'p1', quantity: 1 }))
          .rejects.toThrow(/sold by variant/i);
      });

      it('404s for a variant that does not exist', async () => {
        prisma.product.findUnique.mockResolvedValue(withVariants);
        prisma.productVariant.findUnique.mockResolvedValue(null);

        await expect(service.addItem('u1', { productId: 'p1', variantId: 'ghost', quantity: 1 }))
          .rejects.toThrow(NotFoundException);
      });

      // pairing a cheap variant id with a different product would otherwise
      // let a buyer pay the wrong price
      it('refuses a variant belonging to another product', async () => {
        prisma.product.findUnique.mockResolvedValue(withVariants);
        prisma.productVariant.findUnique.mockResolvedValue({ ...VARIANT, productId: 'other' });

        await expect(service.addItem('u1', { productId: 'p1', variantId: 'var1', quantity: 1 }))
          .rejects.toThrow(/does not belong/i);
      });

      it('rejects a deactivated variant', async () => {
        prisma.product.findUnique.mockResolvedValue(withVariants);
        prisma.productVariant.findUnique.mockResolvedValue({ ...VARIANT, isActive: false });

        await expect(service.addItem('u1', { productId: 'p1', variantId: 'var1', quantity: 1 }))
          .rejects.toThrow(BadRequestException);
      });

      it('stores the variant on the new line', async () => {
        prisma.product.findUnique.mockResolvedValue(withVariants);

        await service.addItem('u1', { productId: 'p1', variantId: 'var1', quantity: 2 });

        expect(prisma.cartItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { cartId: 'cart1', productId: 'p1', variantId: 'var1', quantity: 2 },
          }),
        );
      });

      it('keeps two variants of one product as separate lines', async () => {
        prisma.product.findUnique.mockResolvedValue(withVariants);
        prisma.cartItem.findFirst.mockResolvedValue(null);

        await service.addItem('u1', { productId: 'p1', variantId: 'var1', quantity: 1 });

        expect(prisma.cartItem.findFirst).toHaveBeenCalledWith({
          where: { cartId: 'cart1', productId: 'p1', variantId: 'var1' },
        });
        expect(prisma.cartItem.create).toHaveBeenCalled();
      });
    });
  });

  // lines are addressed by their own id: with variants, productId no longer
  // identifies one line, since a cart can hold 5kg and 25kg of the same product
  describe('updateItem', () => {
    it('404s when the user has no cart', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);

      await expect(service.updateItem('u1', 'item1', { quantity: 5 }))
        .rejects.toThrow(NotFoundException);
    });

    it('404s when that item is not in the cart', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(service.updateItem('u1', 'item1', { quantity: 5 }))
        .rejects.toThrow(NotFoundException);
    });

    // scoped by cartId in the same query: a bare findUnique on the item id
    // would let one user edit another user's cart line
    it('scopes the lookup to the caller own cart', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(ITEM);

      await service.updateItem('u1', 'item1', { quantity: 5 });

      expect(prisma.cartItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'item1', cartId: 'cart1' },
      });
    });

    it('sets the exact quantity rather than incrementing', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(ITEM);

      await service.updateItem('u1', 'item1', { quantity: 5 });

      expect(prisma.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item1' },
          data: { quantity: 5 },
        }),
      );
    });
  });

  describe('removeItem', () => {
    it('404s when the user has no cart', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);

      await expect(service.removeItem('u1', 'item1')).rejects.toThrow(NotFoundException);
    });

    it('404s when that item is not in the cart', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(service.removeItem('u1', 'item1')).rejects.toThrow(NotFoundException);
    });

    it('deletes the line by its own id', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(ITEM);

      await service.removeItem('u1', 'item1');

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 'item1' } });
    });
  });

  describe('clearCart', () => {
    it('finds the cart by userId and deletes every item in it', async () => {
      await service.clearCart('u1');

      expect(prisma.cart.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'cart1' } });
    });

    it('is a no-op when the user has no cart', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);

      await expect(service.clearCart('u1')).resolves.toBeUndefined();
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });
  });
});
