import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../src/modules/skills/import/crc32.js';

/** One entry of a hand-built test archive; the optional fields forge headers. */
export interface TestZipEntry {
  name: string;
  data?: string | Uint8Array;
  /** 0 = stored, 8 = deflate (default), anything else is written as-is. */
  method?: number;
  flags?: number;
  /** Unix mode written into the external attributes (host = unix). */
  unixMode?: number;
  /** Lie about the uncompressed size / CRC in both headers. */
  declaredSize?: number;
  declaredCrc?: number;
  /** A different name in the local header than in the central directory. */
  localName?: string;
}

/**
 * Minimal ZIP writer for tests (APPNOTE 4.3): local headers, central directory,
 * end record. Lets tests build archives real tools would refuse to produce
 * (traversal names, symlinks, lying sizes, encryption flags, …).
 */
export function buildZip(entries: TestZipEntry[], opts: { comment?: string; trailing?: Uint8Array } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data ?? new Uint8Array());
    const method = e.method ?? (e.name.endsWith('/') ? 0 : 8);
    const payload = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const localName = Buffer.from(e.localName ?? e.name, 'utf8');
    const crc = e.declaredCrc ?? crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const flags = (e.flags ?? 0) | 0x800;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(size >>> 0, 22);
    lh.writeUInt16LE(localName.length, 26);
    locals.push(lh, localName, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(e.unixMode !== undefined ? (3 << 8) | 20 : 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(size >>> 0, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(e.unixMode !== undefined ? (e.unixMode << 16) >>> 0 : 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + localName.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const comment = Buffer.from(opts.comment ?? '', 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return new Uint8Array(Buffer.concat([...locals, cd, end, comment, Buffer.from(opts.trailing ?? new Uint8Array())]));
}

export const toBase64 = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).toString('base64');
