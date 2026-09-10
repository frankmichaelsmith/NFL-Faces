/**
 * NBA pool (decision 0009, Frank 2026-09-10): per season since 1995 (labelled
 * by the year the season ends), the top 40 by points per game plus the top 5
 * by rebounds and by assists who are not already in, from ESPN's league
 * leaders (ESPN's own qualifiers apply). Facts per player from ESPN (college
 * + logo, draft with the era-correct team, jersey, country) and the player's
 * Wikipedia infobox (numbers worn, college gaps).
 *
 *   npm run pull:nba -- [--first 1995] [--through 2025] [--refresh-espn]
 *
 * Writes content/nba_selections.csv and content/nba_players.csv, the same
 * columns as the Pro Bowl files plus country/country_name/country_source.
 * Curator columns (espn_id notes starting "manual", country overrides marked
 * "manual" in country_source, included/notes) survive re-pulls.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv, serializeCsv } from './lib/csv'
import { EspnClient, type EspnAthleteFacts } from './lib/espn'
import {
  COUNTRY_COLS,
  PLAYER_HEADER,
  SELECTION_HEADER,
  parseProBowlContent,
  type DraftTeamRow,
  type PlayerRow,
  type SelectionRow,
} from './lib/probowl'
import { WikiClient, field, nameKey, parseInfobox, plainName } from './lib/wiki'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const NBA_BASE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba'
export const NBA_POSITIONS = ['G', 'F', 'C'] as const
const TOP_PPG = 40
const TOP_OTHER = 5

function parseArgs(argv: string[]) {
  const a = { first: 1995, through: 2025, refreshEspn: false }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!
    if (v === '--first') a.first = Number(argv[++i])
    else if (v === '--through') a.through = Number(argv[++i])
    else if (v === '--refresh-espn') a.refreshEspn = true
    else throw new Error(`Unknown argument ${v}`)
  }
  return a
}

/** ESPN's PG/SG/SF/PF/C and G/F → the three the game uses. */
function coarsePosition(p: string | null): (typeof NBA_POSITIONS)[number] | '' {
  if (!p) return ''
  if (['PG', 'SG', 'G'].includes(p)) return 'G'
  if (['SF', 'PF', 'F', 'GF', 'FG'].includes(p)) return 'F'
  if (['C', 'FC', 'CF'].includes(p)) return 'C'
  return ''
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const log = (m: string) => console.log(m)
  const espn = new EspnClient({
    cacheDir: path.join(ROOT, '.cache/espn'),
    refresh: args.refreshEspn,
    base: NBA_BASE,
  })
  const wiki = new WikiClient(path.join(ROOT, '.cache/wiki'))
  const read = async (f: string) => {
    try {
      return await readFile(path.join(CONTENT, f), 'utf8')
    } catch {
      return ''
    }
  }
  const empty = (h: readonly string[]) => h.join(',') + '\n'
  const draftTeamsText = await read('nba_draft_teams.csv')
  if (!draftTeamsText) throw new Error('content/nba_draft_teams.csv is missing')
  const { content: existing, errors } = parseProBowlContent(
    {
      selections: (await read('nba_selections.csv')) || empty(SELECTION_HEADER),
      players: (await read('nba_players.csv')) || empty([...PLAYER_HEADER, ...COUNTRY_COLS]),
      draftTeams: draftTeamsText,
    },
    { positions: NBA_POSITIONS },
  )
  const fatal = errors.filter((e) => /missing columns|must be/.test(e))
  if (fatal.length) throw new Error(`existing content invalid:\n${fatal.join('\n')}`)
  const draftTeams = existing.draftTeams
  const prevPlayers = new Map(existing.players.map((p) => [p.espn_id, p]))
  const prevTitle = new Map(
    existing.selections.filter((s) => s.wiki_title).map((s) => [s.espn_id, s.wiki_title]),
  )
  // Country names as ESPN spells them → flag code + display name (content/nba_countries.csv).
  const countries = new Map<string, { code: string; name: string }>()
  {
    const parsed = parseCsv(await read('nba_countries.csv'))
    const idx = (h: string) => parsed.header.indexOf(h)
    for (const r of parsed.rows)
      countries.set(r[idx('espn_name')]!.toLowerCase(), {
        code: r[idx('code')]!,
        name: r[idx('name')]!,
      })
  }

  // 1. Pool per season from league leaders.
  const factsCache = new Map<string, EspnAthleteFacts | null>()
  const facts = async (id: string) => {
    if (!factsCache.has(id)) factsCache.set(id, await espn.athleteFacts(id))
    return factsCache.get(id)!
  }
  const selections: SelectionRow[] = []
  for (let season = args.first; season <= args.through; season++) {
    const leaders = await espn.leagueLeaders(season, 60)
    const ppg = leaders['pointsPerGame'] ?? []
    if (!ppg.length) {
      log(`${season}: no leaders on ESPN`)
      continue
    }
    const chosen = new Map<string, { ppg?: string; rpg?: string; apg?: string; why: string }>()
    for (const l of ppg.slice(0, TOP_PPG)) chosen.set(l.athleteId, { ppg: l.display, why: 'ppg' })
    for (const [cat, key, label] of [
      ['reboundsPerGame', 'rpg', 'rpg'],
      ['assistsPerGame', 'apg', 'apg'],
    ] as const) {
      let added = 0
      for (const l of leaders[cat] ?? []) {
        if (added >= TOP_OTHER) break
        if (chosen.has(l.athleteId)) continue
        chosen.set(l.athleteId, { [key]: l.display, why: label })
        added++
      }
    }
    // Attach the other averages to every chosen player for the note.
    for (const [cat, key] of [
      ['pointsPerGame', 'ppg'],
      ['reboundsPerGame', 'rpg'],
      ['assistsPerGame', 'apg'],
    ] as const)
      for (const l of leaders[cat] ?? []) {
        const c = chosen.get(l.athleteId)
        if (c && !c[key]) c[key] = l.display
      }
    for (const [id, c] of chosen) {
      const f = await facts(id)
      if (!f) {
        log(`${season}: ESPN athlete ${id} has no record; skipped`)
        continue
      }
      const prevSel = existing.selections.find((s) => s.season === season && s.espn_id === id)
      selections.push({
        season,
        pos: (coarsePosition(f.position) || 'F') as SelectionRow['pos'],
        number: prevSel?.number ?? null,
        wiki_title: prevTitle.get(id) ?? '',
        name: f.displayName,
        team: '',
        espn_id: id,
        note: `${c.why}${c.ppg ? ` · ${c.ppg} ppg` : ''}${c.rpg ? ` · ${c.rpg} rpg` : ''}${c.apg ? ` · ${c.apg} apg` : ''}`,
      })
    }
    log(`${season}: ${chosen.size} players`)
  }

  // 2. Wikipedia article per player (for numbers worn and college gaps), verified against ESPN.
  const ids = [...new Set(selections.map((s) => s.espn_id))]
  const titleFor = new Map<string, string>()
  const unverified: string[] = []
  for (const id of ids) {
    const known = prevTitle.get(id)
    if (known) {
      titleFor.set(id, known)
      continue
    }
    const f = (await facts(id))!
    const titles = await wiki.search(`${f.displayName} basketball`, 8)
    const key = nameKey(f.displayName)
    let picked = ''
    const strong: string[] = []
    const weak: string[] = []
    for (const t of titles) {
      if (nameKey(t.replace(/\s*\(.*\)$/, '')) !== key) continue
      const text = await wiki.wikitext(t)
      if (!text) continue
      const info = parseInfobox(text)
      const year = info.draftYear ?? info.undraftedYear
      const yearFits =
        year !== null &&
        ((f.draft?.year !== undefined && Math.abs(f.draft.year - year) <= 1) ||
          (f.debutYear !== null && Math.abs(f.debutYear - year) <= 1))
      const pickFits =
        f.draft !== null && info.draftPick === f.draft.pick && info.draftYear === f.draft.year
      const collegeFits =
        !!f.college &&
        info.colleges.some(
          (c) =>
            nameKey(c.name) === nameKey(f.college!.name) ||
            nameKey(f.college!.name).includes(nameKey(c.name)),
        )
      const collegeClash = !!f.college && info.colleges.length > 0 && !collegeFits
      if (pickFits || collegeFits) strong.push(t)
      else if (yearFits && !collegeClash) weak.push(t)
    }
    if (strong.length === 1) picked = strong[0]!
    else if (!strong.length && weak.length === 1) picked = weak[0]!
    if (picked) titleFor.set(id, picked)
    else unverified.push(`${f.displayName} (ESPN ${id})`)
  }
  for (const s of selections) s.wiki_title = titleFor.get(s.espn_id) ?? ''

  // 3. Facts per player.
  const teamByName = new Map(draftTeams.map((t) => [t.name.toLowerCase(), t]))
  const teamByAbbrYear = (abbr: string, year: number): DraftTeamRow | undefined =>
    draftTeams.find(
      (t) =>
        t.abbr === abbr &&
        (t.first_season === null || t.first_season <= year) &&
        (t.last_season === null || t.last_season >= year),
    ) ?? draftTeams.find((t) => t.abbr === abbr)
  const players: PlayerRow[] = []
  const countryReview: string[] = []
  const unknownCountry = new Set<string>()
  const multiNumber: string[] = []
  for (const id of ids) {
    const f = (await facts(id))!
    const prev = prevPlayers.get(id)
    const title = titleFor.get(id)
    const info = parseInfobox(title ? ((await wiki.wikitext(title)) ?? '') : '')
    // Jersey: only a one-number career is safe as a fallback (no roster page prints the season number).
    let jersey: number | null = null
    let jerseySource = ''
    if (info.numbers.length === 1 && (f.jersey === null || f.jersey === info.numbers[0])) {
      jersey = info.numbers[0]!
      jerseySource = f.jersey ? 'espn' : 'wikipedia'
    } else if (info.numbers.length === 0 && f.jersey) {
      jersey = f.jersey
      jerseySource = 'espn'
    } else if (info.numbers.length > 1)
      multiNumber.push(`${f.displayName} (${info.numbers.join(', ')})`)
    // Country: a curator's manual value wins; else citizenship; else birth country (flagged for review).
    let country = '',
      countryName = '',
      countrySource = ''
    if (prev && prev.country_source.startsWith('manual')) {
      country = prev.country
      countryName = prev.country_name
      countrySource = prev.country_source
    } else {
      // Order: ESPN citizenship, Wikipedia nationality, ESPN birthplace, Wikipedia birthplace.
      const tries: [string | null, string][] = [
        [f.citizenship, 'espn citizenship'],
        [info.nationality, 'wikipedia nationality'],
        [f.birthCountry, 'espn birthplace'],
        [info.birthCountry, 'wikipedia birthplace'],
      ]
      for (const [raw, source] of tries) {
        if (!raw) continue
        const hit = countries.get(raw.toLowerCase())
        if (!hit) {
          unknownCountry.add(raw)
          continue
        }
        country = hit.code
        countryName = hit.name
        countrySource = source
        if (source.endsWith('birthplace') && hit.code !== 'us')
          countryReview.push(`${f.displayName}: born ${raw}, no citizenship or nationality on file`)
        break
      }
    }
    const row: PlayerRow = {
      espn_id: id,
      name: f.displayName,
      pos: (coarsePosition(f.position) || 'F') as PlayerRow['pos'],
      jersey,
      jersey_source: jerseySource,
      college_id: f.college?.id ?? '',
      college_name: f.college?.name ?? info.college ?? '',
      college_logo: f.college?.logo ?? '',
      college_source: f.college ? 'espn' : info.college ? 'wikipedia (no logo)' : '',
      draft_status: 'unknown',
      draft_year: null,
      draft_round: null,
      draft_pick: null,
      draft_team: '',
      draft_team_name: '',
      draft_source: '',
      country,
      country_name: countryName,
      country_source: countrySource,
      included: prev?.included ?? true,
      notes: prev?.notes ?? '',
    }
    if (f.draft) {
      row.draft_year = f.draft.year
      row.draft_round = f.draft.round
      row.draft_pick = f.draft.pick
      const team =
        (f.draft.teamName && teamByName.get(f.draft.teamName.toLowerCase())) ||
        (f.draft.teamAbbr && teamByAbbrYear(f.draft.teamAbbr, f.draft.year))
      if (team) {
        row.draft_status = 'drafted'
        row.draft_team = team.abbr
        row.draft_team_name = team.name
        row.draft_source = 'espn'
      } else
        row.notes = `${row.notes ? row.notes + '; ' : ''}ESPN draft team ${f.draft.teamName ?? f.draft.teamAbbr} (${f.draft.year}) not in nba_draft_teams.csv`
    } else if (info.draftYear !== null) {
      // ESPN has no draft record but Wikipedia does (older players): year/round/pick and team by name.
      row.draft_year = info.draftYear
      row.draft_round = info.draftRound
      row.draft_pick = info.draftPick
      const teamText = plainName(
        field(title ? ((await wiki.wikitext(title)) ?? '') : '', 'draft_team'),
      )
      const team = teamText ? teamByName.get(teamText.toLowerCase()) : undefined
      if (team) {
        row.draft_status = 'drafted'
        row.draft_team = team.abbr
        row.draft_team_name = team.name
        row.draft_source = 'wikipedia infobox'
      } else if (!teamText && info.draftRound === null && info.draftPick === null) {
        // The basketball infobox marks an undrafted player with a draft year and no team, round or pick.
        row.draft_status = 'undrafted'
        row.draft_source = 'wikipedia infobox'
      } else
        row.notes = `${row.notes ? row.notes + '; ' : ''}Wikipedia draft team "${teamText}" not in nba_draft_teams.csv`
    } else if (info.undraftedYear || (info.draftYear === null && f.debutYear)) {
      row.draft_status = 'undrafted'
      row.draft_year = info.undraftedYear
      row.draft_source = info.undraftedYear ? 'wikipedia infobox' : 'espn (no draft record)'
    }
    players.push(row)
  }
  players.sort((a, b) => a.name.localeCompare(b.name))

  await writeFile(
    path.join(CONTENT, 'nba_selections.csv'),
    serializeCsv(
      [...SELECTION_HEADER],
      selections.map((s) => SELECTION_HEADER.map((h) => s[h])),
    ),
  )
  const header = [...PLAYER_HEADER, ...COUNTRY_COLS] as const
  await writeFile(
    path.join(CONTENT, 'nba_players.csv'),
    serializeCsv(
      [...header],
      players.map((p) => header.map((h) => p[h])),
    ),
  )
  const count = (pred: (p: PlayerRow) => boolean) => players.filter(pred).length
  log(
    `wrote ${selections.length} selections, ${players.length} players: college ${count((p) => !!p.college_id)}, no college ${count((p) => !p.college_id)}, jersey ${count((p) => p.jersey !== null)}, drafted ${count((p) => p.draft_status === 'drafted')}, undrafted ${count((p) => p.draft_status === 'undrafted')}, draft unknown ${count((p) => p.draft_status === 'unknown')}, country ${count((p) => !!p.country)}`,
  )
  if (unverified.length)
    log(`no verified Wikipedia article (${unverified.length}): ${unverified.join('; ')}`)
  if (unknownCountry.size)
    log(`countries not in nba_countries.csv: ${[...unknownCountry].join(', ')}`)
  if (countryReview.length)
    log(
      `country from birthplace only, review (${countryReview.length}):\n  ${countryReview.join('\n  ')}`,
    )
  if (multiNumber.length) log(`no jersey fallback, several numbers worn (${multiNumber.length})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
