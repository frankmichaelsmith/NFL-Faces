/**
 * Minimal RFC 4180 CSV parse/serialize. No dependency: the content files are
 * small, hand-editable, and we want line numbers in every validation error.
 */

export interface ParsedCsv {
  header: string[]
  /** One entry per data row, in file order. */
  rows: string[][]
  /** 1-based line number where each data row starts (for error messages). */
  lines: number[]
}

export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = []
  const lines: number[] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let line = 1
  let recordStart = 1
  let i = 0
  const src = text.replace(/^\uFEFF/, '')
  const endRecord = () => {
    record.push(field)
    field = ''
    // skip fully blank lines
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record)
      lines.push(recordStart)
    }
    record = []
    recordStart = line
  }
  while (i < src.length) {
    const c = src[i]!
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      if (c === '\n') line++
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
    } else if (c === ',') {
      record.push(field)
      field = ''
      i++
    } else if (c === '\r') {
      i++
    } else if (c === '\n') {
      line++
      endRecord()
      i++
    } else {
      field += c
      i++
    }
  }
  if (inQuotes) throw new Error(`Unterminated quoted field starting near line ${recordStart}`)
  if (field !== '' || record.length > 0) endRecord()
  const header = records.shift() ?? []
  lines.shift()
  return { header, rows: records, lines }
}

export function serializeCsv(
  header: string[],
  rows: (string | number | boolean | null)[][],
): string {
  const esc = (v: string | number | boolean | null) => {
    const s = v === null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n'
}
