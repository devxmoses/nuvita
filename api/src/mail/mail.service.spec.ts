import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  const build = async (env: Record<string, string> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: { get: (key: string) => env[key] } },
      ],
    }).compile();
    const service = module.get(MailService);
    await service.onModuleInit();
    return service;
  };

  describe('without credentials', () => {
    it('does not throw, so the queue and templates work with no provider configured', async () => {
      const service = await build();

      await expect(
        service.send({ to: 'a@b.com', subject: 'hi', html: '<p>hi</p>' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('with a provider', () => {
    const withClient = async (send: jest.Mock) => {
      const service = await build();
      // the lazily imported client is private; injecting a fake is how we assert
      // on the send contract without reaching the network
      (service as unknown as { resend: { emails: { send: jest.Mock } } }).resend = {
        emails: { send },
      };
      return service;
    };

    it('passes the from, to, subject and html through', async () => {
      const send = jest.fn().mockResolvedValue({ error: null });
      const service = await withClient(send);

      await service.send({ to: 'buyer@example.com', subject: 'Confirmed', html: '<p>x</p>' });

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'buyer@example.com', subject: 'Confirmed', html: '<p>x</p>' }),
      );
    });

    // Resend reports failure in the response body rather than by rejecting, so an
    // unchecked call looks successful forever and the job is never retried.
    it('throws when the provider reports an error in the body', async () => {
      const send = jest
        .fn()
        .mockResolvedValue({ error: { name: 'validation_error', message: 'bad from address' } });
      const service = await withClient(send);

      await expect(service.send({ to: 'a@b.com', subject: 's', html: 'h' })).rejects.toThrow(
        /bad from address/,
      );
    });

    it('resolves quietly when the provider reports no error', async () => {
      const send = jest.fn().mockResolvedValue({ error: null });
      const service = await withClient(send);

      await expect(service.send({ to: 'a@b.com', subject: 's', html: 'h' })).resolves.toBeUndefined();
    });
  });

  describe('templates', () => {
    let service: MailService;
    beforeEach(async () => {
      service = await build();
    });

    // Product names are vendor-supplied. Without escaping, a vendor could name a
    // product "<script>..." and have it rendered in every buyer's mail client.
    it('escapes vendor-supplied product names', () => {
      const html = service.renderOrderConfirmation({
        name: 'Ada',
        orderId: 'o1',
        itemsTotal: 1000,
        deliveryTotal: 0,
        total: 1000,
        lines: [{ name: '<script>alert(1)</script>', quantity: 1, unitPrice: 1000 }],
      });

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes the recipient name too', () => {
      const html = service.renderOrderConfirmation({
        name: '<img onerror=x>',
        orderId: 'o1',
        itemsTotal: 0,
        deliveryTotal: 0,
        total: 0,
        lines: [],
      });

      expect(html).not.toContain('<img onerror');
    });

    it('formats minor units as currency rather than printing the integer', () => {
      const html = service.renderOrderConfirmation({
        name: 'Ada',
        orderId: 'o1',
        itemsTotal: 450000,
        deliveryTotal: 0,
        total: 450000,
        lines: [],
      });

      expect(html).toContain('4,500');
      expect(html).not.toContain('450000');
    });

    it('multiplies the unit price by the quantity on each line', () => {
      const html = service.renderOrderConfirmation({
        name: 'Ada',
        orderId: 'o1',
        itemsTotal: 600000,
        deliveryTotal: 0,
        total: 600000,
        lines: [{ name: 'Layer Feed', quantity: 3, unitPrice: 200000 }],
      });

      expect(html).toContain('6,000');
    });

    it('shows items, delivery and total separately', () => {
      const html = service.renderOrderConfirmation({
        name: 'Ada',
        orderId: 'o1',
        itemsTotal: 100000,
        deliveryTotal: 50000,
        total: 150000,
        lines: [],
      });

      expect(html).toContain('Items');
      expect(html).toContain('Delivery');
      expect(html).toContain('1,500');
    });

    it('tells a newly approved vendor to add delivery zones before the first order', () => {
      const html = service.renderVendorApproved({ name: 'Ada', vendorName: 'Green Valley' });

      expect(html).toMatch(/delivery zones/i);
    });

    it('names the vendor on a status change', () => {
      const html = service.renderOrderStatus({
        name: 'Ada',
        orderId: 'o1',
        vendorName: 'Green Valley',
        status: 'SHIPPED',
      });

      expect(html).toContain('Green Valley');
      expect(html).toContain('shipped');
    });
  });
});
