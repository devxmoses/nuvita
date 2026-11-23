import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmailProducer } from './email.producer';
import { EmailJob, QUEUE_EMAIL } from './queue-names';

describe('EmailProducer', () => {
  let producer: EmailProducer;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue({ id: '1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailProducer, { provide: getQueueToken(QUEUE_EMAIL), useValue: queue }],
    }).compile();
    producer = module.get(EmailProducer);
  });

  afterEach(() => jest.clearAllMocks());

  it('enqueues an order confirmation with the order id as payload', async () => {
    await producer.orderConfirmation({ orderId: 'o1', buyerId: 'b1' });

    expect(queue.add).toHaveBeenCalledWith(
      EmailJob.OrderConfirmation,
      { orderId: 'o1', buyerId: 'b1' },
      expect.objectContaining({ jobId: 'order-confirm:o1' }),
    );
  });

  // BullMQ ignores a second job carrying an id it already holds, so a retried
  // request or a listener that fires twice cannot send two confirmations.
  it('derives a stable job id from the order, so a repeat is deduplicated', async () => {
    await producer.orderConfirmation({ orderId: 'o1', buyerId: 'b1' });
    await producer.orderConfirmation({ orderId: 'o1', buyerId: 'b1' });

    const [first, second] = queue.add.mock.calls;
    expect(first[2].jobId).toBe(second[2].jobId);
  });

  it('gives each vendor order its own job id', async () => {
    await producer.vendorNewOrder({ vendorOrderId: 'vo1', vendorOwnerId: 'u1' });
    await producer.vendorNewOrder({ vendorOrderId: 'vo2', vendorOwnerId: 'u2' });

    expect(queue.add.mock.calls[0][2].jobId).not.toBe(queue.add.mock.calls[1][2].jobId);
  });

  // Each transition is its own email, but a repeat of the SAME transition is not.
  it('includes the status in a status-change job id', async () => {
    const base = { orderId: 'o1', vendorOrderId: 'vo1', buyerId: 'b1', vendorName: 'GV' };

    await producer.orderStatusChanged({ ...base, status: 'SHIPPED' });
    await producer.orderStatusChanged({ ...base, status: 'DELIVERED' });
    await producer.orderStatusChanged({ ...base, status: 'SHIPPED' });

    const ids = queue.add.mock.calls.map((call) => call[2].jobId);
    expect(ids[0]).toBe('order-status:vo1:SHIPPED');
    expect(ids[1]).toBe('order-status:vo1:DELIVERED');
    expect(ids[2]).toBe(ids[0]);
  });

  // The order is already committed by the time we enqueue. A Redis outage should
  // cost the buyer a confirmation email, not the order they just paid for.
  it('swallows a queue failure rather than propagating it to the caller', async () => {
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(producer.orderConfirmation({ orderId: 'o1', buyerId: 'b1' })).resolves.toBeUndefined();
  });

  it('enqueues a vendor approval email', async () => {
    await producer.vendorApproved({ vendorId: 'v1', ownerId: 'u1', vendorName: 'Green Valley' });

    expect(queue.add).toHaveBeenCalledWith(
      EmailJob.VendorApproved,
      expect.objectContaining({ vendorId: 'v1' }),
      expect.objectContaining({ jobId: 'vendor-approved:v1' }),
    );
  });
});
