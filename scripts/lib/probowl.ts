/**
 * Pro Bowl Mode content: CSV schemas, validation, and the pure derivation of
 * the bundle section (rosters, players, colleges, draft-team tiles, combos).
 *
 * Rules (Frank, 2026-09-09):
 * - Pool: every QB/RB/WR/TE named to a season's Pro Bowl, replacements included.
 * - Categories: alma mater, draft team (UNDRAFTED is a real value), pro number
 *   (most recent), pro position.
 * - Draft team abbreviations are era-accurate; tiles carry that era's colours.
 */
import type { ProBowlCategory, ProBowlSection } from '../../src/game/bundle'
import { parseCsv } from './csv'

export const SKILL = ['QB', 'RB', 'WR', 'TE'] as const
export type Skill = (typeof SKILL)[number]
export const CATEGORIES: ProBowlCategory[] = ['alma', 'draft', 'number', 'position']

export interface SelectionRow {
  season: number
  pos: Skill
  wiki_title: string
  name: string
  team: string
  /** Resolved ESPN athlete id; empty until resolved. Curator edits are preserved by the pull. */
  espn_id: string
  note: string
}

export interface PlayerRow {
  espn_id: string
  name: string
  pos: Skill
  jersey: number | null
  jersey_source: string
  college_id: string
  college_name: string
  college_logo: string
  college_source: string
  draft_status: 'drafted' | 'undrafted' | 'unknown'
  draft_year: number | null
  draft_round: number | null
  draft_pick: number | null
  /** Key into draft_teams.csv. */
  draft_team: string
  draft_team_name: string
  draft_source: string
  included: boolean
  notes: string
}

export interface DraftTeamRow {
  abbr: string
  label: string
  name: string
  color: string
  alt_color: string
  first_season: number | null
  last_season: number | null
  notes: string
}

export const SELECTION_HEADER = [
  'season',
  'pos',
  'wiki_title',
  'name',
  'team',
  'espn_id',
  'note',
] as const
export const PLAYER_HEADER = [
  'espn_id',
  'name',
  'pos',
  'jersey',
  'jersey_source',
  'college_id',
  'college_name',
  'college_logo',
  'college_source',
  'draft_status',
  'draft_year',
  'draft_round',
  'draft_pick',
  'draft_team',
  'draft_team_name',
  'draft_source',
  'included',
  'notes',
] as const
export const DRAFT_TEAM_HEADER = [
  'abbr',
  'label',
  'name',
  'color',
  'alt_color',
  'first_season',
  'last_season',
  'notes',
] as const

export interface ProBowlContent {
  selections: SelectionRow[]
  players: PlayerRow[]
  draftTeams: DraftTeamRow[]
}

// ---- parsing ----------------------------------------------------------------------

function table(
  file: string,
  text: string,
  header: readonly string[],
  errors: string[],
): Record<string, string>[] {
  let parsed
  try {
    parsed = parseCsv(text)
  } catch (e) {
    errors.push(`${file}: ${(e as Error).message}`)
    return []
  }
  const missing = header.filter((h) => !parsed.header.includes(h))
  if (missing.length) {
    errors.push(`${file}:1: missing columns ${missing.join(', ')}`)
    return []
  }
  return parsed.rows.map((row, i) => {
    const o: Record<string, string> = { __line: String(parsed.lines[i]) }
    parsed.header.forEach((h, j) => (o[h] = (row[j] ?? '').trim()))
    return o
  })
}

const intOrNull = (v: string) => (v === '' ? null : /^-?\d+$/.test(v) ? Number(v) : NaN)

export function parseProBowlContent(files: {
  selections: string
  players: string
  draftTeams: string
}): { content: ProBowlContent; errors: string[] } {
  const errors: string[] = []
  const selections: SelectionRow[] = table(
    'probowl_selections.csv',
    files.selections,
    SELECTION_HEADER,
    errors,
  ).map((r) => {
    const season = intOrNull(r.season!)
    if (season === null || Number.isNaN(season))
      errors.push(`probowl_selections.csv:${r.__line}: season must be an integer`)
    if (!(SKILL as readonly string[]).includes(r.pos!))
      errors.push(`probowl_selections.csv:${r.__line}: pos must be one of ${SKILL.join('/')}`)
    if (r.espn_id && !/^\d+$/.test(r.espn_id))
      errors.push(`probowl_selections.csv:${r.__line}: espn_id must be numeric or empty`)
    return {
      season: season ?? 0,
      pos: r.pos as Skill,
      wiki_title: r.wiki_title!,
      name: r.name!,
      team: r.team!,
      espn_id: r.espn_id!,
      note: r.note!,
    }
  })
  const players: PlayerRow[] = table(
    'probowl_players.csv',
    files.players,
    PLAYER_HEADER,
    errors,
  ).map((r) => {
    const num = (k: string) => {
      const v = intOrNull(r[k]!)
      if (Number.isNaN(v))
        errors.push(`probowl_players.csv:${r.__line}: ${k} must be an integer or empty`)
      return v
    }
    if (!/^\d+$/.test(r.espn_id!))
      errors.push(`probowl_players.csv:${r.__line}: espn_id must be numeric`)
    if (!(SKILL as readonly string[]).includes(r.pos!))
      errors.push(`probowl_players.csv:${r.__line}: pos must be one of ${SKILL.join('/')}`)
    if (!['drafted', 'undrafted', 'unknown'].includes(r.draft_status!))
      errors.push(`probowl_players.csv:${r.__line}: draft_status must be drafted|undrafted|unknown`)
    return {
      espn_id: r.espn_id!,
      name: r.name!,
      pos: r.pos as Skill,
      jersey: num('jersey'),
      jersey_source: r.jersey_source!,
      college_id: r.college_id!,
      college_name: r.college_name!,
      college_logo: r.college_logo!,
      college_source: r.college_source!,
      draft_status: r.draft_status as PlayerRow['draft_status'],
      draft_year: num('draft_year'),
      draft_round: num('draft_round'),
      draft_pick: num('draft_pick'),
      draft_team: r.draft_team!,
      draft_team_name: r.draft_team_name!,
      draft_source: r.draft_source!,
      included: r.included === 'true' || r.included === '',
      notes: r.notes!,
    }
  })
  const draftTeams: DraftTeamRow[] = table(
    'draft_teams.csv',
    files.draftTeams,
    DRAFT_TEAM_HEADER,
    errors,
  ).map((r) => {
    if (!/^[0-9A-Fa-f]{6}$/.test(r.color!) || !/^[0-9A-Fa-f]{6}$/.test(r.alt_color!))
      errors.push(`draft_teams.csv:${r.__line}: colours must be 6-digit hex`)
    return {
      abbr: r.abbr!,
      label: r.label!,
      name: r.name!,
      color: r.color!,
      alt_color: r.alt_color!,
      first_season: intOrNull(r.first_season!),
      last_season: intOrNull(r.last_season!),
      notes: r.notes!,
    }
  })
  const content = { selections, players, draftTeams }
  errors.push(...validateProBowl(content))
  return { content, errors }
}

export function validateProBowl(c: ProBowlContent): string[] {
  const errors: string[] = []
  const players = new Map(c.players.map((p) => [p.espn_id, p]))
  const teams = new Map(c.draftTeams.map((t) => [t.abbr, t]))
  const seenPlayers = new Set<string>()
  for (const p of c.players) {
    if (seenPlayers.has(p.espn_id))
      errors.push(`probowl_players.csv: duplicate espn_id ${p.espn_id}`)
    seenPlayers.add(p.espn_id)
    if (p.draft_status === 'drafted' && !teams.has(p.draft_team))
      errors.push(`probowl_players.csv: ${p.name} drafted by unknown team key "${p.draft_team}"`)
  }
  const seenSel = new Set<string>()
  for (const s of c.selections) {
    const k = `${s.season}:${s.espn_id || s.wiki_title}`
    if (seenSel.has(k)) errors.push(`probowl_selections.csv: duplicate ${k}`)
    seenSel.add(k)
    if (s.espn_id && !players.has(s.espn_id))
      errors.push(
        `probowl_selections.csv: ${s.name} (${s.season}) resolves to ${s.espn_id} which is not in probowl_players.csv`,
      )
  }
  return errors
}

// ---- derivation -----------------------------------------------------------------------

export interface ProBowlReport {
  seasons: { season: number; named: number; resolved: number; combos: number }[]
  unresolved: { season: number; name: string; note: string }[]
  missing: Record<'college' | 'jersey' | 'draft', string[]>
  byCategory: Record<ProBowlCategory, number>
  hardFailures: string[]
}

export function buildProBowl(c: ProBowlContent): {
  section: ProBowlSection
  report: ProBowlReport
} {
  const players = new Map(c.players.filter((p) => p.included).map((p) => [p.espn_id, p]))
  const teams = new Map(c.draftTeams.map((t) => [t.abbr, t]))

  // Rosters: resolved, included selections per season.
  const rosters: Record<string, string[]> = {}
  const unresolved: ProBowlReport['unresolved'] = []
  const named = new Map<number, number>()
  for (const s of c.selections) {
    named.set(s.season, (named.get(s.season) ?? 0) + 1)
    if (!s.espn_id || !players.has(s.espn_id)) {
      unresolved.push({ season: s.season, name: s.name, note: s.note })
      continue
    }
    const list = (rosters[String(s.season)] ??= [])
    if (!list.includes(s.espn_id)) list.push(s.espn_id)
  }
  const seasons = Object.keys(rosters)
    .map(Number)
    .sort((a, b) => a - b)
  const inPool = new Set(Object.values(rosters).flat())

  // Value pools across the whole player pool.
  const collegeIds = new Set<string>()
  const draftKeys = new Set<string>()
  const numbersByPos = new Map<Skill, Set<string>>()
  for (const id of inPool) {
    const p = players.get(id)!
    if (p.college_id) collegeIds.add(p.college_id)
    if (p.draft_status === 'drafted') draftKeys.add(p.draft_team)
    if (p.draft_status === 'undrafted') draftKeys.add('UDFA')
    if (p.jersey !== null)
      (numbersByPos.get(p.pos) ?? numbersByPos.set(p.pos, new Set()).get(p.pos)!).add(
        String(p.jersey),
      )
  }

  const section: ProBowlSection = {
    seasons,
    rosters,
    players: {},
    colleges: {},
    teams: {},
    combos: [],
  }
  for (const id of [...inPool].sort()) {
    const p = players.get(id)!
    section.players[id] = {
      name: p.name,
      pos: p.pos,
      jersey: p.jersey,
      college: p.college_id || null,
      draft:
        p.draft_status === 'drafted'
          ? p.draft_team
          : p.draft_status === 'undrafted'
            ? 'UDFA'
            : null,
    }
    if (p.college_id && !section.colleges[p.college_id])
      section.colleges[p.college_id] = {
        name: p.college_name,
        logo: p.college_logo ? `${p.college_id}.png` : null,
      }
  }
  for (const key of draftKeys) {
    if (key === 'UDFA') continue
    const t = teams.get(key)!
    section.teams[key] = { label: t.label, name: t.name, color: t.color, alt: t.alt_color }
  }

  const byCategory: Record<ProBowlCategory, number> = { alma: 0, draft: 0, number: 0, position: 0 }
  const hardFailures: string[] = []
  const labelOf = (key: string) => (key === 'UDFA' ? 'UDFA' : teams.get(key)?.label)
  for (const season of seasons) {
    for (const id of rosters[String(season)]!) {
      const p = players.get(id)!
      const emit = (category: ProBowlCategory, answer: string, distractors: string[]) => {
        if (distractors.length < 2) {
          hardFailures.push(
            `${season} ${p.name} ${category}: only ${distractors.length} distractor(s)`,
          )
          return
        }
        section.combos.push({ season, player: id, category, answer, distractors })
        byCategory[category]++
      }
      if (p.college_id)
        emit(
          'alma',
          p.college_id,
          [...collegeIds].filter((x) => x !== p.college_id),
        )
      const draftAnswer = section.players[id]!.draft
      if (draftAnswer) {
        const ansLabel = labelOf(draftAnswer)
        emit(
          'draft',
          draftAnswer,
          [...draftKeys].filter((x) => x !== draftAnswer && labelOf(x) !== ansLabel),
        )
      }
      if (p.jersey !== null)
        emit(
          'number',
          String(p.jersey),
          [...(numbersByPos.get(p.pos) ?? [])].filter((x) => x !== String(p.jersey)),
        )
      emit(
        'position',
        p.pos,
        SKILL.filter((x) => x !== p.pos),
      )
    }
  }

  const missing: ProBowlReport['missing'] = { college: [], jersey: [], draft: [] }
  for (const id of inPool) {
    const p = players.get(id)!
    if (!p.college_id) missing.college.push(p.name)
    if (p.jersey === null) missing.jersey.push(p.name)
    if (p.draft_status === 'unknown') missing.draft.push(p.name)
  }
  const report: ProBowlReport = {
    seasons: seasons.map((season) => ({
      season,
      named: named.get(season) ?? 0,
      resolved: rosters[String(season)]!.length,
      combos: section.combos.filter((x) => x.season === season).length,
    })),
    unresolved,
    missing,
    byCategory,
    hardFailures,
  }
  return { section, report }
}

export function renderProBowlReport(section: ProBowlSection, r: ProBowlReport): string {
  const lines: string[] = ['## Pro Bowl Mode', '']
  lines.push(
    `**${section.combos.length}** combos across ${section.seasons.length} seasons, ${Object.keys(section.players).length} players, ` +
      `${Object.keys(section.colleges).length} colleges, ${Object.keys(section.teams).length} draft-team tiles.`,
    '',
  )
  if (r.hardFailures.length)
    lines.push('### HARD FAILURES', '', ...r.hardFailures.map((f) => `- ${f}`), '')
  lines.push(
    `By category: alma ${r.byCategory.alma}, draft ${r.byCategory.draft}, number ${r.byCategory.number}, position ${r.byCategory.position}.`,
    '',
  )
  lines.push('| Season | Named | Resolved | Combos |', '|---|---|---|---|')
  for (const s of r.seasons)
    lines.push(`| ${s.season} | ${s.named} | ${s.resolved} | ${s.combos} |`)
  lines.push('')
  lines.push(`### Unresolved selections (${r.unresolved.length})`, '')
  lines.push(
    ...(r.unresolved.length
      ? r.unresolved.map((u) => `- ${u.season} ${u.name}${u.note ? ` — ${u.note}` : ''}`)
      : ['None.']),
    '',
  )
  for (const k of ['college', 'jersey', 'draft'] as const) {
    lines.push(`### Players missing ${k} (${r.missing[k].length})`, '')
    lines.push(r.missing[k].length ? r.missing[k].sort().join(', ') : 'None.', '')
  }
  return lines.join('\n')
}
