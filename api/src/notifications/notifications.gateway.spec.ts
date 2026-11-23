import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from './notifications.gateway';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwt: { verifyAsync: jest.Mock };

  const aClient = (over: Record<string, unknown> = {}) => ({
    handshake: { auth: {}, headers: {} },
    data: {} as Record<string, unknown>,
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...over,
  }) as any;

  beforeEach(async () => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();
    gateway = module.get(NotificationsGateway);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleConnection', () => {
    it('joins the per-user room on a valid token', async () => {
      const client = aClient({ handshake: { auth: { token: 'good' }, headers: {} } });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:u1');
      expect(client.data.userId).toBe('u1');
      expect(client.emit).toHaveBeenCalledWith('ready', { userId: 'u1' });
    });

    it('strips a Bearer prefix from the handshake token', async () => {
      const client = aClient({ handshake: { auth: { token: 'Bearer good' }, headers: {} } });

      await gateway.handleConnection(client);

      expect(jwt.verifyAsync).toHaveBeenCalledWith('good', expect.anything());
    });

    // Some proxies and non-browser clients cannot set the auth payload.
    it('accepts a token from the Authorization header too', async () => {
      const client = aClient({
        handshake: { auth: {}, headers: { authorization: 'Bearer good' } },
      });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:u1');
    });

    // An unauthenticated socket is closed rather than left open and ignored, so
    // there is no half-authenticated state for a later handler to forget to check.
    it('disconnects a socket with no token', async () => {
      const client = aClient();

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('disconnects a socket whose token does not verify', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = aClient({ handshake: { auth: { token: 'stale' }, headers: {} } });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.userId).toBeUndefined();
    });

    // "expired" versus "malformed" is information an attacker can iterate against.
    it('does not leak why the token failed', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired at 2026-01-01'));
      const client = aClient({ handshake: { auth: { token: 'stale' }, headers: {} } });

      await gateway.handleConnection(client);

      const [, payload] = client.emit.mock.calls[0];
      expect(JSON.stringify(payload)).not.toMatch(/expired/);
    });
  });

  describe('pushToUser', () => {
    it('emits to that user room only', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as any;

      gateway.pushToUser('u1', 'notification', { id: 'n1' });

      expect(to).toHaveBeenCalledWith('user:u1');
      expect(emit).toHaveBeenCalledWith('notification', { id: 'n1' });
    });

    // A websocket failure must never propagate into the request that triggered it.
    it('swallows a server error', () => {
      gateway.server = {
        to: () => {
          throw new Error('server closed');
        },
      } as any;

      expect(() => gateway.pushToUser('u1', 'notification', {})).not.toThrow();
    });

    it('does not throw before the server is attached', () => {
      gateway.server = undefined as any;

      expect(() => gateway.pushToUser('u1', 'notification', {})).not.toThrow();
    });
  });
});
