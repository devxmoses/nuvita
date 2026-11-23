import { REQUEST_ID_HEADER, RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const run = (headers: Record<string, unknown> = {}) => {
    const req: any = { headers };
    const res: any = { setHeader: jest.fn() };
    const next = jest.fn();
    new RequestIdMiddleware().use(req, res, next);
    return { req, res, next };
  };

  it('generates an id and echoes it on the response', () => {
    const { req, res } = run();

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.id);
  });

  // Trusting an upstream id means a trace spans the proxy and the frontend rather
  // than restarting at this process.
  it('reuses an incoming id so a trace is not broken at the proxy', () => {
    const { req } = run({ [REQUEST_ID_HEADER]: 'from-upstream' });

    expect(req.id).toBe('from-upstream');
  });

  it('takes the first value when the header is repeated', () => {
    const { req } = run({ [REQUEST_ID_HEADER]: ['first', 'second'] });

    expect(req.id).toBe('first');
  });

  it('generates a fresh id when the header is present but empty', () => {
    const { req } = run({ [REQUEST_ID_HEADER]: '' });

    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('always continues the chain', () => {
    const { next } = run();

    expect(next).toHaveBeenCalled();
  });

  it('gives different requests different ids', () => {
    expect(run().req.id).not.toBe(run().req.id);
  });
});
