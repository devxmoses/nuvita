import { Logger } from '@nestjs/common';
import { writeHttpLog } from './http-log';

describe('writeHttpLog', () => {
  let logged: { level: string; line: string }[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((l: any) => logged.push({ level: 'log', line: l }));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((l: any) => logged.push({ level: 'warn', line: l }));
    jest.spyOn(Logger.prototype, 'error').mockImplementation((l: any) => logged.push({ level: 'error', line: l }));
  });

  afterEach(() => jest.restoreAllMocks());

  const aRequest = (over: Record<string, unknown> = {}) =>
    ({ method: 'GET', originalUrl: '/x', id: 'r', startedAt: Date.now(), ...over }) as any;

  it('writes JSON, so the line is machine-readable', () => {
    writeHttpLog(aRequest(), 200);

    expect(() => JSON.parse(logged[0].line)).not.toThrow();
  });

  it('chooses the level from the status', () => {
    writeHttpLog(aRequest(), 200);
    writeHttpLog(aRequest(), 409);
    writeHttpLog(aRequest(), 500);

    expect(logged.map((l) => l.level)).toEqual(['log', 'warn', 'error']);
  });

  // The whole point of moving the error line into the filter: a Prisma P2002 is a
  // 409 to the client, and the log must say 409, not 500.
  it('records the status it is given, not the error class', () => {
    writeHttpLog(aRequest(), 409, 'Unique constraint failed');

    const payload = JSON.parse(logged[0].line);
    expect(payload.status).toBe(409);
    expect(payload.error).toBe('Unique constraint failed');
    expect(logged[0].level).toBe('warn');
  });

  it('omits the duration when nothing stamped a start time', () => {
    writeHttpLog(aRequest({ startedAt: undefined }), 200);

    expect(JSON.parse(logged[0].line).ms).toBeUndefined();
  });

  it('omits the error key entirely on a success', () => {
    writeHttpLog(aRequest(), 200);

    expect(logged[0].line).not.toContain('error');
  });
});
