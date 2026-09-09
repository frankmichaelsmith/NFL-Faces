/**
 * Content schemas (content/*.csv), parsing, and validation.
 *
 * Every error carries `file:line: message` so a curator can fix it in a
 * spreadsheet. Validation never throws on data problems; it returns them all.
 */
import { parseCsv } from './csv'

export interface TeamRow {
  team_id: string
  espn_id: string
  label: string
  location: string
  /** First season this franchise fielded a team, clamped to the game's first season. */
  active_from: number
}

export interface PersonRow {
  espn_id: string
  person_id: string
  display_name: string
  included: boolean
  /** ESPN serves a real headshot for this athlete id. */
  espn_headshot: boolean
  /** Where the served photo came from (espn | commons:<file> | manual:<note>). Empty = none yet. */
  photo_source: string
  photo_license: string
  photo_approved: boolean
  notes: string
}

export interface StintRow {
  season: number
  team_id: string
  espn_id: string
  role: string
  /** Regular-season passing yards; null for live-season depth-chart rows before any game. */
  passing_yards: number | null
  /** ESPN's listing order within the team-season (0 = leader). Breaks ties deterministically. */
  espn_order: number
  /** Live season only: this player is the current starter. */
  starter: boolean
  source: 'leaders' | 'depthchart'
}

export interface Content {
  teams: TeamRow[]
  people: PersonRow[]
  stints: StintRow[]
}

export const TEAM_HEADER = ['team_id', 'espn_id', 'label', 'location', 'active_from'] as const
export const PERSON_HEADER = [
  'espn_id',
  'person_id',
  'display_name',
  'included',
  'espn_headshot',
  'photo_source',
  'photo_license',
  'photo_approved',
  'notes',
] as const
export const STINT_HEADER = [
  'season',
  'team_id',
  'espn_id',
  'role',
  'passing_yards',
  'espn_order',
  'starter',
  'source',
] as const

export interface ContentFiles {
  teams: string
  people: string
  stints: string
}

export interface ParseResult {
  content: Content
  errors: string[]
}

/** Parse the three CSV texts and validate them together. */
export function parseContent(files: ContentFiles): ParseResult {
  const errors: string[] = []
  const teams = parseTable('teams.csv', files.teams, TEAM_HEADER, errors, (get, err) => ({
    team_id: get(
      'team_id',
      (v) => /^[A-Z]{2,3}$/.test(v) || err('team_id must be 2–3 uppercase letters'),
    ),
    espn_id: get('espn_id', (v) => /^\d+$/.test(v) || err('espn_id must be numeric')),
    label: get('label', (v) => v.length > 0 || err('label is required')),
    location: get('location'),
    active_from: int(get('active_from'), 'active_from', err),
  }))
  const people = parseTable('people.csv', files.people, PERSON_HEADER, errors, (get, err) => ({
    espn_id: get('espn_id', (v) => /^\d+$/.test(v) || err('espn_id must be numeric')),
    person_id: get(
      'person_id',
      (v) => /^[a-z0-9-]+$/.test(v) || err('person_id must be kebab-case'),
    ),
    display_name: get('display_name', (v) => v.length > 0 || err('display_name is required')),
    included: bool(get('included'), 'included', err),
    espn_headshot: bool(get('espn_headshot'), 'espn_headshot', err),
    photo_source: get('photo_source'),
    photo_license: get('photo_license'),
    photo_approved: bool(get('photo_approved'), 'photo_approved', err),
    notes: get('notes'),
  }))
  const stints = parseTable('stints.csv', files.stints, STINT_HEADER, errors, (get, err) => {
    const source = get(
      'source',
      (v) => v === 'leaders' || v === 'depthchart' || err('source must be leaders|depthchart'),
    )
    const yards = get('passing_yards')
    return {
      season: int(get('season'), 'season', err),
      team_id: get('team_id'),
      espn_id: get('espn_id'),
      role: get('role', (v) => v.length > 0 || err('role is required')),
      passing_yards: yards === '' ? null : int(yards, 'passing_yards', err),
      espn_order: int(get('espn_order'), 'espn_order', err),
      starter: bool(get('starter'), 'starter', err),
      source: source as StintRow['source'],
    }
  })
  const content = { teams, people, stints }
  errors.push(...validateContent(content))
  return { content, errors }
}

/** Cross-row and cross-file rules. Row-level type checks happen in parseContent. */
export function validateContent(c: Content): string[] {
  const errors: string[] = []
  const teamIds = new Set<string>()
  for (const [i, t] of c.teams.entries()) {
    if (teamIds.has(t.team_id))
      errors.push(`teams.csv:row ${i + 1}: duplicate team_id ${t.team_id}`)
    teamIds.add(t.team_id)
  }
  const espnIds = new Set<string>()
  const personIds = new Set<string>()
  for (const [i, p] of c.people.entries()) {
    if (espnIds.has(p.espn_id))
      errors.push(`people.csv:row ${i + 1}: duplicate espn_id ${p.espn_id}`)
    if (personIds.has(p.person_id))
      errors.push(`people.csv:row ${i + 1}: duplicate person_id ${p.person_id}`)
    espnIds.add(p.espn_id)
    personIds.add(p.person_id)
    if (p.photo_approved && !p.photo_source)
      errors.push(
        `people.csv:row ${i + 1}: ${p.display_name} is photo_approved but photo_source is empty`,
      )
  }
  const teamsById = new Map(c.teams.map((t) => [t.team_id, t]))
  const seen = new Set<string>()
  const startersPerCombo = new Map<string, number>()
  for (const [i, s] of c.stints.entries()) {
    const where = `stints.csv:row ${i + 1}`
    const team = teamsById.get(s.team_id)
    if (!team) errors.push(`${where}: unknown team_id ${s.team_id}`)
    else if (s.season < team.active_from)
      errors.push(
        `${where}: ${s.team_id} was not active in ${s.season} (active_from ${team.active_from})`,
      )
    if (!espnIds.has(s.espn_id)) errors.push(`${where}: unknown espn_id ${s.espn_id}`)
    const key = `${s.season}:${s.team_id}:${s.espn_id}:${s.role}`
    if (seen.has(key)) errors.push(`${where}: duplicate stint ${key}`)
    seen.add(key)
    if (s.source === 'leaders' && s.passing_yards === null)
      errors.push(`${where}: leaders rows need passing_yards`)
    if (s.starter) {
      const ck = `${s.season}:${s.team_id}:${s.role}`
      startersPerCombo.set(ck, (startersPerCombo.get(ck) ?? 0) + 1)
    }
  }
  for (const [ck, n] of startersPerCombo)
    if (n > 1) errors.push(`stints.csv: ${n} starters for ${ck}; expected 1`)
  return errors
}

// ---- helpers -----------------------------------------------------------------

type Getter = (col: string, check?: (v: string) => unknown) => string
type ErrFn = (msg: string) => false

function parseTable<T>(
  file: string,
  text: string,
  header: readonly string[],
  errors: string[],
  build: (get: Getter, err: ErrFn) => T,
): T[] {
  let parsed
  try {
    parsed = parseCsv(text)
  } catch (e) {
    errors.push(`${file}: ${(e as Error).message}`)
    return []
  }
  const missing = header.filter((h) => !parsed.header.includes(h))
  const extra = parsed.header.filter((h) => !header.includes(h))
  if (missing.length || extra.length) {
    errors.push(
      `${file}:1: header mismatch` +
        (missing.length ? `; missing ${missing.join(', ')}` : '') +
        (extra.length ? `; unexpected ${extra.join(', ')}` : ''),
    )
    return []
  }
  const idx = new Map(parsed.header.map((h, i) => [h, i]))
  const out: T[] = []
  parsed.rows.forEach((row, r) => {
    const line = parsed.lines[r]
    if (row.length !== parsed.header.length) {
      errors.push(`${file}:${line}: expected ${parsed.header.length} fields, got ${row.length}`)
      return
    }
    const err: ErrFn = (msg) => {
      errors.push(`${file}:${line}: ${msg}`)
      return false
    }
    const get: Getter = (col, check) => {
      const v = (row[idx.get(col)!] ?? '').trim()
      check?.(v)
      return v
    }
    out.push(build(get, err))
  })
  return out
}

function int(v: string, col: string, err: ErrFn): number {
  if (!/^-?\d+$/.test(v)) {
    err(`${col} must be an integer, got "${v}"`)
    return NaN
  }
  return Number(v)
}

function bool(v: string, col: string, err: ErrFn): boolean {
  if (v === 'true') return true
  if (v === 'false' || v === '') return false
  err(`${col} must be true or false, got "${v}"`)
  return false
}
