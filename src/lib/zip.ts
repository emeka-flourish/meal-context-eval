// Minimal ZIP writer — store method (no compression; bundle contents are
// already-compressed JPEGs), no ZIP64. Readable by any unzip tool. Built for
// streaming: add() returns the chunks for one entry, finish() the central
// directory, so the export route can enqueue chunks as it goes without
// holding the whole archive in memory.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

type Entry = {
  nameBytes: Uint8Array
  crc: number
  size: number
  offset: number
  time: number
  date: number
}

const UTF8_FLAG = 0x0800

export class ZipWriter {
  private entries: Entry[] = []
  private offset = 0

  /** Local file header + data for one stored entry. Enqueue/collect the chunks in order. */
  add(name: string, data: Uint8Array, mtime = new Date()): Uint8Array[] {
    const nameBytes = new TextEncoder().encode(name)
    const { time, date } = dosDateTime(mtime)
    const crc = crc32(data)
    const header = new Uint8Array(30 + nameBytes.length)
    const v = new DataView(header.buffer)
    v.setUint32(0, 0x04034b50, true) // local file header signature
    v.setUint16(4, 20, true) // version needed
    v.setUint16(6, UTF8_FLAG, true)
    v.setUint16(8, 0, true) // method: store
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true) // compressed size (= uncompressed for store)
    v.setUint32(22, data.length, true)
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, 0, true) // extra field length
    header.set(nameBytes, 30)
    this.entries.push({ nameBytes, crc, size: data.length, offset: this.offset, time, date })
    this.offset += header.length + data.length
    return [header, data]
  }

  /** Central directory + end-of-central-directory record. Call once, last. */
  finish(): Uint8Array {
    const cdStart = this.offset
    const parts: Uint8Array[] = []
    let cdSize = 0
    for (const e of this.entries) {
      const rec = new Uint8Array(46 + e.nameBytes.length)
      const v = new DataView(rec.buffer)
      v.setUint32(0, 0x02014b50, true) // central directory header signature
      v.setUint16(4, 20, true) // version made by
      v.setUint16(6, 20, true) // version needed
      v.setUint16(8, UTF8_FLAG, true)
      v.setUint16(10, 0, true) // method: store
      v.setUint16(12, e.time, true)
      v.setUint16(14, e.date, true)
      v.setUint32(16, e.crc, true)
      v.setUint32(20, e.size, true)
      v.setUint32(24, e.size, true)
      v.setUint16(28, e.nameBytes.length, true)
      // extra/comment/disk/attrs all zero
      v.setUint32(42, e.offset, true)
      rec.set(e.nameBytes, 46)
      parts.push(rec)
      cdSize += rec.length
    }
    const eocd = new Uint8Array(22)
    const v = new DataView(eocd.buffer)
    v.setUint32(0, 0x06054b50, true) // end of central directory signature
    v.setUint16(8, this.entries.length, true) // entries on this disk
    v.setUint16(10, this.entries.length, true) // total entries
    v.setUint32(12, cdSize, true)
    v.setUint32(16, cdStart, true)
    parts.push(eocd)
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let pos = 0
    for (const p of parts) {
      out.set(p, pos)
      pos += p.length
    }
    return out
  }
}

/** One-shot helper (tests, small bundles): whole archive as a single buffer. */
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const w = new ZipWriter()
  const chunks: Uint8Array[] = []
  for (const f of files) chunks.push(...w.add(f.name, f.data))
  chunks.push(w.finish())
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
