// The pinning proxy, driven by a hand-written SOCKS5 client against local TCP servers. Nothing
// here leaves 127.0.0.1 and nothing is resolved.
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECT_TIMEOUT_CODE,
  canonicalHost,
  PinningProxy,
  type Ticket,
} from '../../src/transport/socks-proxy.ts';

/** A TCP server that echoes what it gets and counts its connections. */
async function echoServer() {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    socket.on('error', () => {});
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    connections: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Credentials {
  readonly user: string;
  readonly pass: string;
  readonly port: number;
}

function credentialsOf(ticket: Ticket): Credentials {
  const url = new URL(ticket.proxyUrl);
  return { user: url.username, pass: url.password, port: Number(url.port) };
}

/** A minimal SOCKS5 client that records every byte the proxy sends back. */
class Client {
  readonly socket: net.Socket;
  #buffer = Buffer.alloc(0);
  #wake: (() => void) | undefined;
  #closed = false;

  constructor(port: number) {
    this.socket = net.connect(port, '127.0.0.1');
    this.socket.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#wake?.();
    });
    this.socket.on('close', () => {
      this.#closed = true;
      this.#wake?.();
    });
    this.socket.on('error', () => {});
  }

  async connected(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.once('connect', () => resolve()));
  }

  send(bytes: number[] | Buffer): void {
    this.socket.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  }

  /** The next `n` bytes, or what arrived before the proxy closed. */
  async read(n: number): Promise<Buffer> {
    while (this.#buffer.length < n && !this.#closed) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    const out = this.#buffer.subarray(0, n);
    this.#buffer = this.#buffer.subarray(out.length);
    return out;
  }

  async closed(): Promise<boolean> {
    while (!this.#closed) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    return true;
  }

  /** Greeting and RFC 1929 authentication; the auth status byte. */
  async authenticate(user: string, pass: string): Promise<number | undefined> {
    this.send([5, 1, 2]);
    const method = await this.read(2);
    expect([...method]).toEqual([5, 2]);
    const u = Buffer.from(user, 'latin1');
    const p = Buffer.from(pass, 'latin1');
    this.send(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
    const status = await this.read(2);
    return status[1];
  }

  /** A CONNECT by name; the reply code. */
  async connectName(host: string, port: number, command = 1): Promise<number | undefined> {
    const name = Buffer.from(host, 'latin1');
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(port);
    this.send(Buffer.concat([Buffer.from([5, command, 0, 3, name.length]), name, portBytes]));
    const reply = await this.read(10);
    return reply[1];
  }

  /** A CONNECT by IPv4 address; the reply code. */
  async connectIpv4(address: string, port: number): Promise<number | undefined> {
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(port);
    const octets = address.split('.').map(Number);
    this.send(Buffer.concat([Buffer.from([5, 1, 0, 1, ...octets]), portBytes]));
    const reply = await this.read(10);
    return reply[1];
  }

  close(): void {
    this.socket.destroy();
  }
}

describe('the pinning proxy', () => {
  let proxy: PinningProxy;
  let echo: Awaited<ReturnType<typeof echoServer>>;
  const clients: Client[] = [];

  async function client(port: number): Promise<Client> {
    const c = new Client(port);
    clients.push(c);
    await c.connected();
    return c;
  }

  beforeEach(async () => {
    proxy = new PinningProxy();
    echo = await echoServer();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await proxy.close();
    await echo.close();
  });

  it('listens on the loopback address only', async () => {
    await proxy.listen();
    expect(proxy.address()?.address).toBe('127.0.0.1');
  });

  it('tunnels the one allowed CONNECT to the pinned address, never resolving the name', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    expect(ticket.proxyUrl.startsWith('socks5h://')).toBe(true);
    const c = await client(port);
    expect(await c.authenticate(user, pass)).toBe(0);
    // shop.test resolves nowhere: reaching the echo server proves the pinned address was used.
    expect(await c.connectName('shop.test', echo.port)).toBe(0);
    expect(ticket.state).toBe('connected');
    c.send(Buffer.from('ping'));
    expect((await c.read(4)).toString()).toBe('ping');
    expect(echo.connections()).toBe(1);
  });

  it('matches the host without regard to case or a trailing dot', async () => {
    const ticket = await proxy.allow({
      host: 'Shop.Test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectName('shop.test.', echo.port)).toBe(0);
  });

  it('refuses a CONNECT to another host, and dials nothing', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectName('tracker.test', echo.port)).toBe(2);
    expect(await c.closed()).toBe(true);
    expect(ticket.state).toBe('refused');
    expect(echo.connections()).toBe(0);
  });

  it('refuses a CONNECT to another port of the same host', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectName('shop.test', echo.port === 65_535 ? 1 : echo.port + 1)).toBe(2);
    expect(echo.connections()).toBe(0);
  });

  it('refuses a CONNECT by address when the ticket names a host', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectIpv4('127.0.0.1', echo.port)).toBe(2);
    expect(echo.connections()).toBe(0);
  });

  it('accepts a CONNECT by address for an IP-literal URL', async () => {
    const ticket = await proxy.allow({
      host: '127.0.0.1',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectIpv4('127.0.0.1', echo.port)).toBe(0);
  });

  it('allows one connection per ticket: a second CONNECT is refused', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const first = await client(port);
    await first.authenticate(user, pass);
    expect(await first.connectName('shop.test', echo.port)).toBe(0);
    const second = await client(port);
    expect(await second.authenticate(user, pass)).toBe(0);
    expect(await second.connectName('shop.test', echo.port)).toBe(2);
    expect(echo.connections()).toBe(1);
  });

  it('refuses a client without the per-process secret', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, port } = credentialsOf(ticket);
    const c = await client(port);
    expect(await c.authenticate(user, 'guess')).toBe(1);
    expect(await c.closed()).toBe(true);
    expect(ticket.state).toBe('unused');
  });

  it('refuses an unknown ticket even with the secret', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { pass, port } = credentialsOf(ticket);
    const c = await client(port);
    expect(await c.authenticate('0'.repeat(32), pass)).toBe(1);
  });

  it('refuses a client that offers no authentication', async () => {
    const port = await proxy.listen();
    const c = await client(port);
    c.send([5, 1, 0]);
    expect([...(await c.read(2))]).toEqual([5, 0xff]);
    expect(await c.closed()).toBe(true);
  });

  it('refuses BIND and UDP ASSOCIATE', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectName('shop.test', echo.port, 2)).toBe(7);
    expect(echo.connections()).toBe(0);
  });

  it('refuses a closed ticket', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    ticket.close();
    const c = await client(port);
    expect(await c.authenticate(user, pass)).toBe(1);
  });

  it('records a refused connection as a connect failure: nothing was sent', async () => {
    const dead = await closedPort();
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: dead,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectName('shop.test', dead)).toBe(5);
    expect(ticket.state).toBe('failed');
    expect(ticket.failure).toBe('ECONNREFUSED');
  });

  it('gives up a connection that takes longer than the connect timeout', async () => {
    const dialled: string[] = [];
    // A socket that never connects stands in for an address that never answers, so no packet
    // has to leave the machine.
    const slow = new PinningProxy({
      connectTimeoutMs: 200,
      dial: (address, port) => {
        dialled.push(`${address}:${port}`);
        return new net.Socket();
      },
    });
    try {
      const ticket = await slow.allow({
        host: 'shop.test',
        port: 443,
        address: '192.0.2.1',
        ttlMs: 5_000,
      });
      const { user, pass, port } = credentialsOf(ticket);
      const c = await client(port);
      await c.authenticate(user, pass);
      expect(await c.connectName('shop.test', 443)).toBe(4);
      expect(ticket.state).toBe('failed');
      expect(ticket.failure).toBe(CONNECT_TIMEOUT_CODE);
      expect(dialled).toEqual(['192.0.2.1:443']);
    } finally {
      await slow.close();
    }
  });

  it('closes the tunnel when the ticket is closed', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 5_000,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    await c.connectName('shop.test', echo.port);
    ticket.close();
    expect(await c.closed()).toBe(true);
  });

  it('closes the tunnel when the ticket expires', async () => {
    const ticket = await proxy.allow({
      host: 'shop.test',
      port: echo.port,
      address: '127.0.0.1',
      ttlMs: 150,
    });
    const { user, pass, port } = credentialsOf(ticket);
    const c = await client(port);
    await c.authenticate(user, pass);
    expect(await c.connectName('shop.test', echo.port)).toBe(0);
    expect(await c.closed()).toBe(true);
  });

  it('opens a ticket only for an IP literal', async () => {
    await expect(
      proxy.allow({ host: 'shop.test', port: 443, address: 'shop.test', ttlMs: 1_000 }),
    ).rejects.toThrow(TypeError);
  });
});

describe('canonicalHost', () => {
  it('compares IPv6 in its compressed form, without brackets', () => {
    expect(canonicalHost('[2001:DB8:0:0:0:0:0:1]')).toBe('2001:db8::1');
    expect(canonicalHost('2001:db8::1')).toBe('2001:db8::1');
  });

  it('lower-cases a name and drops a trailing dot', () => {
    expect(canonicalHost('WWW.Shop.Test.')).toBe('www.shop.test');
  });
});
