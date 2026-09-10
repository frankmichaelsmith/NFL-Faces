/**
 * Wikipedia wikitext access and the three parsers Pro Bowl Mode needs:
 *   - Pro Bowl rosters per season (two page formats),
 *   - NFL draft pages (one {{NFLDraft-row}} per pick, undrafted signings flagged),
 *   - player infobox fields (number, college, draft year/round/pick).
 * Pure parsers take wikitext strings so they can be unit-tested on samples.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const UA =
  'nfl-faces-pull/0.1 (https://github.com/frankmichaelsmith/NFL-Faces; fmsfranksmith@gmail.com)'

export class WikiClient {
  private last = 0
  constructor(private readonly cacheDir: string) {}

  /** Wikipedia asks for a gentle pace from scripts: ~4 requests/s, with backoff on 429. */
  private async pace() {
    const gap = 250 - (Date.now() - this.last)
    if (gap > 0) await new Promise((r) => setTimeout(r, gap))
    this.last = Date.now()
  }

  /** Article titles matching a full-text search, best first. Cached on disk. */
  async search(query: string, limit = 5): Promise<string[]> {
    const key = createHash('sha1')
      .update('search:' + query)
      .digest('hex')
    const file = path.join(this.cacheDir, key + '.json')
    try {
      return (JSON.parse(await readFile(file, 'utf8')) as { titles: string[] }).titles
    } catch {
      /* miss */
    }
    const q = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(limit),
      format: 'json',
    })
    await this.pace()
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${q}`, {
      headers: { 'User-Agent': UA },
    })
    if (!res.ok) throw new Error(`Wikipedia search HTTP ${res.status} for ${query}`)
    const body = (await res.json()) as { query?: { search?: { title: string }[] } }
    const titles = (body.query?.search ?? []).map((r) => r.title)
    await mkdir(this.cacheDir, { recursive: true })
    await writeFile(file, JSON.stringify({ titles }))
    return titles
  }

  /** Wikitext of a page (following redirects), or null if it does not exist. Cached on disk. */
  async wikitext(title: string): Promise<string | null> {
    const key = createHash('sha1').update(title).digest('hex')
    const file = path.join(this.cacheDir, key + '.json')
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as { text: string | null }
      return cached.text
    } catch {
      /* miss */
    }
    const q = new URLSearchParams({
      action: 'parse',
      page: title,
      prop: 'wikitext',
      redirects: '1',
      format: 'json',
    })
    type ParseBody = { parse?: { wikitext: { '*': string } }; error?: unknown }
    let body: ParseBody | null = null
    for (let attempt = 0; attempt < 5 && !body; attempt++) {
      await this.pace()
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${q}`, {
        headers: { 'User-Agent': UA },
      })
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
        continue
      }
      if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status} for ${title}`)
      body = (await res.json()) as ParseBody
    }
    if (!body) throw new Error(`Wikipedia kept rate-limiting ${title}`)
    const text = body.parse?.wikitext['*'] ?? null
    await mkdir(this.cacheDir, { recursive: true })
    await writeFile(file, JSON.stringify({ text }))
    return text
  }
}

// ---- Pro Bowl rosters ---------------------------------------------------------------

export type SkillPos = 'QB' | 'RB' | 'WR' | 'TE'
const POS: Record<string, SkillPos> = {
  Quarterback: 'QB',
  'Running back': 'RB',
  'Wide receiver': 'WR',
  'Tight end': 'TE',
}

export interface RosterEntry {
  pos: SkillPos
  /** Jersey number as printed on the Pro Bowl roster for that season, if any. */
  number: number | null
  /** Article title of the player, e.g. "Rod Smith (wide receiver)". */
  wikiTitle: string
  /** Display name without the disambiguator. */
  name: string
  /** Team as written on the page (city or full name). */
  team: string
}

/** Page title candidates for a season's Pro Bowl (played the following calendar year). */
export function proBowlTitles(season: number): string[] {
  const y = season + 1
  return [`${y} Pro Bowl Games`, `${y} Pro Bowl`]
}

/** Parse every QB/RB/WR/TE on a Pro Bowl page, replacements included. */
export function parseProBowlRoster(wikitext: string): RosterEntry[] {
  const out: RosterEntry[] = []
  const push = (pos: SkillPos, num: string, title: string, team: string) => {
    const wikiTitle = title.trim()
    const m = num.match(/\d+/)
    out.push({
      pos,
      number: m ? Number(m[0]) : null,
      wikiTitle,
      name: wikiTitle.replace(/\s*\(.*\)$/, ''),
      team: team.trim(),
    })
  }
  // Format A (most years): table rows
  //   | [[Quarterback]] | {{Small|12}} '''[[Tom Brady]]''', [[New England Patriots|New England]]<br/>...
  for (const row of wikitext.split(/\n\|-/)) {
    const m = row.match(/\[\[(Quarterback|Running back|Wide receiver|Tight end)s?(?:\|[^\]]*)?\]\]/)
    if (!m) continue
    const pos = POS[m[1]!]!
    const re =
      /\{\{[Ss]mall\|([^}]*)\}\}\s*'*\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]'*\s*,\s*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
    let x: RegExpExecArray | null
    while ((x = re.exec(row))) push(pos, x[1]!, x[2]!, x[4] ?? x[3]!)
  }
  if (out.length >= 10) return dedupe(out)
  // Format B (2013–2015 unconferenced drafts): '''Quarterbacks''' headings, then
  //   * {{NFLplayer|12| Andrew Luck |([[Indianapolis Colts]])}}
  const parts = wikitext.split(
    /'''\s*(?:\[\[)?(Quarterback|Running back|Wide receiver|Tight end)s?(?:\|[^\]]*)?(?:\]\])?s?\s*'''/i,
  )
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]!
    const pos = POS[heading.charAt(0).toUpperCase() + heading.slice(1).toLowerCase()]!
    const body = parts[i + 1]!.split(/'''\s*(?:\[\[)?[A-Z]/)[0]!
    const re = /\{\{NFLplayer\|([^|]*)\|\s*([^|}]+?)\s*\|\s*\(?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
    let x: RegExpExecArray | null
    while ((x = re.exec(body))) push(pos, x[1]!, x[2]!, x[3]!)
  }
  if (out.length >= 10) return dedupe(out)
  // Format C (1995–1997 pages): '''QB'''<br> headings, one player per line, bold = starter:
  //   '''[[Drew Bledsoe]]''' – New England<br>   [[Eric Green (tight end)|Eric Green]] – PIT (injury replacement)
  // No jersey numbers are printed.
  const abbrev: Record<string, SkillPos> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE' }
  const cParts = wikitext.split(/'''(QB|RB|WR|TE)'''/)
  for (let i = 1; i < cParts.length; i += 2) {
    const pos = abbrev[cParts[i]!]!
    const body = cParts[i + 1]!.split(/'''[A-Z]{1,3}'''|\{\{Col/)[0]!
    const re = /'*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]'*\s*[–—-]\s*([^<\n(]+)/g
    let x: RegExpExecArray | null
    while ((x = re.exec(body))) push(pos, '', x[1]!, x[2]!)
  }
  if (out.length >= 10) return dedupe(out)
  // Format D (1998–1999 pages): ===Quarterbacks=== headings with bullets:
  //   *[[Tim Brown (American football)|Tim Brown]] – Oakland Raiders
  const dParts = wikitext.split(
    /===\s*(Quarterbacks?|Running backs?|Wide receivers?|Tight ends?)\s*===/i,
  )
  for (let i = 1; i < dParts.length; i += 2) {
    const heading = dParts[i]!.toLowerCase()
    const pos: SkillPos = heading.startsWith('quarterback')
      ? 'QB'
      : heading.startsWith('running')
        ? 'RB'
        : heading.startsWith('wide')
          ? 'WR'
          : 'TE'
    const body = dParts[i + 1]!.split(/\n==/)[0]!
    const re = /^\*\s*'*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]'*\s*[–—-]\s*(.+)$/gm
    let x: RegExpExecArray | null
    while ((x = re.exec(body))) push(pos, '', x[1]!, plain(x[2]!))
  }
  return dedupe(out)
}

function dedupe(entries: RosterEntry[]): RosterEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const k = `${e.pos}:${e.wikiTitle}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---- NFL draft pages ---------------------------------------------------------------------

export interface DraftRow {
  year: number
  round: number | null
  pick: number | null
  /** Full team name as written, e.g. "St. Louis Rams". */
  team: string
  first: string
  last: string
  position: string
  college: string
  undrafted: boolean
}

/** Every {{NFLDraft-row}} on a draft page, drafted and undrafted alike. */
export function parseDraftPage(wikitext: string): DraftRow[] {
  const rows: DraftRow[] = []
  const re = /\{\{NFLDraft-row\s*\|([^]*?)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(wikitext))) {
    const fields: Record<string, string> = {}
    for (const part of m[1]!.split('|')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      fields[part.slice(0, eq).trim()] = part
        .slice(eq + 1)
        .replace(/\{\{[^}]*\}\}/g, '')
        .replace(/<[^>]*>/g, '')
        .trim()
    }
    if (!fields.last) continue
    rows.push({
      year: Number(fields.draftyear),
      round: fields.round ? Number(fields.round) : null,
      pick: fields.picknum ? Number(fields.picknum) : null,
      team: fields.team ?? '',
      first: fields.first ?? '',
      last: fields.last,
      position: fields.position ?? '',
      college: fields.collegeteam ?? fields.college ?? '',
      undrafted: fields.undrafted === 'yes' || !fields.round,
    })
  }
  return rows
}

// ---- Player infobox -------------------------------------------------------------------------

export interface InfoboxFacts {
  /** First number listed (the infobox lists them in career order). */
  number: number | null
  /** Every number the infobox lists, e.g. "12, 7, 1" → [12, 7, 1]. */
  numbers: number[]
  /** The last college listed: the one the player left for the NFL. */
  college: string | null
  /** Every college listed, in order, with the wikilink target when there is one. */
  colleges: { name: string; link: string | null }[]
  draftYear: number | null
  draftRound: number | null
  draftPick: number | null
  undraftedYear: number | null
  position: string | null
}

/** An infobox field's raw value, including a bulleted or {{ubl}} list that runs over several lines. */
const field = (t: string, k: string) => {
  const m = t.match(
    new RegExp(`\\|\\s*${k}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\|\\s*[A-Za-z_]+\\s*=|\\n\\}\\}|$)`),
  )
  return m ? m[1]!.trim() : ''
}
/** Drop citations, comments, templates and tags so only the human-readable value remains. */
const strip = (s: string) =>
  s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
/** Split a list value on <br>, newlines, bullets and the pipes of an {{ubl}}/{{plainlist}}, keeping wikilinks intact. */
const unwrapLists = (raw: string) =>
  raw
    .replace(/\{\{\s*(?:ubl|unbulleted list|plainlist|hlist|flatlist)\s*\|/gi, '\n')
    .replace(/\}\}\s*$/, '')
const listItems = (body: string): string[] => {
  const items: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '[[' || two === '{{') depth++
    if (two === ']]' || two === '}}') depth = Math.max(0, depth - 1)
    const ch = body[i]!
    if (
      depth === 0 &&
      (ch === '\n' ||
        ch === '|' ||
        body.slice(i, i + 4).toLowerCase() === '<br>' ||
        body.slice(i, i + 5).toLowerCase() === '<br/>' ||
        body.slice(i, i + 6).toLowerCase() === '<br />')
    ) {
      items.push(cur)
      cur = ''
      if (ch === '<') i += body.slice(i).toLowerCase().indexOf('>')
      continue
    }
    cur += ch
  }
  items.push(cur)
  return items.map((s) => s.replace(/^\s*\*+\s*/, '').trim()).filter(Boolean)
}
const int = (s: string) => {
  const m = s.match(/\d+/)
  return m ? Number(m[0]) : null
}
const plain = (s: string) =>
  s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s*\(.*$/, '')
    .trim()

/** "[[UNLV Rebels football|UNLV]] (1981–1984)<br>[[Florida Gators football|Florida]]" → both schools, in order. */
export function parseColleges(raw: string): { name: string; link: string | null }[] {
  const out: { name: string; link: string | null }[] = []
  for (const part of listItems(strip(unwrapLists(raw)))) {
    const links = [...part.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)]
    if (links.length)
      for (const l of links) out.push({ name: (l[2] ?? l[1]!).trim(), link: l[1]!.trim() })
    else {
      const p = plain(part)
      if (p) out.push({ name: p, link: null })
    }
  }
  return out.filter((c) => c.name)
}

/** The {{Infobox …}} template alone, so a `number=` in a citation or navbox further down is never read. */
export function infoboxBody(wikitext: string): string {
  const start = wikitext.search(/\{\{\s*Infobox/i)
  if (start === -1) return wikitext
  let depth = 0
  for (let i = start; i < wikitext.length - 1; i++) {
    const two = wikitext.slice(i, i + 2)
    if (two === '{{') {
      depth++
      i++
    } else if (two === '}}') {
      depth--
      i++
      if (depth === 0) return wikitext.slice(start, i + 1)
    }
  }
  return wikitext.slice(start)
}

export function parseInfobox(fullText: string): InfoboxFacts {
  const wikitext = infoboxBody(fullText)
  const colleges = parseColleges(field(wikitext, 'college'))
  const numbers = (strip(field(wikitext, 'number')).match(/\d+/g) ?? [])
    .map(Number)
    .filter((n) => n <= 99)
  return {
    number: numbers[0] ?? null,
    numbers,
    college: colleges.at(-1)?.name ?? null,
    colleges,
    draftYear: int(field(wikitext, 'draftyear')),
    draftRound: int(field(wikitext, 'draftround')),
    draftPick: int(field(wikitext, 'draftpick')),
    undraftedYear: int(field(wikitext, 'undraftedyear')),
    position: plain(field(wikitext, 'position')) || null,
  }
}

/** Fold "A. J. Green" → "A.J. Green" and strip accents for matching. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b([A-Z])\.\s+([A-Z])\./g, '$1.$2.')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nameKey(s: string): string {
  return normalizeName(s)
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
