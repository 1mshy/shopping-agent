// TLS ClientHello parsing and the JA4 / JA3 fingerprints computed from it.
// JA4 (FoxIO, JA4 technical details): a_b_c with
//   a = protocol (t) + TLS version (highest in supported_versions, else the legacy version)
//       + d|i (SNI present or not) + cipher count + extension count (2 digits, GREASE excluded,
//       SNI and ALPN included) + first and last character of the first ALPN value (00 if none);
//   b = first 12 hex of SHA-256 of the sorted cipher list (4-hex, comma separated);
//   c = first 12 hex of SHA-256 of the sorted extension list without SNI (0000) and ALPN (0010),
//       then "_" and the signature algorithms in their original order (omitted with no sig algs).
// JA3 = md5 of "version,ciphers,extensions,groups,point formats" in decimal, GREASE removed;
// JA3N sorts the extensions (Chrome permutes them per connection, so raw JA3 is not stable).
import { createHash } from 'node:crypto';

export interface ClientHello {
  legacyVersion: number;
  ciphers: number[];
  extensions: Array<{ type: number; data: Uint8Array }>;
  sni?: string;
  alpn: string[];
  supportedVersions: number[];
  groups: number[];
  pointFormats: number[];
  sigAlgs: number[];
}

export const isGrease = (v: number) => (v & 0x0f0f) === 0x0a0a && v >> 8 === (v & 0xff);
const hex4 = (v: number) => v.toString(16).padStart(4, '0');
const sha12 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

class Reader {
  #b: Uint8Array;
  at = 0;
  constructor(b: Uint8Array) {
    this.#b = b;
  }
  get left() {
    return this.#b.length - this.at;
  }
  u8() {
    if (this.left < 1) throw new Error('short');
    return this.#b[this.at++] as number;
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u24() {
    return (this.u8() << 16) | this.u16();
  }
  bytes(n: number) {
    if (this.left < n) throw new Error('short');
    const out = this.#b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
}

/**
 * The handshake message from the first TLS records of a connection, or undefined until enough
 * bytes have arrived. Throws if the bytes are not a TLS handshake.
 */
export function handshakeFromRecords(buf: Uint8Array): Uint8Array | undefined {
  const parts: Uint8Array[] = [];
  let at = 0;
  let have = 0;
  let need = -1;
  while (at + 5 <= buf.length) {
    if (buf[at] !== 0x16) throw new Error('not a TLS handshake record');
    const len = ((buf[at + 3] as number) << 8) | (buf[at + 4] as number);
    if (at + 5 + len > buf.length) return undefined;
    const frag = buf.subarray(at + 5, at + 5 + len);
    parts.push(frag);
    have += frag.length;
    at += 5 + len;
    if (need < 0 && have >= 4) {
      const first = Buffer.concat(parts);
      need =
        4 + (((first[1] as number) << 16) | ((first[2] as number) << 8) | (first[3] as number));
    }
    if (need >= 0 && have >= need) return Buffer.concat(parts).subarray(0, need);
  }
  return undefined;
}

export function parseClientHello(handshake: Uint8Array): ClientHello {
  const r = new Reader(handshake);
  if (r.u8() !== 1) throw new Error('not a ClientHello');
  r.u24();
  const legacyVersion = r.u16();
  r.bytes(32);
  r.bytes(r.u8());
  const cs = new Reader(r.bytes(r.u16()));
  const ciphers: number[] = [];
  while (cs.left >= 2) ciphers.push(cs.u16());
  r.bytes(r.u8());
  const hello: ClientHello = {
    legacyVersion,
    ciphers,
    extensions: [],
    alpn: [],
    supportedVersions: [],
    groups: [],
    pointFormats: [],
    sigAlgs: [],
  };
  if (r.left < 2) return hello;
  const ext = new Reader(r.bytes(r.u16()));
  while (ext.left >= 4) {
    const type = ext.u16();
    const data = ext.bytes(ext.u16());
    hello.extensions.push({ type, data });
    const d = new Reader(data);
    if (type === 0x0000 && data.length > 5) {
      d.u16();
      d.u8();
      hello.sni = Buffer.from(d.bytes(d.u16())).toString('latin1');
    } else if (type === 0x0010) {
      const list = new Reader(d.bytes(d.u16()));
      while (list.left > 0) hello.alpn.push(Buffer.from(list.bytes(list.u8())).toString('latin1'));
    } else if (type === 0x002b) {
      const list = new Reader(d.bytes(d.u8()));
      while (list.left >= 2) hello.supportedVersions.push(list.u16());
    } else if (type === 0x000a) {
      const list = new Reader(d.bytes(d.u16()));
      while (list.left >= 2) hello.groups.push(list.u16());
    } else if (type === 0x000b) {
      const list = d.bytes(d.u8());
      hello.pointFormats.push(...list);
    } else if (type === 0x000d) {
      const list = new Reader(d.bytes(d.u16()));
      while (list.left >= 2) hello.sigAlgs.push(list.u16());
    }
  }
  return hello;
}

const VERSION: Record<number, string> = {
  772: '13',
  771: '12',
  770: '11',
  769: '10',
  768: 's3',
  2: 's2',
};

function alpnChars(alpn: string[]): string {
  const first = alpn[0];
  if (!first) return '00';
  const a = first[0] as string;
  const z = first[first.length - 1] as string;
  if (/[a-z0-9]/i.test(a) && /[a-z0-9]/i.test(z)) return `${a}${z}`;
  const h = Buffer.from(first, 'latin1').toString('hex');
  return `${h[0]}${h[h.length - 1]}`;
}

export interface Ja4 {
  ja4: string;
  /** The raw (unhashed) form: a_ciphers_extensions_sigalgs. */
  ja4r: string;
}

export function ja4(h: ClientHello, protocol: 't' | 'q' = 't'): Ja4 {
  const versions = h.supportedVersions.filter((v) => !isGrease(v));
  const version = VERSION[versions.length ? Math.max(...versions) : h.legacyVersion] ?? '00';
  const ciphers = h.ciphers.filter((c) => !isGrease(c));
  const exts = h.extensions.map((e) => e.type).filter((t) => !isGrease(t));
  const sni = exts.includes(0x0000) ? 'd' : 'i';
  const two = (n: number) => String(Math.min(n, 99)).padStart(2, '0');
  const a = `${protocol}${version}${sni}${two(ciphers.length)}${two(exts.length)}${alpnChars(h.alpn)}`;
  const cipherList = ciphers.map(hex4).sort().join(',');
  const extList = exts
    .filter((t) => t !== 0x0000 && t !== 0x0010)
    .map(hex4)
    .sort()
    .join(',');
  const sigs = h.sigAlgs
    .filter((s) => !isGrease(s))
    .map(hex4)
    .join(',');
  const cInput = sigs ? `${extList}_${sigs}` : extList;
  const b = ciphers.length ? sha12(cipherList) : '000000000000';
  return { ja4: `${a}_${b}_${sha12(cInput)}`, ja4r: `${a}_${cipherList}_${cInput}` };
}

export interface Ja3 {
  ja3: string;
  ja3Hash: string;
  ja3n: string;
  ja3nHash: string;
}

export function ja3(h: ClientHello): Ja3 {
  const dec = (xs: number[]) =>
    xs
      .filter((x) => !isGrease(x))
      .map(String)
      .join('-');
  const exts = h.extensions.map((e) => e.type);
  const tail = `${dec(h.groups)},${h.pointFormats.join('-')}`;
  const s = `${h.legacyVersion},${dec(h.ciphers)},${dec(exts)},${tail}`;
  const sorted = exts.filter((x) => !isGrease(x)).sort((x, y) => x - y);
  const n = `${h.legacyVersion},${dec(h.ciphers)},${sorted.join('-')},${tail}`;
  const md5 = (x: string) => createHash('md5').update(x).digest('hex');
  return { ja3: s, ja3Hash: md5(s), ja3n: n, ja3nHash: md5(n) };
}
