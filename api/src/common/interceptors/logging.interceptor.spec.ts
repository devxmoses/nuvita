import { Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logged: { level: string; line: string }[];

  const ctx = (request: Record<string, unknown>, statusCode = 200, type = 'http') =>
    ({
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode }),
      }),
    }) as any;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logged = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((line: any) => logged.push({ level: 'log', line }));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((line: any) => logged.push({ level: 'warn', line }));
    jest.spyOn(Logger.prototype, 'error').mockImplementation((line: any) => logged.push({ level: 'error', line }));
  });

  afterEach(() => jest.restoreAllMocks());

  const consume = (observable: any) =>
    new Promise<void>((resolve) =>
      observable.subscribe({ next: () => resolve(), error: () => resolve(), complete: () => resolve() }),
    );

  it('logs one structured line per successful request', async () => {
    await consume(
      interceptor.intercept(
        ctx({ method: 'GET', originalUrl: '/api/v1/products?page=2', id: 'req-1', startedAt: Date.now() }),
        { handle: () => of({}) } as any,
      ),
    );

    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0].line)).toMatchObject({
      id: 'req-1',
      method: 'GET',
      path: '/api/v1/products?page=2',
      status: 200,
    });
  });

  it('records the authenticated user id', async () => {
    await consume(
      interceptor.intercept(
        ctx({ method: 'GET', originalUrl: '/api/v1/orders', id: 'r', user: { id: 'u1' } }),
        { handle: () => of({}) } as any,
      ),
    );

    expect(JSON.parse(logged[0].line).userId).toBe('u1');
  });

  // Request bodies carry passwords and card data and must not reach the logs.
  it('never logs the request body or headers', async () => {
    await consume(
      interceptor.intercept(
        ctx({
          method: 'POST',
          originalUrl: '/api/v1/auth/login',
          id: 'r',
          body: { email: 'a@b.com', password: 'hunter2' },
          headers: { authorization: 'Bearer secret' },
        }),
        { handle: () => of({}) } as any,
      ),
    );

    expect(logged[0].line).not.toContain('hunter2');
    expect(logged[0].line).not.toContain('Bearer');
  });

  it('reports a duration from the timestamp the middleware stamped', async () => {
    await consume(
      interceptor.intercept(
        ctx({ method: 'GET', originalUrl: '/x', id: 'r', startedAt: Date.now() - 25 }),
        { handle: () => of({}) } as any,
      ),
    );

    expect(JSON.parse(logged[0].line).ms).toBeGreaterThanOrEqual(25);
  });

  it('warns on a 4xx that was returned normally rather than thrown', async () => {
    await consume(
      interceptor.intercept(ctx({ method: 'GET', originalUrl: '/x', id: 'r' }, 404), {
        handle: () => of({}),
      } as any),
    );

    expect(logged[0].level).toBe('warn');
  });

  // The error path belongs to CatchEveryFilter, which is the only place that knows
  // the mapped status. Logging here as well would double-log, and with the wrong
  // status: an interceptor sees the raw Prisma error, not the 409 it becomes.
  it('does not log a thrown error, leaving that to the exception filter', async () => {
    await consume(
      interceptor.intercept(ctx({ method: 'POST', originalUrl: '/x', id: 'r' }), {
        handle: () => throwError(() => Object.assign(new Error('nope'), { status: 409 })),
      } as any),
    );

    expect(logged).toHaveLength(0);
  });

  // Websocket frames and queue jobs are not HTTP requests and have no url.
  it('ignores non-http contexts', async () => {
    await consume(interceptor.intercept(ctx({}, 200, 'ws'), { handle: () => of({}) } as any));

    expect(logged).toHaveLength(0);
  });
});
