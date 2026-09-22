import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BLOCK_KEYS, buildInterpretPrompt, combinedPromptHash, parsePromptBlocks, sha256 } from './prompt-blocks'

const md = readFileSync(join(process.cwd(), 'prompts', 'interpret.v4.md'), 'utf-8')
const blocks = parsePromptBlocks(md)
const situation = { weekday: 'Friday', localTime: '13:05', homeOrAway: 'home' as const }

describe('parsePromptBlocks — interpret.v4.md', () => {
  it('finds all six blocks and the user template', () => {
    for (const k of BLOCK_KEYS) expect(blocks.blocks[k].length).toBeGreaterThan(50)
    expect(blocks.blocks.block1).toMatch(/^You are a meal-decomposition analyst/)
    expect(blocks.blocks.block2).toMatch(/"plates"/)
    expect(blocks.blocks.block3).toMatch(/^1\. Decompose, don't judge/)
    expect(blocks.blocks.block6).toMatch(/^1\. Decide match vs novel/)
    expect(blocks.userTemplate).toMatch(/<capture_context>/)
    expect(blocks.userTemplate).toMatch(/\{\{BLOCK_5\}\}/)
  })
  it('hashes each source block with sha256', () => {
    for (const k of BLOCK_KEYS) expect(blocks.sourceHashes[k]).toBe(sha256(blocks.blocks[k]))
    expect(new Set(Object.values(blocks.sourceHashes)).size).toBe(6)
  })
  it('extracts one capture-context line per vantage incl. none', () => {
    expect(Object.keys(blocks.vantageLines).sort()).toEqual(['glasses', 'none', 'phone', 'tripod'])
    expect(blocks.vantageLines.glasses).toMatch(/camera glasses/)
    expect(blocks.vantageLines.none).toMatch(/^No photo/)
  })
  it('throws on a file missing a block', () => {
    expect(() => parsePromptBlocks(md.replace('## Block 6', '## Block 9'))).toThrow(/block6/)
  })
})

describe('buildInterpretPrompt — conditions', () => {
  const io = buildInterpretPrompt({ blocks, condition: 'image_only', vantage: 'glasses', situation })
  const ic = buildInterpretPrompt({ blocks, condition: 'image_context', vantage: 'glasses', situation })
  const co = buildInterpretPrompt({ blocks, condition: 'context_only', vantage: null, situation })

  it('blocks 1–4 are byte-identical across image_only and image_context (equal hashes)', () => {
    for (const k of ['block1', 'block2', 'block3', 'block4'] as const) {
      expect(io.hashes[k]).toBeTruthy()
      expect(io.hashes[k]).toBe(ic.hashes[k])
      expect(io.sent[k]).toBe(ic.sent[k])
    }
    expect(io.system).toBe(ic.system)
  })
  it('blocks 1–3 are identical for context_only too; block 4 is the `none` line', () => {
    for (const k of ['block1', 'block2', 'block3'] as const) expect(co.hashes[k]).toBe(io.hashes[k])
    expect(co.sent.block4).toBe(blocks.vantageLines.none)
    expect(co.vantageSent).toBe('none')
    expect(co.includesImage).toBe(false)
  })
  it('blocks 5 and 6 are EMPTY (null hash) for image_only, populated otherwise', () => {
    expect(io.sent.block5).toBe('')
    expect(io.sent.block6).toBe('')
    expect(io.hashes.block5).toBeNull()
    expect(io.hashes.block6).toBeNull()
    expect(ic.sent.block5).toMatch(/^<context>[\s\S]*<\/context>$/)
    expect(ic.sent.block6).toBe(blocks.blocks.block6)
    expect(ic.hashes.block6).toBe(blocks.sourceHashes.block6)
    expect(co.hashes.block6).toBe(ic.hashes.block6)
  })
  it('block 4 as sent is the one vantage line, and differs per vantage', () => {
    expect(io.sent.block4).toBe(blocks.vantageLines.glasses)
    const phone = buildInterpretPrompt({ blocks, condition: 'image_only', vantage: 'phone', situation })
    expect(phone.hashes.block4).not.toBe(io.hashes.block4)
  })
  it('situation line only with context; text note is none; no leftover placeholders or annotations', () => {
    expect(io.user).not.toMatch(/<situation>/)
    expect(ic.user).toMatch(/<situation>Friday 13:05 · home<\/situation>/)
    expect(co.user).toMatch(/<situation>Friday 13:05 · home<\/situation>/)
    for (const b of [io, ic, co]) {
      expect(b.user).toMatch(/<text_note>none<\/text_note>/)
      expect(b.user).not.toMatch(/\{\{/)
      expect(b.user).not.toMatch(/←/)
      expect(b.system).not.toMatch(/\{\{/)
    }
  })
  it('fills the context slots from the provider and marks empty ones', () => {
    const filled = buildInterpretPrompt({
      blocks,
      condition: 'image_context',
      vantage: 'phone',
      situation,
      context: { dishCards: 'CARD: salmon plate', habitProfile: 'usual dinner: large', dishware: 'bowl A 600 ml' },
    })
    expect(filled.sent.block5).toMatch(/CARD: salmon plate/)
    expect(filled.sent.block5).toMatch(/usual dinner: large/)
    expect(filled.sent.block5).toMatch(/bowl A 600 ml/)
    expect(ic.sent.block5).toMatch(/\(no dish cards retrieved\)/)
    expect(filled.hashes.block5).not.toBe(ic.hashes.block5)
  })
  it('image conditions need a vantage', () => {
    expect(() => buildInterpretPrompt({ blocks, condition: 'image_only', vantage: null, situation })).toThrow(/vantage/)
  })
  it('combinedPromptHash is stable and sensitive to any block', () => {
    expect(combinedPromptHash(io.hashes)).toBe(combinedPromptHash({ ...io.hashes }))
    expect(combinedPromptHash(io.hashes)).not.toBe(combinedPromptHash(ic.hashes))
  })
})
