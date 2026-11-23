import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductVariantsService } from './product-variants.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProductVariantsService', () => {
  let service: ProductVariantsService;
  let prisma: any;

  const VARIANT = {
    id: 'var1', productId: 'p1', name: '25kg', sku: 'LM-25KG',
    price: 150000, stock: 40, isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: 'Layer Mash' }) },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([VARIANT]),
        findUnique: jest.fn().mockResolvedValue(VARIANT),
        create: jest.fn().mockResolvedValue(VARIANT),
        update: jest.fn().mockResolvedValue(VARIANT),
        delete: jest.fn().mockResolvedValue(VARIANT),
      },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductVariantsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ProductVariantsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAllForProduct', () => {
    it('404s when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findAllForProduct('ghost')).rejects.toThrow(NotFoundException);
    });

    it('lists cheapest first, which is what a size picker shows', async () => {
      await service.findAllForProduct('p1');

      expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
        where: { productId: 'p1' },
        orderBy: { price: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('404s when the product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.create('ghost', { name: '25kg', price: 1 }))
        .rejects.toThrow(NotFoundException);
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('trims the name and defaults the stock to zero', async () => {
      await service.create('p1', { name: '  25kg  ', price: 150000 });

      expect(prisma.productVariant.create).toHaveBeenCalledWith({
        data: { productId: 'p1', name: '25kg', price: 150000, stock: 0, sku: null },
      });
    });

    // an empty SKU must be stored as null, not '', or the second blank SKU
    // collides with the first on the unique index
    it('stores a blank SKU as null', async () => {
      await service.create('p1', { name: '25kg', price: 1, sku: '   ' });

      expect(prisma.productVariant.create.mock.calls[0][0].data.sku).toBeNull();
    });
  });

  describe('update', () => {
    it('404s for a variant that does not exist', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.update('ghost', { price: 1 })).rejects.toThrow(NotFoundException);
    });

    it('clears the SKU when given an empty string', async () => {
      await service.update('var1', { sku: '' });

      expect(prisma.productVariant.update.mock.calls[0][0].data.sku).toBeNull();
    });

    it('leaves the SKU alone when the key is absent', async () => {
      await service.update('var1', { price: 99 });

      expect(prisma.productVariant.update.mock.calls[0][0].data).not.toHaveProperty('sku');
    });
  });

  describe('remove', () => {
    it('deletes a variant nothing has ordered', async () => {
      await service.remove('var1');

      expect(prisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: 'var1' } });
    });

    // OrderItem.variantId is onDelete: Restrict, so Postgres would refuse this
    // anyway - saying how many and pointing at isActive is more use than a
    // foreign-key error
    it('refuses to delete one that appears on orders, and says how many', async () => {
      prisma.orderItem.count.mockResolvedValue(4);

      await expect(service.remove('var1')).rejects.toThrow(ConflictException);
      await expect(service.remove('var1')).rejects.toThrow('4 order item(s)');

      expect(prisma.productVariant.delete).not.toHaveBeenCalled();
    });

    it('404s for a variant that does not exist', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.remove('ghost')).rejects.toThrow(NotFoundException);
    });
  });
});
