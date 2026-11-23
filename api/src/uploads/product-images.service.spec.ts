import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductImagesService } from './product-images.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { CacheService } from '../cache/cache.service';
import { cacheServiceMock } from '../common/testing/infra-test-providers';

describe('ProductImagesService', () => {
  let service: ProductImagesService;
  let prisma: any;
  let storage: any;
  let cache: ReturnType<typeof cacheServiceMock>;

  const IMAGE = { id: 'i1', productId: 'p1', key: 'products/p1/abc.webp', position: 0 };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }) },
      productImage: {
        create: jest.fn().mockResolvedValue(IMAGE),
        findMany: jest.fn().mockResolvedValue([IMAGE]),
        findUnique: jest.fn().mockResolvedValue(IMAGE),
        delete: jest.fn().mockResolvedValue(IMAGE),
      },
    };
    storage = {
      presignUpload: jest.fn().mockResolvedValue({ uploadUrl: 'https://u', key: 'products/p1/abc.webp' }),
      statObject: jest.fn().mockResolvedValue({ bytes: 1234, mimeType: 'image/webp' }),
      urlFor: jest.fn().mockResolvedValue('https://read/abc.webp'),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductImagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: CacheService, useValue: (cache = cacheServiceMock()) },
      ],
    }).compile();
    service = module.get(ProductImagesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('presign', () => {
    it('404s for an unknown product before touching storage', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.presign('nope', { mimeType: 'image/png', bytes: 10 })).rejects.toThrow(
        NotFoundException,
      );
      expect(storage.presignUpload).not.toHaveBeenCalled();
    });

    // Namespacing by product is what makes the key check in create() possible.
    it('namespaces the key by product id', async () => {
      await service.presign('p1', { mimeType: 'image/png', bytes: 10 });

      expect(storage.presignUpload).toHaveBeenCalledWith('products/p1', 'image/png', 10);
    });
  });

  describe('create', () => {
    // Without this, a vendor could pass another vendor's uploaded key and claim
    // their image.
    it('rejects a key that was not issued for this product', async () => {
      await expect(service.create('p1', { key: 'products/p2/stolen.webp' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productImage.create).not.toHaveBeenCalled();
    });

    it('rejects a key outside the products namespace entirely', async () => {
      await expect(service.create('p1', { key: '../../etc/passwd' })).rejects.toThrow(
        BadRequestException,
      );
    });

    // Otherwise a client could skip the upload and still register a key, leaving
    // rows that point at nothing.
    it('confirms the object exists in the bucket before writing the row', async () => {
      await service.create('p1', { key: 'products/p1/abc.webp' });

      expect(storage.statObject).toHaveBeenCalledWith('products/p1/abc.webp');
      expect(prisma.productImage.create).toHaveBeenCalled();
    });

    it('does not write a row when nothing was uploaded', async () => {
      storage.statObject.mockRejectedValue(new BadRequestException('no object'));

      await expect(service.create('p1', { key: 'products/p1/abc.webp' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.productImage.create).not.toHaveBeenCalled();
    });

    // Size and type come from the bucket, never from the client.
    it('records the byte size and type reported by storage', async () => {
      await service.create('p1', { key: 'products/p1/abc.webp' });

      expect(prisma.productImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bytes: 1234, mimeType: 'image/webp' }),
        }),
      );
    });

    it('returns a read url alongside the row', async () => {
      await expect(service.create('p1', { key: 'products/p1/abc.webp' })).resolves.toMatchObject({
        url: 'https://read/abc.webp',
      });
    });

    it('invalidates the product cache so the new image appears', async () => {
      await service.create('p1', { key: 'products/p1/abc.webp' });

      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });
  });

  describe('findAllForProduct', () => {
    it('orders by position then creation', async () => {
      await service.findAllForProduct('p1');

      expect(prisma.productImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      );
    });

    // Rows store a key; a signed url expires and a CDN domain can change.
    it('resolves a url per row rather than storing one', async () => {
      const images = await service.findAllForProduct('p1');

      expect(images[0].url).toBe('https://read/abc.webp');
      expect(storage.urlFor).toHaveBeenCalledWith('products/p1/abc.webp');
    });
  });

  describe('remove', () => {
    it('404s for an unknown image', async () => {
      prisma.productImage.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });

    // A deleted row with a stranded object is invisible; a deleted object with a
    // surviving row is a broken image on the storefront.
    it('deletes the row before the object', async () => {
      const order: string[] = [];
      prisma.productImage.delete.mockImplementation(async () => {
        order.push('row');
        return IMAGE;
      });
      storage.delete.mockImplementation(async () => {
        order.push('object');
      });

      await service.remove('i1');

      expect(order).toEqual(['row', 'object']);
    });

    it('invalidates the product cache', async () => {
      await service.remove('i1');

      expect(cache.invalidate).toHaveBeenCalledWith('products');
    });
  });
});
