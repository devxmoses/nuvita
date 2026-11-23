import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ConfigService } from '@nestjs/config';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://bucket.example/signed'),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const CONFIGURED = {
  S3_BUCKET: 'nuvita-media',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('StorageService', () => {
  const build = async (env: Record<string, string> = CONFIGURED) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      ],
    }).compile();
    const service = module.get(StorageService);
    service.onModuleInit();
    return service;
  };

  afterEach(() => jest.clearAllMocks());

  describe('when not configured', () => {
    it('reports a clear 400 rather than failing deep in the SDK', async () => {
      const service = await build({});

      await expect(service.presignUpload('products/p1', 'image/png', 100)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildKey', () => {
    it('namespaces by the prefix and uses the extension for the type', async () => {
      const service = await build();

      expect(service.buildKey('products/p1', 'image/webp')).toMatch(
        /^products\/p1\/[0-9a-f-]{36}\.webp$/,
      );
    });

    // A caller-supplied filename invites traversal, collisions and overwrites of
    // another vendor's object.
    it('never reuses a client filename - two calls differ', async () => {
      const service = await build();

      expect(service.buildKey('products/p1', 'image/png')).not.toBe(
        service.buildKey('products/p1', 'image/png'),
      );
    });

    // SVG is a script-carrying document, not just an image; serving one from your
    // own origin is stored XSS.
    it('refuses SVG', async () => {
      const service = await build();

      expect(() => service.buildKey('products/p1', 'image/svg+xml')).toThrow(BadRequestException);
    });

    it('refuses a type that is not on the allow-list', async () => {
      const service = await build();

      expect(() => service.buildKey('products/p1', 'application/pdf')).toThrow(BadRequestException);
    });
  });

  describe('presignUpload', () => {
    it('returns the url, the key and the headers the browser must send', async () => {
      const service = await build();

      const result = await service.presignUpload('products/p1', 'image/jpeg', 2048);

      expect(result.uploadUrl).toBe('https://bucket.example/signed');
      expect(result.key).toMatch(/\.jpg$/);
      expect(result.requiredHeaders).toEqual({
        'Content-Type': 'image/jpeg',
        'Content-Length': '2048',
      });
    });

    // Pinning both into the signature is what stops the url being reused to upload
    // something bigger or of another type - S3 rejects the mismatch itself.
    it('pins the content type and exact length into the signed command', async () => {
      const service = await build();

      await service.presignUpload('products/p1', 'image/png', 4096);

      const command = (getSignedUrl as jest.Mock).mock.calls[0][1];
      expect(command.input).toMatchObject({ ContentType: 'image/png', ContentLength: 4096 });
    });

    it('expires the signature in minutes, not hours', async () => {
      const service = await build();

      const result = await service.presignUpload('products/p1', 'image/png', 100);

      expect(result.expiresIn).toBeLessThanOrEqual(600);
    });

    it('refuses a file over the size limit', async () => {
      const service = await build();

      await expect(
        service.presignUpload('products/p1', 'image/png', 6 * 1024 * 1024),
      ).rejects.toThrow(/limit/);
    });

    it('refuses a zero or negative length', async () => {
      const service = await build();

      await expect(service.presignUpload('products/p1', 'image/png', 0)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('urlFor', () => {
    // A CDN in front of a public bucket needs no signing.
    it('builds a plain url when a public base is configured', async () => {
      const service = await build({ ...CONFIGURED, S3_PUBLIC_BASE_URL: 'https://cdn.nuvita.test/' });

      await expect(service.urlFor('products/p1/a.webp')).resolves.toBe(
        'https://cdn.nuvita.test/products/p1/a.webp',
      );
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('signs a GET when the bucket is private', async () => {
      const service = await build();

      await expect(service.urlFor('products/p1/a.webp')).resolves.toBe(
        'https://bucket.example/signed',
      );
      expect(getSignedUrl).toHaveBeenCalled();
    });
  });
});
