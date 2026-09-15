import { joined, utf8 } from "./sha1.ts";

/**
 * The container a `.streamDeckProfile` is: a stored-only zip, written here
 * rather than pulled in.
 *
 * Nothing else in the repository zips anything, and the alternative is a
 * dependency for two hundred lines of header. Stored rather than deflated
 * because a profile is a few kilobytes of JSON and the app reads either;
 * every timestamp is the same fixed one, so running this twice produces the
 * same bytes twice and the committed files only move when a layout does.
 *
 * Bytes rather than Buffers, so the same writer runs in a browser.
 */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/** One thing in the archive. A folder is a name ending in `/` and no body. */
export interface ZipEntry {
  name: string;
  data?: Uint8Array;
}

export function zip(entries: ZipEntry[]): Uint8Array {
  const DOS_DATE = 33; // 1980-01-01, the earliest a zip can say.
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const label = utf8(name);
    const body = data ?? new Uint8Array(0);
    const sum = crc32(body);

    const head = new Uint8Array(30);
    const headAt = new DataView(head.buffer);
    headAt.setUint32(0, 0x04034b50, true);
    headAt.setUint16(4, 20, true);
    headAt.setUint16(12, DOS_DATE, true);
    headAt.setUint32(14, sum, true);
    headAt.setUint32(18, body.length, true);
    headAt.setUint32(22, body.length, true);
    headAt.setUint16(26, label.length, true);
    parts.push(head, label, body);

    const listed = new Uint8Array(46);
    const listedAt = new DataView(listed.buffer);
    listedAt.setUint32(0, 0x02014b50, true);
    listedAt.setUint16(4, 20, true);
    listedAt.setUint16(6, 20, true);
    listedAt.setUint16(14, DOS_DATE, true);
    listedAt.setUint32(16, sum, true);
    listedAt.setUint32(20, body.length, true);
    listedAt.setUint32(24, body.length, true);
    listedAt.setUint16(28, label.length, true);
    // The directory bit, so an unpacker makes the folder rather than a file.
    listedAt.setUint32(38, name.endsWith("/") ? 0x10 : 0, true);
    listedAt.setUint32(42, offset, true);
    central.push(listed, label);

    offset += head.length + label.length + body.length;
  }

  const directory = joined(...central);
  const end = new Uint8Array(22);
  const endAt = new DataView(end.buffer);
  endAt.setUint32(0, 0x06054b50, true);
  endAt.setUint16(8, entries.length, true);
  endAt.setUint16(10, entries.length, true);
  endAt.setUint32(12, directory.length, true);
  endAt.setUint32(16, offset, true);
  return joined(...parts, directory, end);
}
