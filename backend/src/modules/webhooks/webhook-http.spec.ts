import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { guardedLookup, webhookFetch } from './webhook-http';
import { UnsafeWebhookTargetError } from './url-safety';

// The live module object, so a spy here is the lookup webhook-http calls.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dnsModule = require('node:dns');

/**
 * These run against a real HTTP server on 127.0.0.1. The point of
 * webhookFetch is what happens at the socket, so mocking fetch would test
 * nothing. Every "refused" case also asserts the server never saw a request.
 */
describe('webhook-http', () => {
  const env = { ...process.env };
  let server: Server;
  let port: number;
  let hits: Array<{ method?: string; url?: string; headers: IncomingMessage['headers']; body: string }>;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        hits.push({ method: req.method, url: req.url, headers: req.headers, body });
        handler(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    process.env = env;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = [];
    handler = (_req, res) => {
      res.writeHead(201, { 'Content-Type': 'text/plain' });
      res.end('received');
    };
    process.env.NODE_ENV = 'test';
    delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    jest.restoreAllMocks();
  });

  const post = (url: string, signal?: AbortSignal) =>
    webhookFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HRMS-Event': 'leave.approved' },
      body: '{"event":"leave.approved"}',
      signal: signal ?? AbortSignal.timeout(5_000),
    });

  describe('refuses private targets at the socket', () => {
    it('refuses a hostname that resolves to loopback', async () => {
      await expect(post(`http://localhost:${port}/hook`)).rejects.toBeInstanceOf(
        UnsafeWebhookTargetError,
      );
      expect(hits).toHaveLength(0);
    });

    it('refuses a loopback IP literal, which never reaches lookup', async () => {
      await expect(post(`http://127.0.0.1:${port}/hook`)).rejects.toThrow(/loopback/);
      expect(hits).toHaveLength(0);
    });

    it('refuses the hex IPv4-mapped form of loopback', async () => {
      await expect(post(`http://[::ffff:127.0.0.1]:${port}/hook`)).rejects.toBeInstanceOf(
        UnsafeWebhookTargetError,
      );
      expect(hits).toHaveLength(0);
    });

    it('refuses a rebinding name: the address it connects with is the one judged', async () => {
      // A name that any earlier check would have seen as public, answering the
      // connection's own lookup with loopback. No pre-check runs here, so this
      // passes only because the guard sits inside the connection.
      jest.spyOn(dnsModule, 'lookup').mockImplementation((...args: any[]) => {
        const callback = args[args.length - 1];
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
      });

      await expect(post(`http://rebind.example.test:${port}/hook`)).rejects.toThrow(
        /resolves to 127\.0\.0\.1/,
      );
      expect(hits).toHaveLength(0);
    });

    it('refuses a name when any one of its addresses is private', async () => {
      jest.spyOn(dnsModule, 'lookup').mockImplementation((...args: any[]) => {
        const callback = args[args.length - 1];
        callback(null, [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]);
      });

      await expect(post(`http://split.example.test:${port}/hook`)).rejects.toThrow(
        /127\.0\.0\.1/,
      );
      expect(hits).toHaveLength(0);
    });

    it('refuses a scheme other than http or https', async () => {
      await expect(post('ftp://example.com/hook')).rejects.toBeInstanceOf(
        UnsafeWebhookTargetError,
      );
    });

    it('refuses a malformed URL', async () => {
      await expect(post('not a url')).rejects.toBeInstanceOf(UnsafeWebhookTargetError);
    });
  });

  describe('delivery, with private targets opted into for the local server', () => {
    beforeEach(() => {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
    });

    it('posts the body and headers and returns the status and response body', async () => {
      const response = await post(`http://127.0.0.1:${port}/hook`);

      expect(response.status).toBe(201);
      expect(await response.text()).toBe('received');
      expect(hits).toHaveLength(1);
      expect(hits[0].method).toBe('POST');
      expect(hits[0].url).toBe('/hook');
      expect(hits[0].body).toBe('{"event":"leave.approved"}');
      expect(hits[0].headers['x-hrms-event']).toBe('leave.approved');
      expect(hits[0].headers['content-length']).toBe(
        String(Buffer.byteLength('{"event":"leave.approved"}')),
      );
    });

    it('connects through the guarded lookup for a hostname', async () => {
      const response = await post(`http://localhost:${port}/hook`);
      expect(response.status).toBe(201);
      expect(hits).toHaveLength(1);
    });

    it('does not follow a redirect', async () => {
      handler = (_req, res) => {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      };

      const response = await post(`http://127.0.0.1:${port}/hook`);

      expect(response.status).toBe(302);
      expect(hits).toHaveLength(1);
    });

    it('stops reading a very large response body', async () => {
      handler = (_req, res) => {
        res.writeHead(200);
        res.end('x'.repeat(1024 * 1024));
      };

      const response = await post(`http://127.0.0.1:${port}/hook`);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text.length).toBeGreaterThanOrEqual(64 * 1024);
      expect(text.length).toBeLessThan(1024 * 1024);
    });

    it('gives up when the endpoint does not answer in time', async () => {
      handler = () => {
        // Never respond.
      };

      await expect(
        post(`http://127.0.0.1:${port}/hook`, AbortSignal.timeout(100)),
      ).rejects.toThrow();
    });

    it('surfaces a connection failure as a rejection', async () => {
      // Nothing listens on port 1.
      await expect(post('http://127.0.0.1:1/hook')).rejects.toThrow();
    });
  });

  describe('guardedLookup', () => {
    const answer = (addresses: Array<{ address: string; family: number }>) =>
      jest.spyOn(dnsModule, 'lookup').mockImplementation((...args: any[]) => {
        const callback = args[args.length - 1];
        callback(null, addresses);
      });

    it('answers in the all-addresses shape when asked for all', (done) => {
      answer([{ address: '93.184.216.34', family: 4 }]);
      guardedLookup('example.com', { all: true }, (error, addresses) => {
        expect(error).toBeNull();
        expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
        done();
      });
    });

    it('answers in the single-address shape otherwise', (done) => {
      answer([{ address: '93.184.216.34', family: 4 }]);
      guardedLookup('example.com', {}, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe('93.184.216.34');
        expect(family).toBe(4);
        done();
      });
    });

    it('always resolves every address, whatever the caller asked for', (done) => {
      const spy = answer([{ address: '93.184.216.34', family: 4 }]);
      guardedLookup('example.com', { family: 4 }, () => {
        expect(spy.mock.calls[0][1]).toEqual({ family: 4, all: true });
        done();
      });
    });

    it('refuses a name that resolves to nothing', (done) => {
      answer([]);
      guardedLookup('example.com', {}, (error) => {
        expect(error).toBeInstanceOf(UnsafeWebhookTargetError);
        done();
      });
    });

    it('passes a DNS failure through', (done) => {
      jest.spyOn(dnsModule, 'lookup').mockImplementation((...args: any[]) => {
        args[args.length - 1](new Error('ENOTFOUND'));
      });
      guardedLookup('nope.example.com', {}, (error) => {
        expect(error.message).toBe('ENOTFOUND');
        done();
      });
    });
  });
});
