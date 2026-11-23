import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { CatchEveryFilter } from './catch-everything.filter';
import { Prisma } from '../../../generated/prisma/client';

describe('CatchEveryFilter', () => {
  let filter: CatchEveryFilter;
  let reply: jest.Mock;
  let logged: { level: string; line: string }[];

  const host = (request: Record<string, unknown> = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', originalUrl: '/api/v1/reviews', id: 'r', ...request }),
        getResponse: () => ({}),
      }),
    }) as any;

  beforeEach(() => {
    reply = jest.fn();
    filter = new CatchEveryFilter({
      httpAdapter: { reply, getRequestUrl: () => '/api/v1/reviews' },
    } as any);

    logged = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((l: any) => logged.push({ level: 'log', line: l }));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((l: any) => logged.push({ level: 'warn', line: l }));
    jest.spyOn(Logger.prototype, 'error').mockImplementation((l: any) => logged.push({ level: 'error', line: l }));
  });

  afterEach(() => jest.restoreAllMocks());

  const prismaError = (code: string, meta: object = {}) =>
    new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '7.0.0', meta } as any);

  describe('status mapping', () => {
    it('passes an HttpException status through', () => {
      filter.catch(new ConflictException('already exists'), host());

      expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 409);
    });

    it('maps P2002 to 409', () => {
      filter.catch(prismaError('P2002'), host());

      expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 409);
    });

    it('maps P2025 to 404', () => {
      filter.catch(prismaError('P2025'), host());

      expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 404);
    });

    it('maps P2003 to 400', () => {
      filter.catch(prismaError('P2003'), host());

      expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 400);
    });

    it('falls back to 500 for an unmapped Prisma code', () => {
      filter.catch(prismaError('P2037'), host());

      expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 500);
    });

    it('falls back to 500 for a plain Error', () => {
      filter.catch(new Error('kaboom'), host());

      expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 500);
    });
  });

  describe('logging', () => {
    // The reason the error line lives here and not in the interceptor: only this
    // method knows that a P2002 became a 409.
    it('logs the mapped status, not 500, for a Prisma conflict', () => {
      filter.catch(prismaError('P2002'), host());

      const line = logged.find((l) => l.line.includes('"status":409'));
      expect(line).toBeDefined();
      expect(line!.level).toBe('warn');
    });

    it('logs a 4xx at warn and a 5xx at error', () => {
      filter.catch(new BadRequestException('nope'), host());
      filter.catch(new Error('kaboom'), host());

      const structured = logged.filter((l) => l.line.startsWith('{'));
      expect(structured[0].level).toBe('warn');
      expect(structured[structured.length - 1].level).toBe('error');
    });

    it('carries the request id so the line joins the rest of the trace', () => {
      filter.catch(new ConflictException('x'), host({ id: 'req-42' }));

      expect(logged.some((l) => l.line.includes('req-42'))).toBe(true);
    });

    it('reports a duration when the middleware stamped a start time', () => {
      filter.catch(new ConflictException('x'), host({ startedAt: Date.now() - 15 }));

      const payload = JSON.parse(logged.find((l) => l.line.startsWith('{'))!.line);
      expect(payload.ms).toBeGreaterThanOrEqual(15);
    });

    // A structured line is for aggregation; the stack is for a human. Only the
    // genuinely unexpected branch keeps the stack.
    it('logs the stack separately for an unexpected error', () => {
      filter.catch(new Error('kaboom'), host());

      expect(logged.some((l) => l.line === 'Unexpected error')).toBe(true);
    });

    it('does not log a stack for an ordinary HttpException', () => {
      filter.catch(new ConflictException('x'), host());

      expect(logged.some((l) => l.line === 'Unexpected error')).toBe(false);
    });

    it('still replies to the client even though it also logs', () => {
      filter.catch(new ConflictException('x'), host());

      expect(reply).toHaveBeenCalled();
    });
  });
});
