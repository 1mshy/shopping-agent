// The pinning proxy: how a connection is pinned to the address the guard vetted (S§5.1
// "connection pinned to the validated IP") although `impit` has no option to name the address it
// connects to. The HTTP client is pointed at this proxy, and the proxy, not the client, opens the
// TCP connection, to the one address the guard chose for the hop.
//
// It speaks SOCKS5 (RFC 1928) with username/password authentication (RFC 1929), used as
// `socks5h://`: the client hands over the host name unresolved, so it never looks the name up.
// TLS stays end to end between the client and the origin (the server name and the certificate
// check use the URL's host), and a plain-http request crosses byte for byte as the client wrote
// it, in origin form with no proxy header, exactly as on a direct connection.
//
// Each hop gets a ticket: one CONNECT, to the hop's own host and port, dialled at the vetted
// address, at most once, until the hop's deadline. Everything else is refused: a CONNECT to any
// other host or port (a page- or library-driven second connection cannot leave through it), a
// second CONNECT on the same ticket, a BIND or UDP request, a client without the per-process
// secret, and any connection not from loopback (the proxy listens on 127.0.0.1 only). The address
// is an IP literal and is dialled as one: the proxy never resolves a name either.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

/** What one hop may reach: `host`:`port` as the URL names them, dialled at `address`. */
export interface Pin {
  /** The URL's host name or IP literal (IPv6 without brackets). */
  readonly host: string;
  readonly port: number;
  /** The vetted IP address to connect to. */
  readonly address: string;
  /** How long the ticket lives; its connections are closed when it ends. */
  readonly ttlMs: number;
}

export type TicketState =
  /** No CONNECT has arrived yet. */
  | 'unused'
  | 'connecting'
  | 'connected'
  /** A CONNECT arrived that the ticket does not allow; nothing was dialled. */
  | 'refused'
  /** The connection to the address could not be made, so no byte reached it. */
  | 'failed';

export interface Ticket {
  /** The proxy URL the HTTP client must use for this hop, credentials included. */
  readonly proxyUrl: string;
  readonly state: TicketState;
  /** The connect failure's code when `state` is `failed`. */
  readonly failure: string | undefined;
  /** Closes the hop's connections and retires the ticket. Idempotent. */
  close(): void;
}

export interface PinningProxyOptions {
  /** How long a connection to the vetted address may take before the next one is tried. */
  readonly connectTimeoutMs?: number;
  /**
   * Opens the TCP connection to the pinned address (`dialAddress` by default). Only tests replace
   * it, to stand in for an address that never answers; it is always given the ticket's address.
   */
  readonly dial?: (address: string, port: number) => net.Socket;
}

/** Connects to an IP literal: no lookup is made, and the lookup hook makes sure of it. */
export function dialAddress(address: string, port: number): net.Socket {
  return net.connect({
    host: address,
    port,
    family: net.isIP(address),
    lookup: () => {
      throw new Error('the pinning proxy never resolves a name');
    },
  });
}

/**
 * The code of a connection that timed out before the request's deadline. It is undici's name for
 * the same event, and one of the guard's `CONNECT_FAILURE_CODES`: nothing was sent.
 */
export const CONNECT_TIMEOUT_CODE = 'UND_ERR_CONNECT_TIMEOUT';

/** A connect attempt longer than this gives up so the guard can try the next vetted address. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** A client that has not finished the SOCKS handshake by then is dropped. */
const HANDSHAKE_TIMEOUT_MS = 5_000;
/** The handshake is a few hundred bytes at most; more before it ends is not a client of ours. */
const HANDSHAKE_MAX_BYTES = 1_024;

const SOCKS_VERSION = 0x05;
const AUTH_VERSION = 0x01;
const METHOD_USERPASS = 0x02;
const NO_ACCEPTABLE_METHOD = 0xff;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_NAME = 0x03;
const ATYP_IPV6 = 0x04;

/** RFC 1928 §6 replies. */
const REPLY = {
  succeeded: 0x00,
  failure: 0x01,
  notAllowed: 0x02,
  networkUnreachable: 0x03,
  hostUnreachable: 0x04,
  refused: 0x05,
  commandNotSupported: 0x07,
  addressTypeNotSupported: 0x08,
} as const;

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

interface TicketRecord {
  readonly id: string;
  readonly pin: Pin;
  state: TicketState;
  failure: string | undefined;
  readonly sockets: Set<net.Socket>;
  timer: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
}

/** A canonical form of a host for comparison: lower case, no trailing dot, IPv6 compressed. */
export function canonicalHost(text: string): string {
  let host = text.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (net.isIPv6(host)) {
    try {
      return new URL(`http://[${host}]/`).hostname.slice(1, -1);
    } catch {
      return host;
    }
  }
  return host;
}

function ipv6FromBytes(bytes: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
  return canonicalHost(groups.join(':'));
}

function isLoopbackPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

function replyFor(code: string): number {
  switch (code) {
    case 'ECONNREFUSED':
      return REPLY.refused;
    case 'ENETUNREACH':
      return REPLY.networkUnreachable;
    case 'EHOSTUNREACH':
    case CONNECT_TIMEOUT_CODE:
      return REPLY.hostUnreachable;
    default:
      return REPLY.failure;
  }
}

/** Reads exact byte counts off a socket during the handshake. */
class HandshakeReader {
  #buffer = Buffer.alloc(0);
  #wake: (() => void) | undefined;
  #ended = false;
  readonly #socket: net.Socket;
  readonly #onData = (chunk: Buffer) => {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > HANDSHAKE_MAX_BYTES) this.#socket.destroy();
    this.#wake?.();
  };
  readonly #onEnd = () => {
    this.#ended = true;
    this.#wake?.();
  };

  constructor(socket: net.Socket) {
    this.#socket = socket;
    socket.on('data', this.#onData);
    socket.on('end', this.#onEnd);
    socket.on('close', this.#onEnd);
  }

  async read(n: number): Promise<Buffer> {
    while (this.#buffer.length < n) {
      if (this.#ended) throw new Error('the client closed during the handshake');
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
      this.#wake = undefined;
    }
    const out = this.#buffer.subarray(0, n);
    this.#buffer = this.#buffer.subarray(n);
    return out;
  }

  /** Stops reading and returns what arrived after the handshake. The socket is left paused. */
  detach(): Buffer {
    this.#socket.pause();
    this.#socket.off('data', this.#onData);
    this.#socket.off('end', this.#onEnd);
    this.#socket.off('close', this.#onEnd);
    return this.#buffer;
  }
}

/**
 * The in-process SOCKS5 pinning proxy. One per process is enough (`sharedPinningProxy`); tests
 * make their own. It starts listening on the first ticket and does not keep the process alive.
 */
export class PinningProxy {
  readonly #secret = randomBytes(32).toString('hex');
  readonly #tickets = new Map<string, TicketRecord>();
  readonly #connectTimeoutMs: number;
  readonly #connect: (address: string, port: number) => net.Socket;
  #server: net.Server | undefined;
  #port: Promise<number> | undefined;

  constructor(options: PinningProxyOptions = {}) {
    const timeout = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError(`connectTimeoutMs must be a positive number, got ${timeout}`);
    }
    this.#connectTimeoutMs = timeout;
    this.#connect = options.dial ?? dialAddress;
  }

  /** The port it listens on, starting it if needed. */
  listen(): Promise<number> {
    if (this.#port === undefined) {
      const server = net.createServer((socket) => {
        this.#accept(socket);
      });
      this.#server = server;
      this.#port = new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
          server.off('error', reject);
          server.unref();
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('the pinning proxy has no TCP address'));
            return;
          }
          resolve(address.port);
        });
      });
    }
    return this.#port;
  }

  /** Where it listens, once started: always the loopback address. */
  address(): net.AddressInfo | undefined {
    const address = this.#server?.address();
    return address && typeof address !== 'string' ? address : undefined;
  }

  /** Opens a ticket for one hop: one connection to `pin.host`:`pin.port` at `pin.address`. */
  async allow(pin: Pin): Promise<Ticket> {
    if (net.isIP(pin.address) === 0) {
      throw new TypeError(`the pinned address must be an IP literal, got ${pin.address}`);
    }
    if (!Number.isInteger(pin.port) || pin.port < 1 || pin.port > 65_535) {
      throw new RangeError(`port must be 1-65535, got ${pin.port}`);
    }
    const port = await this.listen();
    const record: TicketRecord = {
      id: randomBytes(16).toString('hex'),
      pin: { ...pin, host: canonicalHost(pin.host) },
      state: 'unused',
      failure: undefined,
      sockets: new Set(),
      timer: undefined,
      closed: false,
    };
    this.#tickets.set(record.id, record);
    const close = () => {
      if (record.closed) return;
      record.closed = true;
      clearTimeout(record.timer);
      this.#tickets.delete(record.id);
      for (const socket of record.sockets) socket.destroy();
      record.sockets.clear();
    };
    record.timer = setTimeout(close, Math.max(0, pin.ttlMs));
    record.timer.unref();
    return {
      proxyUrl: `socks5h://${record.id}:${this.#secret}@127.0.0.1:${port}`,
      get state() {
        return record.state;
      },
      get failure() {
        return record.failure;
      },
      close,
    };
  }

  /** Stops listening and closes every open ticket. */
  async close(): Promise<void> {
    for (const record of [...this.#tickets.values()]) {
      for (const socket of record.sockets) socket.destroy();
      clearTimeout(record.timer);
      record.closed = true;
    }
    this.#tickets.clear();
    const server = this.#server;
    this.#server = undefined;
    this.#port = undefined;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  #accept(socket: net.Socket): void {
    socket.on('error', () => {
      // A client that goes away mid-handshake or mid-tunnel is not an error of ours.
    });
    if (!isLoopbackPeer(socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
    timer.unref();
    this.#handshake(socket).then(
      () => clearTimeout(timer),
      () => {
        clearTimeout(timer);
        socket.destroy();
      },
    );
  }

  #checkCredentials(username: Buffer, password: Buffer): TicketRecord | undefined {
    const secret = Buffer.from(this.#secret);
    const secretOk = password.length === secret.length && timingSafeEqual(password, secret);
    const record = this.#tickets.get(username.toString('latin1'));
    return secretOk && record !== undefined && !record.closed ? record : undefined;
  }

  async #handshake(socket: net.Socket): Promise<void> {
    const reader = new HandshakeReader(socket);
    const end = (bytes: number[]) => {
      reader.detach();
      socket.end(Buffer.from(bytes));
    };

    // Greeting: only username/password is offered back.
    const [version, methodCount] = await reader.read(2);
    if (version !== SOCKS_VERSION || methodCount === undefined) throw new Error('not SOCKS5');
    const methods = await reader.read(methodCount);
    if (!methods.includes(METHOD_USERPASS)) {
      end([SOCKS_VERSION, NO_ACCEPTABLE_METHOD]);
      return;
    }
    socket.write(Buffer.from([SOCKS_VERSION, METHOD_USERPASS]));

    // RFC 1929: the ticket id and the per-process secret.
    const [authVersion, userLength] = await reader.read(2);
    if (authVersion !== AUTH_VERSION || userLength === undefined) throw new Error('bad auth');
    const username = await reader.read(userLength);
    const [passLength] = await reader.read(1);
    const password = await reader.read(passLength ?? 0);
    const record = this.#checkCredentials(username, password);
    if (record === undefined) {
      end([AUTH_VERSION, 0x01]);
      return;
    }
    socket.write(Buffer.from([AUTH_VERSION, 0x00]));

    // The request.
    const [requestVersion, command, , addressType] = await reader.read(4);
    if (requestVersion !== SOCKS_VERSION) throw new Error('bad request');
    let host: string;
    if (addressType === ATYP_IPV4) {
      host = [...(await reader.read(4))].join('.');
    } else if (addressType === ATYP_NAME) {
      const [length] = await reader.read(1);
      host = (await reader.read(length ?? 0)).toString('latin1');
    } else if (addressType === ATYP_IPV6) {
      host = ipv6FromBytes(await reader.read(16));
    } else {
      end(reply(REPLY.addressTypeNotSupported));
      return;
    }
    const port = (await reader.read(2)).readUInt16BE(0);

    if (command !== CMD_CONNECT) {
      end(reply(REPLY.commandNotSupported));
      return;
    }
    // One CONNECT per ticket, and only to the hop's own host and port.
    if (
      record.closed ||
      record.state !== 'unused' ||
      canonicalHost(host) !== record.pin.host ||
      port !== record.pin.port
    ) {
      if (record.state === 'unused') record.state = 'refused';
      end(reply(REPLY.notAllowed));
      return;
    }
    record.state = 'connecting';
    record.sockets.add(socket);
    this.#dial(record, socket, reader);
  }

  #dial(record: TicketRecord, client: net.Socket, reader: HandshakeReader): void {
    const { address, port } = record.pin;
    const upstream = this.#connect(address, port);
    record.sockets.add(upstream);
    upstream.setNoDelay(true);
    const fail = (code: string) => {
      if (record.state !== 'connecting') return;
      record.state = 'failed';
      record.failure = CODE.test(code) ? code : 'ERR_CONNECT';
      upstream.destroy();
      reader.detach();
      client.end(Buffer.from(reply(replyFor(record.failure))));
    };
    const timer = setTimeout(() => fail(CONNECT_TIMEOUT_CODE), this.#connectTimeoutMs);
    timer.unref();
    upstream.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (record.state === 'connecting') fail(error.code ?? 'ERR_CONNECT');
      else client.destroy();
    });
    upstream.once('connect', () => {
      clearTimeout(timer);
      if (record.closed || record.state !== 'connecting') {
        upstream.destroy();
        return;
      }
      record.state = 'connected';
      upstream.on('error', () => client.destroy());
      client.write(Buffer.from(reply(REPLY.succeeded)));
      const early = reader.detach();
      if (early.length > 0) upstream.write(early);
      client.pipe(upstream);
      upstream.pipe(client);
      client.once('close', () => upstream.destroy());
      upstream.once('close', () => client.destroy());
    });
  }
}

/** A SOCKS5 reply; the bound address is not used by clients, so it is reported as 0.0.0.0:0. */
function reply(code: number): number[] {
  return [SOCKS_VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0];
}

let shared: PinningProxy | undefined;

/** The process's pinning proxy, made on first use. */
export function sharedPinningProxy(): PinningProxy {
  shared ??= new PinningProxy();
  return shared;
}
