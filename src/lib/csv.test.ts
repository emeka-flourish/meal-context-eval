import { describe, it, expect } from 'vitest'
import { csvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('passes plain values through', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(true)).toBe('true')
  })
  it('missing is EMPTY, never zero (missing-surface rule)', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
  it('quotes cells containing commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
  })
  it('doubles embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })
  it('quotes cells containing newlines', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"')
  })
  it('serializes Dates as ISO 8601', () => {
    expect(csvCell(new Date('2026-08-12T10:00:00Z'))).toBe('2026-08-12T10:00:00.000Z')
  })
  it('serializes objects (Json columns) as JSON strings, quoted', () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })
})

describe('toCsv', () => {
  it('emits header row from keys of the first row', () => {
    const csv = toCsv([{ a: 1, b: 'x' }])
    expect(csv).toBe('a,b\r\n1,x\r\n')
  })
  it('uses the explicit header order and fills missing keys as empty', () => {
    const csv = toCsv([{ b: 2 }], ['a', 'b'])
    expect(csv).toBe('a,b\r\n,2\r\n')
  })
  it('emits just the header for zero rows with explicit headers', () => {
    expect(toCsv([], ['x', 'y'])).toBe('x,y\r\n')
  })
  it('round-trips a nasty row', () => {
    const csv = toCsv([{ name: 'a,"b"\nc', n: null }], ['name', 'n'])
    expect(csv).toBe('name,n\r\n"a,""b""\nc",\r\n')
  })
})
