import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EmailJob } from './queue-names';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let prisma: any;
  let mail: { send: jest.Mock; renderOrderConfirmation: jest.Mock; renderVendorNewOrder: jest.Mock; renderOrderStatus: jest.Mock; renderVendorApproved: jest.Mock };

  const job = (name: string, data: object = {}) => ({ name, data }) as any;

  beforeEach(async () => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          itemsTotal: 1000,
          deliveryTotal: 0,
          total: 1000,
          buyer: { email: 'buyer@example.com', name: 'Ada' },
          items: [{ productName: 'Ginger Shot', variantName: null, quantity: 1, unitPrice: 1000 }],
        }),
      },
      vendorOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vo1',
          subtotal: 1000,
          deliveryFee: 0,
          items: [{ productName: 'Ginger Shot', variantName: '250ml', quantity: 1, unitPrice: 1000 }],
          vendor: { name: 'Green Valley', owner: { email: 'vendor@example.com', name: 'Bo' } },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ email: 'buyer@example.com', name: 'Ada' }) },
    };

    mail = {
      send: jest.fn().mockResolvedValue(undefined),
      renderOrderConfirmation: jest.fn().mockReturnValue('<p>confirmation</p>'),
      renderVendorNewOrder: jest.fn().mockReturnValue('<p>new order</p>'),
      renderOrderStatus: jest.fn().mockReturnValue('<p>status</p>'),
      renderVendorApproved: jest.fn().mockReturnValue('<p>approved</p>'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    processor = module.get(EmailProcessor);
  });

  afterEach(() => jest.clearAllMocks());

  // The job carries ids, not a rendered email, so a job that sat in the queue
  // sends current data rather than a stale snapshot.
  it('re-reads the order at send time and mails the buyer', async () => {
    await processor.process(job(EmailJob.OrderConfirmation, { orderId: 'o1', buyerId: 'b1' }));

    expect(prisma.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' } }));
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'buyer@example.com' }));
  });

  it('combines the product and variant name on a line', async () => {
    await processor.process(job(EmailJob.VendorNewOrder, { vendorOrderId: 'vo1', vendorOwnerId: 'u1' }));

    expect(mail.renderVendorNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [expect.objectContaining({ name: 'Ginger Shot (250ml)' })] }),
    );
  });

  it('mails the vendor owner, not the buyer, about a new vendor order', async () => {
    await processor.process(job(EmailJob.VendorNewOrder, { vendorOrderId: 'vo1', vendorOwnerId: 'u1' }));

    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'vendor@example.com' }));
  });

  // A deleted order can never be mailed about. Retrying twice more only reaches
  // the same conclusion, so the job is failed permanently instead.
  it('raises UnrecoverableError when the order is gone, so BullMQ does not retry', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(
      processor.process(job(EmailJob.OrderConfirmation, { orderId: 'gone', buyerId: 'b1' })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('raises UnrecoverableError when the vendor order is gone', async () => {
    prisma.vendorOrder.findUnique.mockResolvedValue(null);

    await expect(
      processor.process(job(EmailJob.VendorNewOrder, { vendorOrderId: 'gone', vendorOwnerId: 'u1' })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('raises UnrecoverableError for a job name it does not understand', async () => {
    await expect(processor.process(job('send-telegram'))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  // A provider outage IS retryable, so it must propagate as an ordinary error and
  // let the backoff do its work.
  it('lets an ordinary send failure through so the job is retried', async () => {
    mail.send.mockRejectedValue(new Error('provider 503'));

    await expect(
      processor.process(job(EmailJob.OrderConfirmation, { orderId: 'o1', buyerId: 'b1' })),
    ).rejects.toThrow('provider 503');
  });

  it('mails the buyer on a status change, naming the vendor', async () => {
    await processor.process(
      job(EmailJob.OrderStatusChanged, {
        orderId: 'o1',
        vendorOrderId: 'vo1',
        buyerId: 'b1',
        vendorName: 'Green Valley',
        status: 'SHIPPED',
      }),
    );

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('Green Valley') }),
    );
  });

  it('mails the owner when their vendor is approved', async () => {
    await processor.process(
      job(EmailJob.VendorApproved, { vendorId: 'v1', ownerId: 'u1', vendorName: 'Green Valley' }),
    );

    expect(mail.renderVendorApproved).toHaveBeenCalled();
    expect(mail.send).toHaveBeenCalled();
  });
});
