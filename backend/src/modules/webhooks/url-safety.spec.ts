import {
  classifyBlockedAddress,
  privateTargetsAllowed,
  assertPublicWebhookTarget,
  UnsafeWebhookTargetError,
} from './url-safety';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { lookup } = require('node:dns/promises') as { lookup: jest.Mock };

describe('url-safety', () => {
  const env = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('classifyBlockedAddress', () => {
    it.each([
      ['169.254.169.254', 'link-local (cloud metadata)'],
      ['127.0.0.1', 'loopback'],
      ['10.1.2.3', 'private'],
      ['172.16.0.1', 'private'],
      ['172.31.255.254', 'private'],
      ['192.168.1.1', 'private'],
      ['100.64.0.1', 'carrier-grade NAT'],
      ['0.0.0.0', 'this network'],
      ['224.0.0.1', 'multicast'],
      ['255.255.255.255', 'reserved'],
    ])('blocks %s', (ip, reason) => {
      expect(classifyBlockedAddress(ip)).toBe(reason);
    });

    it.each([
      ['8.8.8.8'],
      ['1.1.1.1'],
      ['93.184.216.34'],
      ['172.15.0.1'], // just outside 172.16/12
      ['172.32.0.1'], // just outside 172.16/12
      ['11.0.0.1'],
    ])('allows the public address %s', (ip) => {
      expect(classifyBlockedAddress(ip)).toBeNull();
    });

    it.each([
      ['::1', 'loopback'],
      ['::', 'unspecified'],
      ['fc00::1', 'unique local'],
      ['fd12:3456::1', 'unique local'],
      ['fe80::1', 'link-local'],
      ['ff02::1', 'multicast'],
    ])('blocks the IPv6 address %s', (ip, reason) => {
      expect(classifyBlockedAddress(ip)).toBe(reason);
    });

    it('allows a public IPv6 address', () => {
      expect(classifyBlockedAddress('2606:4700:4700::1111')).toBeNull();
    });

    it('sees through an IPv4-mapped IPv6 address', () => {
      expect(classifyBlockedAddress('::ffff:127.0.0.1')).toBe('loopback');
      expect(classifyBlockedAddress('::ffff:169.254.169.254')).toBe(
        'link-local (cloud metadata)',
      );
    });

    // The URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1 before any
    // check sees it, so the hex form is the one that actually arrives.
    it.each([
      ['::ffff:7f00:1', 'loopback'],
      ['::ffff:a9fe:a9fe', 'link-local (cloud metadata)'],
      ['::ffff:a00:5', 'private'],
      ['0:0:0:0:0:ffff:7f00:1', 'loopback'],
      ['::FFFF:7F00:1', 'loopback'],
      ['64:ff9b::a9fe:a9fe', 'link-local (cloud metadata)'],
      ['2002:7f00:1::', 'loopback'],
      ['2002:a9fe:a9fe::1', 'link-local (cloud metadata)'],
      ['::7f00:1', 'IPv4-compatible (deprecated)'],
      ['0:0:0:0:0:0:0:1', 'loopback'],
      ['fec0::1', 'site-local (deprecated)'],
      ['2001:db8::1', 'documentation'],
    ])('blocks the hex or expanded form %s', (ip, reason) => {
      expect(classifyBlockedAddress(ip)).toBe(reason);
    });

    it('lets a mapped address through only when the IPv4 inside is public', () => {
      expect(classifyBlockedAddress('::ffff:808:808')).toBeNull(); // 8.8.8.8
    });

    it('sees through the NAT64 prefix', () => {
      expect(classifyBlockedAddress('64:ff9b::10.0.0.1')).toBe('private');
    });

    it('ignores an IPv6 zone index', () => {
      expect(classifyBlockedAddress('fe80::1%eth0')).toBe('link-local');
    });

    it('rejects something that is not an address at all', () => {
      expect(classifyBlockedAddress('not-an-ip')).toBe('malformed');
      expect(classifyBlockedAddress('10.0.0')).toBe('malformed');
    });
  });

  describe('assertPublicWebhookTarget', () => {
    it('rejects a literal private address without asking DNS', async () => {
      await expect(
        assertPublicWebhookTarget('http://169.254.169.254/latest/meta-data/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookTargetError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it.each([
      ['http://[::ffff:127.0.0.1]/'],
      ['http://[::ffff:169.254.169.254]/latest/meta-data/'],
      ['http://[::ffff:7f00:1]/'],
      ['http://[64:ff9b::a9fe:a9fe]/'],
      ['http://[2002:7f00:1::]/'],
    ])('rejects the IPv4-in-IPv6 target %s as it arrives through a real URL', async (url) => {
      await expect(assertPublicWebhookTarget(url)).rejects.toBeInstanceOf(
        UnsafeWebhookTargetError,
      );
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a bracketed IPv6 loopback', async () => {
      await expect(
        assertPublicWebhookTarget('http://[::1]:8080/hook'),
      ).rejects.toThrow(/loopback/);
    });

    it('allows a literal public address', async () => {
      await expect(
        assertPublicWebhookTarget('https://8.8.8.8/hook'),
      ).resolves.toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a hostname that resolves into the private range', async () => {
      lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      await expect(
        assertPublicWebhookTarget('https://rebind.example.com/hook'),
      ).rejects.toThrow(/resolves to 127\.0\.0\.1/);
    });

    it('rejects when only one of several addresses is private', async () => {
      lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]);
      await expect(
        assertPublicWebhookTarget('https://split.example.com/hook'),
      ).rejects.toThrow(/10\.0\.0\.5/);
    });

    it('allows a hostname that resolves publicly', async () => {
      lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      await expect(
        assertPublicWebhookTarget('https://example.com/hook'),
      ).resolves.toBeUndefined();
    });

    it('rejects a hostname that cannot be resolved', async () => {
      lookup.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(
        assertPublicWebhookTarget('https://nope.example.com/hook'),
      ).rejects.toThrow(/could not be resolved/);
    });

    it('rejects a hostname that resolves to nothing', async () => {
      lookup.mockResolvedValue([]);
      await expect(
        assertPublicWebhookTarget('https://empty.example.com/hook'),
      ).rejects.toThrow(/could not be resolved/);
    });

    it('rejects a malformed URL', async () => {
      await expect(assertPublicWebhookTarget('not a url')).rejects.toBeInstanceOf(
        UnsafeWebhookTargetError,
      );
    });
  });

  describe('privateTargetsAllowed', () => {
    it('is off by default', () => {
      expect(privateTargetsAllowed()).toBe(false);
    });

    it('can be opted into outside production', () => {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
      expect(privateTargetsAllowed()).toBe(true);
    });

    it('can never be opted into in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
      expect(privateTargetsAllowed()).toBe(false);
    });

    it('lets a developer reach their own machine when opted in', async () => {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
      await expect(
        assertPublicWebhookTarget('http://localhost:3000/hook'),
      ).resolves.toBeUndefined();
    });
  });
});
