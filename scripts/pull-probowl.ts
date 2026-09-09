/**
 * Pull Pro Bowl Mode content.
 *
 *   npm run pull:probowl -- [--first 2000] [--through <season>] [--refresh-espn]
 *
 * 1. Rosters: every QB/RB/WR/TE on each season's Wikipedia Pro Bowl page.
 * 2. Resolve each name to an ESPN athlete via search, verified by position and
 *    career span. A curator-set espn_id in probowl_selections.csv always wins.
 * 3. Facts per player: ESPN first (position, jersey, college + logo, draft),
 *    then the player's Wikipedia infobox for jersey/college/draft gaps, then
 *    the NFL draft page for the draft team (era-accurate name → draft_teams.csv).
 *
 * Writes content/probowl_selections.csv and content/probowl_players.csv.
 * Curator columns (espn_id on selections; included/notes on players) survive re-pulls.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serializeCsv } from './lib/csv'
import { EspnClient, type EspnAthleteFacts } from './lib/espn'
import {
  PLAYER_HEADER,
  SELECTION_HEADER,
  SKILL,
  parseProBowlContent,
  type DraftTeamRow,
  type PlayerRow,
  type SelectionRow,
  type Skill,
} from './lib/probowl'
import {
  WikiClient,
  nameKey,
  normalizeName,
  parseDraftPage,
  parseInfobox,
  parseProBowlRoster,
  proBowlTitles,
  type DraftRow,
} from './lib/wiki'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')

/** Wikipedia names ESPN spells differently. */
const ALIASES: Record<string, string> = {
  'Chad Ochocinco': 'Chad Johnson',
  'Chad Ocho Cinco': 'Chad Johnson',
  'Kellen Winslow II': 'Kellen Winslow',
}
/** ESPN era abbreviations that differ from draft_teams.csv keys. */
const ESPN_ABBR: Record<string, string> = { LOS: 'LARO' }
/** Positions ESPN may list for a skill slot. */
const POS_OK: Record<Skill, string[]> = {
  QB: ['QB'],
  RB: ['RB', 'FB', 'HB'],
  WR: ['WR'],
  TE: ['TE'],
}

interface Args {
  first: number
  through: number
  refreshEspn: boolean
}
function parseArgs(argv: string[]): Args {
  const now = new Date()
  // The Pro Bowl for season S is played in January of S+1; the latest complete season is last year.
  const a: Args = { first: 2000, through: now.getUTCFullYear() - 1, refreshEspn: false }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!
    if (v === '--first') a.first = Number(argv[++i])
    else if (v === '--through') a.through = Number(argv[++i])
    else if (v === '--refresh-espn') a.refreshEspn = true
    else throw new Error(`Unknown argument ${v}`)
  }
  return a
}

async function readExisting() {
  const read = async (f: string) => {
    try {
      return await readFile(path.join(CONTENT, f), 'utf8')
    } catch {
      return ''
    }
  }
  const [selections, players, draftTeams] = await Promise.all([
    read('probowl_selections.csv'),
    read('probowl_players.csv'),
    read('draft_teams.csv'),
  ])
  const empty = (h: readonly string[]) => h.join(',') + '\n'
  const { content, errors } = parseProBowlContent({
    selections: selections || empty(SELECTION_HEADER),
    players: players || empty(PLAYER_HEADER),
    draftTeams,
  })
  // Tolerate stale referential errors on re-pull; structural ones are fatal.
  const fatal = errors.filter((e) => /missing columns|must be/.test(e))
  if (fatal.length) throw new Error(`existing content invalid:\n${fatal.join('\n')}`)
  return content
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const log = (m: string) => console.log(m)
  const wiki = new WikiClient(path.join(ROOT, '.cache/wiki'))
  const espn = new EspnClient({
    cacheDir: path.join(ROOT, '.cache/espn'),
    refresh: args.refreshEspn,
  })
  const existing = await readExisting()
  const draftTeams = existing.draftTeams
  if (!draftTeams.length) throw new Error('content/draft_teams.csv is missing or empty')
  const manualIds = new Map(
    existing.selections
      .filter((s) => s.espn_id)
      .map((s) => [`${s.season}:${s.wiki_title}`, s.espn_id]),
  )
  const prevPlayers = new Map(existing.players.map((p) => [p.espn_id, p]))

  // 1. Rosters
  const selections: SelectionRow[] = []
  for (let season = args.first; season <= args.through; season++) {
    let found = false
    for (const title of proBowlTitles(season)) {
      const text = await wiki.wikitext(title)
      if (!text) continue
      const roster = parseProBowlRoster(text)
      if (!roster.length) continue
      for (const r of roster)
        selections.push({
          season,
          pos: r.pos,
          wiki_title: r.wikiTitle,
          name: r.name,
          team: r.team,
          espn_id: manualIds.get(`${season}:${r.wikiTitle}`) ?? '',
          note: '',
        })
      log(`${season}: ${roster.length} skill players (${title})`)
      found = true
      break
    }
    if (!found) log(`${season}: no Pro Bowl page found`)
  }

  // 2. Resolve names → ESPN ids
  const factsCache = new Map<string, EspnAthleteFacts | null>()
  const facts = async (id: string) => {
    if (!factsCache.has(id)) factsCache.set(id, await espn.athleteFacts(id))
    return factsCache.get(id)!
  }
  const resolved = new Map<string, string>() // wiki_title → espn_id
  for (const s of selections) {
    if (s.espn_id) {
      resolved.set(s.wiki_title, s.espn_id)
      continue
    }
    if (resolved.has(s.wiki_title)) {
      s.espn_id = resolved.get(s.wiki_title)!
      continue
    }
    const query = normalizeName(ALIASES[s.name] ?? s.name)
    const candidates = await espn.searchPlayers(query)
    const verified: { id: string; exact: boolean }[] = []
    for (const c of candidates.slice(0, 8)) {
      const f = await facts(c.id)
      if (!f) continue
      // ESPN drops the position on some retired records ("-"); then the name and career span must carry it.
      const posKnown = !!f.position && f.position !== '-'
      if (posKnown && !POS_OK[s.pos].includes(f.position!)) continue
      if (f.debutYear && f.debutYear > s.season + 1) continue
      const exact = nameKey(f.displayName) === nameKey(query)
      if (!posKnown && !exact) continue
      verified.push({ id: c.id, exact })
    }
    const exact = verified.filter((v) => v.exact)
    const pick = exact[0] ?? (verified.length === 1 ? verified[0] : undefined)
    if (pick) {
      s.espn_id = pick.id
      resolved.set(s.wiki_title, pick.id)
      if (!pick.exact)
        s.note = `matched ${candidates.find((c) => c.id === pick.id)?.displayName} by position/career`
    } else {
      s.note = candidates.length
        ? `unresolved: ${candidates.length} ESPN candidates, none verified`
        : 'unresolved: no ESPN search hit'
    }
  }
  const ids = [...new Set(selections.map((s) => s.espn_id).filter(Boolean))]
  log(
    `${selections.length} selections, ${ids.length} distinct players resolved, ${selections.filter((s) => !s.espn_id).length} unresolved`,
  )

  // 3. Facts per player
  const draftPages = new Map<number, DraftRow[]>()
  const draftRows = async (year: number) => {
    if (!draftPages.has(year)) {
      const text = await wiki.wikitext(`${year} NFL draft`)
      draftPages.set(year, text ? parseDraftPage(text) : [])
    }
    return draftPages.get(year)!
  }
  const teamByName = new Map(draftTeams.map((t) => [t.name.toLowerCase(), t]))
  const teamByAbbrYear = (abbr: string, year: number): DraftTeamRow | undefined =>
    draftTeams.find(
      (t) =>
        t.abbr === abbr &&
        (t.first_season === null || t.first_season <= year) &&
        (t.last_season === null || t.last_season >= year),
    ) ?? draftTeams.find((t) => t.abbr === abbr)

  const players: PlayerRow[] = []
  const titleFor = new Map(
    selections.filter((s) => s.espn_id).map((s) => [s.espn_id, s.wiki_title]),
  )
  const posFor = new Map(selections.filter((s) => s.espn_id).map((s) => [s.espn_id, s.pos]))
  for (const id of ids) {
    const f = await facts(id)
    const prev = prevPlayers.get(id)
    const wikiTitle = titleFor.get(id)!
    const info = parseInfobox((await wiki.wikitext(wikiTitle)) ?? '')
    const pos = posFor.get(id)!
    const row: PlayerRow = {
      espn_id: id,
      name: f?.displayName ?? selections.find((s) => s.espn_id === id)!.name,
      pos,
      jersey: f?.jersey ?? info.number,
      jersey_source: f?.jersey ? 'espn' : info.number !== null ? 'wikipedia' : '',
      college_id: f?.college?.id ?? '',
      college_name: f?.college?.name ?? info.college ?? '',
      college_logo: f?.college?.logo ?? '',
      college_source: f?.college ? 'espn' : info.college ? 'wikipedia (no logo)' : '',
      draft_status: 'unknown',
      draft_year: null,
      draft_round: null,
      draft_pick: null,
      draft_team: '',
      draft_team_name: '',
      draft_source: '',
      included: prev?.included ?? true,
      notes: prev?.notes ?? '',
    }
    // Draft: year/round/pick from ESPN or the infobox; team from the draft page (unambiguous name), else ESPN's era abbreviation.
    const year = f?.draft?.year ?? info.draftYear
    if (year) {
      row.draft_status = 'drafted'
      row.draft_year = year
      row.draft_round = f?.draft?.round ?? info.draftRound
      row.draft_pick = f?.draft?.pick ?? info.draftPick
      const key = nameKey(row.name)
      const rows = (await draftRows(year)).filter(
        (d) => !d.undrafted && nameKey(`${d.first} ${d.last}`) === key,
      )
      const hit =
        rows.length === 1
          ? rows[0]
          : rows.find((d) => row.draft_pick !== null && d.pick === row.draft_pick)
      const team = hit ? teamByName.get(hit.team.toLowerCase()) : undefined
      if (team) {
        row.draft_team = team.abbr
        row.draft_team_name = team.name
        row.draft_source = 'wikipedia draft page'
        if (row.draft_pick === null) row.draft_pick = hit!.pick
        if (row.draft_round === null) row.draft_round = hit!.round
      } else if (f?.draft?.teamAbbr) {
        const t = teamByAbbrYear(ESPN_ABBR[f.draft.teamAbbr] ?? f.draft.teamAbbr, year)
        if (t) {
          row.draft_team = t.abbr
          row.draft_team_name = t.name
          row.draft_source = 'espn'
        } else
          row.notes = appendNote(
            row.notes,
            `ESPN draft team ${f.draft.teamAbbr} (${year}) not in draft_teams.csv`,
          )
      } else if (hit) {
        row.notes = appendNote(row.notes, `draft team "${hit.team}" not in draft_teams.csv`)
      } else row.notes = appendNote(row.notes, `drafted ${year} but not found on the draft page`)
      if (!row.draft_team) row.draft_status = 'unknown'
    } else if (info.undraftedYear || (f && !f.draft && info.draftYear === null && info.college)) {
      row.draft_status = 'undrafted'
      row.draft_year = info.undraftedYear
      row.draft_source = info.undraftedYear
        ? 'wikipedia infobox'
        : 'espn+wikipedia (no draft record)'
    }
    players.push(row)
  }
  players.sort((a, b) => a.name.localeCompare(b.name))

  await writeFile(
    path.join(CONTENT, 'probowl_selections.csv'),
    serializeCsv(
      [...SELECTION_HEADER],
      selections.map((s) => SELECTION_HEADER.map((h) => s[h])),
    ),
  )
  await writeFile(
    path.join(CONTENT, 'probowl_players.csv'),
    serializeCsv(
      [...PLAYER_HEADER],
      players.map((p) => PLAYER_HEADER.map((h) => p[h])),
    ),
  )
  const count = (pred: (p: PlayerRow) => boolean) => players.filter(pred).length
  log(
    `wrote ${players.length} players: college ${count((p) => !!p.college_id)}, jersey ${count((p) => p.jersey !== null)}, drafted ${count((p) => p.draft_status === 'drafted')}, undrafted ${count((p) => p.draft_status === 'undrafted')}, draft unknown ${count((p) => p.draft_status === 'unknown')}`,
  )
  const skillMismatch = players.filter((p) => !(SKILL as readonly string[]).includes(p.pos))
  if (skillMismatch.length) log(`warning: ${skillMismatch.length} players outside skill positions`)
}

function appendNote(notes: string, extra: string): string {
  return notes ? `${notes}; ${extra}` : extra
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
