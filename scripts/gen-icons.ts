/* Generate the PWA icons (public/icons/icon-{192,512}.png): solid dark
   square with blocky "CG" glyphs, rendered from a 16×16 pixel grid and
   encoded as PNG with node's zlib — no image deps. Run: pnpm tsx scripts/gen-icons.ts */
import { deflateSync } from 'zlib'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { crc32 } from '../src/lib/zip'

// 5×7 glyphs on a 16×16 logical grid ("C" at x=2, "G" at x=9, y=4)
const C = ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.']
const G = ['.###.', '#...#', '#....', '#..##', '#...#', '#...#', '.####']

const GRID = 16
const BG = [10, 10, 10] // #0a0a0a — matches manifest theme/background
const FG = [229, 229, 229] // neutral-200

function gridPixel(gx: number, gy: number): boolean {
  const row = gy - 4
  if (row < 0 || row >= 7) return false
  if (gx >= 2 && gx < 7) return C[row][gx - 2] === '#'
  if (gx >= 9 && gx < 14) return G[row][gx - 9] === '#'
  return false
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(new Uint8Array(body)))
  return Buffer.concat([len, body, crc])
}

function makePng(size: number): Buffer {
  const scale = size / GRID
  // Raw image data: one filter byte (0) per scanline, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    const line = y * (1 + size * 3)
    raw[line] = 0
    for (let x = 0; x < size; x++) {
      const on = gridPixel(Math.floor(x / scale), Math.floor(y / scale))
      const [r, g, b] = on ? FG : BG
      const p = line + 1 + x * 3
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const dir = join(process.cwd(), 'public', 'icons')
mkdirSync(dir, { recursive: true })
for (const size of [192, 512]) {
  const file = join(dir, `icon-${size}.png`)
  writeFileSync(file, makePng(size))
  console.log(`wrote ${file}`)
}
