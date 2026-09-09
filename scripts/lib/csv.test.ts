import { describe, expect, it } from 'vitest'
import { parseCsv, serializeCsv } from './csv'

describe('parseCsv', () => {
  it('parses header and rows with line numbers', () => {
    const p = parseCsv('a,b\n1,2\n3,4\n')
    expect(p.header).toEqual(['a', 'b'])
    expect(p.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
    expect(p.lines).toEqual([2, 3])
  })
  it('handles quotes, embedded commas, escaped quotes, CRLF and blank lines', () => {
    const p = parseCsv('name,notes\r\n"Smith, Steve","He said ""hi"""\r\n\r\nx,y\r\n')
    expect(p.rows).toEqual([
      ['Smith, Steve', 'He said "hi"'],
      ['x', 'y'],
    ])
    expect(p.lines).toEqual([2, 4])
  })
  it('counts newlines inside quoted fields toward later line numbers', () => {
    const p = parseCsv('a,b\n"multi\nline",1\nz,2\n')
    expect(p.rows[0]).toEqual(['multi\nline', '1'])
    expect(p.lines).toEqual([2, 4])
  })
  it('throws on an unterminated quote', () => {
    expect(() => parseCsv('a\n"oops\n')).toThrow(/Unterminated/)
  })
  it('round-trips through serializeCsv', () => {
    const header = ['id', 'text', 'flag']
    const rows = [
      ['1', 'plain', true],
      ['2', 'with, comma and "quote"', false],
      ['3', '', null],
    ]
    const back = parseCsv(serializeCsv(header, rows))
    expect(back.header).toEqual(header)
    expect(back.rows).toEqual([
      ['1', 'plain', 'true'],
      ['2', 'with, comma and "quote"', 'false'],
      ['3', '', ''],
    ])
  })
})
