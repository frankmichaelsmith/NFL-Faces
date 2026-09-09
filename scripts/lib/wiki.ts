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
  number: number | null
  college: string | null
  draftYear: number | null
  draftRound: number | null
  draftPick: number | null
  undraftedYear: number | null
  position: string | null
}

const field = (t: string, k: string) => {
  const m = t.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n]*)`))
  return m ? m[1]!.trim() : ''
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

export function parseInfobox(wikitext: string): InfoboxFacts {
  return {
    number: int(field(wikitext, 'number')),
    college: plain(field(wikitext, 'college')) || null,
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
