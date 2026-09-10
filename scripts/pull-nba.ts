/**
 * NBA pool (decision 0009, Frank 2026-09-10): per season since 1995 (labelled
 * by the year the season ends), the top scorers by points per game plus the
 * top 5 by rebounds and by assists who are not already in, from ESPN's league
 * leaders (ESPN's own qualifiers apply). Pool size: 50 through 1999, 65 from
 * 2000 on (Frank, 2026-09-10) — the scoring cut moves to hit the size. Facts per player from ESPN (college
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
import { WikiClient, field, nameKey, parseInfobox, parseWikiTitles, plainName } from './lib/wiki'
import { parseRosterNumbers, teamSeasonTitles } from './lib/nba-rosters'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const NBA_BASE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba'
export const NBA_POSITIONS = ['G', 'F', 'C'] as const
/** ESPN display names that roster tables spell differently (nicknames, later legal names). */
const ROSTER_ALIASES: Record<string, string[]> = {
  'Anfernee Hardaway': ['Penny Hardaway'],
  'Larry D. Johnson': ['Larry Johnson'],
  'Tyrone Bogues': ['Muggsy Bogues'],
  'Metta World Peace': ['Ron Artest', 'Metta Sandiford-Artest'],
  'Enes Freedom': ['Enes Kanter'],
  'JR Smith': ['J. R. Smith', 'J.R. Smith'],
  'Isaiah Rider': ['J. R. Rider', 'J.R. Rider', 'Isaiah Rider'],
  'Yao Ming': ['Ming Yao'],
}
/** "j r smith" and "jr smith" are the same key once spaced initials collapse. */
const looseKey = (name: string) => nameKey(name).replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')
/** Pool size per season (end year): 50 through 1999, 65 from 2000 (Frank, 2026-09-10). */
const poolSize = (season: number) => (season >= 2000 ? 65 : 50)
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
  // Curator-pinned titles (content/wiki_titles.csv) beat remembered and searched ones.
  const pinned = parseWikiTitles(await read('wiki_titles.csv'))
  for (const [id, title] of pinned) prevTitle.set(id, title)
  // College programs by every name ESPN gives them (the basketball list: Pacific has no football team).
  const collegeByKey = new Map<string, { id: string; name: string; logo: string | null } | null>()
  for (const t of await espn.colleges('basketball'))
    for (const k of [t.displayName, t.name, t.shortDisplayName, t.abbreviation, t.nickname]) {
      const key = nameKey(k)
      if (!key) continue
      const prev = collegeByKey.get(key)
      if (prev === undefined) collegeByKey.set(key, { id: t.id, name: t.name, logo: t.logo })
      else if (prev && prev.id !== t.id) collegeByKey.set(key, null)
    }
  const resolveCollege = (c: { name: string; link: string | null } | undefined) => {
    if (!c) return null
    const keys = [
      c.link?.replace(/\s+(men's )?basketball$/i, ''),
      c.link?.replace(/\s+(men's )?basketball$/i, '').replace(/\s*\([^)]*\)/, ''),
      c.name,
    ]
    for (const k of keys) {
      const hit = k ? collegeByKey.get(nameKey(k)) : undefined
      if (hit) return hit
    }
    return null
  }
  const collegeOverrides: string[] = []
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
    const leaders = await espn.leagueLeaders(season, 100)
    const ppg = leaders['pointsPerGame'] ?? []
    if (!ppg.length) {
      log(`${season}: no leaders on ESPN`)
      continue
    }
    const target = poolSize(season)
    const chosen = new Map<string, { ppg?: string; rpg?: string; apg?: string; why: string }>()
    for (const l of ppg.slice(0, target - 2 * TOP_OTHER))
      chosen.set(l.athleteId, { ppg: l.display, why: 'ppg' })
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
    // Rebounders or passers who were already top scorers left room: fill it with the next scorers.
    for (const l of ppg) {
      if (chosen.size >= target) break
      if (!chosen.has(l.athleteId)) chosen.set(l.athleteId, { ppg: l.display, why: 'ppg' })
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
      selections.push({
        season,
        pos: (coarsePosition(f.position) || 'F') as SelectionRow['pos'],
        number: null,
        wiki_title: prevTitle.get(id) ?? '',
        name: f.displayName,
        team: '',
        espn_id: id,
        note: `${c.why}${c.ppg ? ` · ${c.ppg} ppg` : ''}${c.rpg ? ` · ${c.rpg} rpg` : ''}${c.apg ? ` · ${c.apg} apg` : ''}`,
      })
    }
    log(`${season}: ${chosen.size} players`)
  }

  // 1c. Jersey numbers for the season, from Wikipedia team-season roster tables (all 30 teams per season).
  const rostersBySeason = new Map<number, Map<string, Set<number>>>()
  const seasonsNeeded = [...new Set(selections.map((s) => s.season))]
  let pagesRead = 0
  for (const season of seasonsNeeded) {
    const byKey = new Map<string, Set<number>>()
    for (const title of teamSeasonTitles(season)) {
      const text = await wiki.wikitext(title)
      if (!text) {
        log(`${season}: no page "${title}"`)
        continue
      }
      pagesRead++
      for (const r of parseRosterNumbers(text))
        (byKey.get(r.key) ?? byKey.set(r.key, new Set()).get(r.key)!).add(r.number)
    }
    rostersBySeason.set(season, byKey)
  }
  let numbered = 0
  const conflicting: string[] = []
  const unlisted: string[] = []
  const byLast: string[] = []
  for (const s of selections) {
    const table = rostersBySeason.get(s.season)
    let found = table?.get(nameKey(s.name))
    if (!found && table) {
      // Aliases, then initials-insensitive keys, then a last name that is unique on that season's rosters.
      for (const alias of ROSTER_ALIASES[s.name] ?? [])
        if ((found = table.get(nameKey(alias)))) break
      if (!found) {
        const want = looseKey(s.name)
        for (const [k, v] of table) if (looseKey(k) === want) found = v
      }
      if (!found) {
        const last = nameKey(s.name).split(' ').pop()!
        const hits = [...table].filter(([k]) => k.split(' ').pop() === last)
        if (hits.length === 1) {
          found = hits[0]![1]
          byLast.push(`${s.season} ${s.name} ← ${hits[0]![0]}`)
        }
      }
    }
    if (!found || found.size === 0) {
      unlisted.push(`${s.season} ${s.name}`)
      continue
    }
    if (found.size > 1) {
      // Two numbers in one season: both are correct answers (Frank, 2026-09-10).
      conflicting.push(`${s.season} ${s.name} (${[...found].join('/')})`)
      s.numbers = [...found]
      s.number = s.numbers[0]!
      numbered++
      continue
    }
    s.number = [...found][0]!
    numbered++
  }
  log(
    `season numbers: ${numbered}/${selections.length} selections from ${pagesRead} team-season pages; ${conflicting.length} wore two numbers; ${unlisted.length} not on any roster table`,
  )
  if (conflicting.length) log(`  two numbers: ${conflicting.join('; ')}`)
  if (byLast.length) log(`  matched by unique last name (check): ${byLast.join('; ')}`)
  if (unlisted.length)
    log(`  not listed: ${unlisted.slice(0, 40).join('; ')}${unlisted.length > 40 ? ' …' : ''}`)

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
      // Birthplace, not nationality (Frank, 2026-09-10: Kyrie Irving reads Australia). ESPN first, then Wikipedia.
      const tries: [string | null, string][] = [
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
        if (
          hit.code !== 'us' &&
          f.citizenship &&
          countries.get(f.citizenship.toLowerCase())?.code !== hit.code
        )
          countryReview.push(`${f.displayName}: born ${raw}, citizenship ${f.citizenship}`)
        break
      }
    }
    // College: Wikipedia's last-listed school wins when ESPN's basketball list knows it (ESPN keeps
    // junior colleges and the odd wrong school; Wikipedia keeps the school the player left for the NBA).
    let college = f.college ?? null
    let collegeSource = college ? 'espn' : info.college ? 'wikipedia (no logo)' : ''
    const wikiCollege = resolveCollege(info.colleges.at(-1))
    if (wikiCollege && (!college || wikiCollege.id !== college.id)) {
      if (college)
        collegeOverrides.push(
          `${f.displayName}: ESPN ${college.name} → Wikipedia ${wikiCollege.name}`,
        )
      college = { id: wikiCollege.id, name: wikiCollege.name, logo: wikiCollege.logo }
      collegeSource = 'wikipedia (ESPN logo)'
    }
    const row: PlayerRow = {
      espn_id: id,
      name: f.displayName,
      pos: (coarsePosition(f.position) || 'F') as PlayerRow['pos'],
      jersey,
      jersey_source: jerseySource,
      college_id: college?.id ?? '',
      college_name: college?.name ?? info.college ?? '',
      college_logo: college?.logo ?? '',
      college_source: collegeSource,
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
      selections.map((s) =>
        SELECTION_HEADER.map((h) => (h === 'number' && s.numbers ? s.numbers.join('/') : s[h])),
      ),
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
  if (collegeOverrides.length)
    log(
      `college from Wikipedia over ESPN (${collegeOverrides.length}):\n  ${collegeOverrides.join('\n  ')}`,
    )
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
