import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvRecords } from './csv-parse'

describe('parseCsv', () => {
  it('parses plain rows and drops the trailing newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles quoted fields with embedded commas, quotes and newlines', () => {
    const text = 'id,text\n1,"hello, world"\n2,"she said ""hi"""\n3,"line one\nline two"\n'
    expect(parseCsv(text)).toEqual([
      ['id', 'text'],
      ['1', 'hello, world'],
      ['2', 'she said "hi"'],
      ['3', 'line one\nline two'],
    ])
  })

  it('handles CRLF and bare CR line endings and a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\r\n1,"x\r\ny"\r\n')).toEqual([
      ['a', 'b'],
      ['1', 'x\r\ny'],
    ])
  })

  it('keeps empty fields, empty quoted fields and trailing commas', () => {
    expect(parseCsv('a,,c\n,"",\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('skips blank lines but keeps a one-column empty quoted row', () => {
    expect(parseCsv('a\n\n1\n\n')).toEqual([['a'], ['1']])
    expect(parseCsv('a\n""\n')).toEqual([['a'], ['']])
  })

  it('parses a JSON column with nested quotes as a single field', () => {
    const json = JSON.stringify([{ name: 'egg', amount: '2', unit: null }])
    const csv = 'id,dishes\n7,"' + json.replace(/"/g, '""') + '"\n'
    const rows = parseCsv(csv)
    expect(rows[1][1]).toBe(json)
    expect(JSON.parse(rows[1][1])).toEqual([{ name: 'egg', amount: '2', unit: null }])
  })

  it('throws on an unterminated quoted field', () => {
    expect(() => parseCsv('a,b\n1,"open')).toThrow(/unterminated/)
  })

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })
})

describe('parseCsvRecords', () => {
  it('keys cells by header and pads short rows', () => {
    expect(parseCsvRecords('a,b,c\n1,2\n')).toEqual([{ a: '1', b: '2', c: '' }])
  })
  it('throws when a row has more cells than the header', () => {
    expect(() => parseCsvRecords('a,b\n1,2,3\n')).toThrow(/row 2/)
  })
  it('returns [] for a header-only or empty file', () => {
    expect(parseCsvRecords('a,b\n')).toEqual([])
    expect(parseCsvRecords('')).toEqual([])
  })
})
