import { describe, it, expect } from 'vitest'
import { buildZip, crc32 } from './zip'

const le32 = (buf: Uint8Array, off: number) =>
  new DataView(buf.buffer, buf.byteOffset).getUint32(off, true)
const le16 = (buf: Uint8Array, off: number) =>
  new DataView(buf.buffer, buf.byteOffset).getUint16(off, true)

describe('crc32', () => {
  it('matches the known CRC of "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('empty input → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('buildZip — 2-file archive structure', () => {
  const a = new TextEncoder().encode('hello zip')
  const b = new TextEncoder().encode('second file\ncontents')
  const zip = buildZip([
    { name: 'a.txt', data: a },
    { name: 'dir/b.txt', data: b },
  ])

  it('starts with the local file header magic', () => {
    expect(le32(zip, 0)).toBe(0x04034b50)
  })

  it('stores the first entry uncompressed with correct sizes and name', () => {
    expect(le16(zip, 8)).toBe(0) // method: store
    expect(le32(zip, 18)).toBe(a.length) // compressed size
    expect(le32(zip, 22)).toBe(a.length) // uncompressed size
    const nameLen = le16(zip, 26)
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe('a.txt')
    expect(zip.slice(30 + nameLen, 30 + nameLen + a.length)).toEqual(a)
  })

  it('ends with an EOCD record reporting 2 central directory entries', () => {
    const eocd = zip.length - 22
    expect(le32(zip, eocd)).toBe(0x06054b50)
    expect(le16(zip, eocd + 8)).toBe(2) // entries on disk
    expect(le16(zip, eocd + 10)).toBe(2) // total entries
  })

  it('central directory offset/size point at valid CD headers for both files', () => {
    const eocd = zip.length - 22
    const cdSize = le32(zip, eocd + 12)
    const cdStart = le32(zip, eocd + 16)
    expect(cdStart + cdSize).toBe(eocd)
    // walk both central directory records
    let off = cdStart
    const names: string[] = []
    for (let i = 0; i < 2; i++) {
      expect(le32(zip, off)).toBe(0x02014b50)
      const nameLen = le16(zip, off + 28)
      names.push(new TextDecoder().decode(zip.slice(off + 46, off + 46 + nameLen)))
      off += 46 + nameLen
    }
    expect(names).toEqual(['a.txt', 'dir/b.txt'])
  })

  it('local header offsets recorded in the CD point at local magics', () => {
    const eocd = zip.length - 22
    let off = le32(zip, eocd + 16)
    for (let i = 0; i < 2; i++) {
      const localOff = le32(zip, off + 42)
      expect(le32(zip, localOff)).toBe(0x04034b50)
      off += 46 + le16(zip, off + 28)
    }
  })

  it('CRCs in the central directory match the file contents', () => {
    const eocd = zip.length - 22
    let off = le32(zip, eocd + 16)
    const crcs: number[] = []
    for (let i = 0; i < 2; i++) {
      crcs.push(le32(zip, off + 16))
      off += 46 + le16(zip, off + 28)
    }
    expect(crcs).toEqual([crc32(a), crc32(b)])
  })
})
