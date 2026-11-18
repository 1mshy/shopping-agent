// HTTP/2 client fingerprint from the first frames of a connection (after TLS), in the Akamai
// format: SETTINGS (id:value;…) | connection WINDOW_UPDATE increment (00 if none) | PRIORITY
// frames (stream:exclusive:dependency:weight,… or 0) | pseudo-header order of the first HEADERS
// (m,a,s,p). Only what the fingerprint needs is decoded: pseudo-header names come from the HPACK
// static table, which clients use for them; other header names are not decoded.

export const PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';

export interface Frame {
  type: number;
  flags: number;
  stream: number;
  payload: Uint8Array;
}

/** Frames in `buf` after the client preface; `rest` is an incomplete trailing frame. */
export function parseFrames(buf: Uint8Array): { frames: Frame[]; rest: number; preface: boolean } {
  const preface = Buffer.from(buf.subarray(0, PREFACE.length)).toString('latin1') === PREFACE;
  let at = preface ? PREFACE.length : 0;
  const frames: Frame[] = [];
  while (at + 9 <= buf.length) {
    const len =
      ((buf[at] as number) << 16) | ((buf[at + 1] as number) << 8) | (buf[at + 2] as number);
    if (at + 9 + len > buf.length) break;
    frames.push({
      type: buf[at + 3] as number,
      flags: buf[at + 4] as number,
      stream:
        (((buf[at + 5] as number) & 0x7f) << 24) |
        ((buf[at + 6] as number) << 16) |
        ((buf[at + 7] as number) << 8) |
        (buf[at + 8] as number),
      payload: buf.subarray(at + 9, at + 9 + len),
    });
    at += 9 + len;
  }
  return { frames, rest: buf.length - at, preface };
}

const STATIC_NAMES = [
  '',
  ':authority',
  ':method',
  ':method',
  ':path',
  ':path',
  ':scheme',
  ':scheme',
  ':status',
  ':status',
  ':status',
  ':status',
  ':status',
  ':status',
  ':status',
  // RFC 7541 Appendix A, entries 15-61.
  ...[
    'accept-charset accept-encoding accept-language accept-ranges accept',
    'access-control-allow-origin age allow authorization cache-control content-disposition',
    'content-encoding content-language content-length content-location content-range',
    'content-type cookie date etag expect expires from host if-match if-modified-since',
    'if-none-match if-range if-unmodified-since last-modified link location max-forwards',
    'proxy-authenticate proxy-authorization range referer refresh retry-after server',
    'set-cookie strict-transport-security transfer-encoding user-agent vary via www-authenticate',
  ]
    .join(' ')
    .split(' '),
];

function prefixInt(b: Uint8Array, at: number, bits: number): [number, number] {
  const max = (1 << bits) - 1;
  let v = (b[at] as number) & max;
  let i = at + 1;
  if (v < max) return [v, i];
  let m = 0;
  for (;;) {
    const x = b[i++] as number;
    v += (x & 0x7f) << m;
    m += 7;
    if ((x & 0x80) === 0) break;
  }
  return [v, i];
}

/** Header names of an HPACK block, in order: static-table names, else `?` (not decoded). */
export function headerNames(block: Uint8Array): string[] {
  const names: string[] = [];
  const dynamic: string[] = [];
  const nameOf = (i: number) =>
    i <= 0 ? '?' : i <= 61 ? (STATIC_NAMES[i] ?? '?') : (dynamic[i - 62] ?? '?');
  const literal = (at: number): [string, number] => {
    const huffman = ((block[at] as number) & 0x80) !== 0;
    const [len, i] = prefixInt(block, at, 7);
    const raw = Buffer.from(block.subarray(i, i + len)).toString('latin1');
    return [huffman ? '?' : raw, i + len];
  };
  let at = 0;
  while (at < block.length) {
    const b = block[at] as number;
    if (b & 0x80) {
      const [idx, i] = prefixInt(block, at, 7);
      names.push(nameOf(idx));
      at = i;
    } else if ((b & 0xe0) === 0x20) {
      at = prefixInt(block, at, 5)[1];
    } else {
      const indexing = (b & 0xc0) === 0x40;
      const [idx, i] = prefixInt(block, at, indexing ? 6 : 4);
      let name: string;
      let next = i;
      if (idx === 0) [name, next] = literal(i);
      else name = nameOf(idx);
      next = literal(next)[1];
      names.push(name);
      if (indexing) dynamic.unshift(name);
      at = next;
    }
  }
  return names;
}

export interface H2Fingerprint {
  settings: Array<[number, number]>;
  windowUpdate: number | null;
  priorities: string[];
  pseudoOrder: string[];
  akamai: string;
  /** Frame types in arrival order (SETTINGS=4, WINDOW_UPDATE=8, HEADERS=1, PRIORITY=2, …). */
  frameTypes: number[];
}

/** The fingerprint from the client's frames up to and including its first complete HEADERS. */
export function h2Fingerprint(frames: Frame[]): H2Fingerprint {
  const settings: Array<[number, number]> = [];
  let windowUpdate: number | null = null;
  const priorities: string[] = [];
  let pseudoOrder: string[] = [];
  const frameTypes: number[] = [];
  let block: Uint8Array[] = [];
  for (const f of frames) {
    frameTypes.push(f.type);
    const p = f.payload;
    if (f.type === 4 && (f.flags & 1) === 0) {
      for (let i = 0; i + 6 <= p.length; i += 6) {
        settings.push([
          ((p[i] as number) << 8) | (p[i + 1] as number),
          (((p[i + 2] as number) << 24) >>> 0) +
            (((p[i + 3] as number) << 16) | ((p[i + 4] as number) << 8) | (p[i + 5] as number)),
        ]);
      }
    } else if (f.type === 8 && f.stream === 0 && windowUpdate === null) {
      windowUpdate =
        ((((p[0] as number) & 0x7f) << 24) >>> 0) +
        (((p[1] as number) << 16) | ((p[2] as number) << 8) | (p[3] as number));
    } else if (f.type === 2) {
      const dep =
        ((((p[0] as number) & 0x7f) << 24) >>> 0) +
        (((p[1] as number) << 16) | ((p[2] as number) << 8) | (p[3] as number));
      const excl = ((p[0] as number) & 0x80) !== 0 ? 1 : 0;
      priorities.push(`${f.stream}:${excl}:${dep}:${(p[4] as number) + 1}`);
    } else if (f.type === 1 || f.type === 9) {
      let payload = p;
      if (f.type === 1) {
        let start = 0;
        let end = p.length;
        if (f.flags & 0x08) {
          end -= p[0] as number;
          start = 1;
        }
        if (f.flags & 0x20) start += 5;
        payload = p.subarray(start, end);
      }
      block.push(payload);
      if (f.flags & 0x04) {
        pseudoOrder = headerNames(Buffer.concat(block))
          .filter((n) => n.startsWith(':'))
          .map((n) => n.slice(1, 2));
        block = [];
        break;
      }
    }
  }
  const s = settings.map(([k, v]) => `${k}:${v}`).join(';');
  return {
    settings,
    windowUpdate,
    priorities,
    pseudoOrder,
    akamai: `${s}|${windowUpdate ?? '00'}|${priorities.length ? priorities.join(',') : '0'}|${pseudoOrder.join(',')}`,
    frameTypes,
  };
}

const frame = (type: number, flags: number, stream: number, payload: Uint8Array) => {
  const h = Buffer.alloc(9);
  h.writeUIntBE(payload.length, 0, 3);
  h[3] = type;
  h[4] = flags;
  h.writeUInt32BE(stream & 0x7fffffff, 5);
  return Buffer.concat([h, payload]);
};

/** Server side of the capture: empty SETTINGS, ACK, a bodiless 200 and GOAWAY. */
export const serverFrames = {
  settings: () => frame(4, 0, 0, new Uint8Array()),
  ack: () => frame(4, 1, 0, new Uint8Array()),
  ok: (stream: number) => frame(1, 0x05, stream, Uint8Array.of(0x88)),
  goaway: (last: number) => {
    const p = Buffer.alloc(8);
    p.writeUInt32BE(last & 0x7fffffff, 0);
    return frame(7, 0, 0, p);
  },
  frame,
};
