/**
 * Pull Pro Bowl Mode content.
 *
 *   npm run pull:probowl -- [--first 1995] [--through <season>] [--refresh-espn]
 *
 * 1. Rosters: every QB/RB/WR/TE on each season's Wikipedia Pro Bowl page
 *    (four page formats; 1996–1998 print no jersey numbers).
 * 2. Resolve each name to an ESPN athlete via search, then via ESPN's full
 *    athlete index when search misses, verified by position and career span.
 *    A curator-set espn_id in probowl_selections.csv always wins.
 * 3. Facts per player: ESPN first (position, jersey, college + logo, draft),
 *    then the player's Wikipedia infobox for jersey/college/draft gaps, then
 *    the NFL draft page for the draft team (era-accurate name → draft_teams.csv).
 *    College: the last school in the Wikipedia infobox wins when it resolves to
 *    an ESPN program (ESPN lists Randall Cunningham at Concordia Irvine, not UNLV);
 *    ESPN supplies the logo either way.
 *    Jersey: the fallback for a season whose roster page prints no number is
 *    only used when the player wore a single number in his career, per the
 *    infobox; a player with several numbers gets no number combo that season.
 *
 * Writes content/probowl_selections.csv and content/probowl_players.csv.
 * Curator columns (espn_id on selections; included/notes on players) survive re-pulls.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serializeCsv } from './lib/csv'
import { EspnClient, type EspnAthleteFacts, type EspnCollegeTeam } from './lib/espn'
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
  type InfoboxFacts,
  parseWikiTitles,
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
  const a: Args = { first: 1995, through: now.getUTCFullYear() - 1, refreshEspn: false }
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
  // Only a curator-set id survives a re-pull: mark it with a note starting "manual".
  const manualIds = new Map(
    existing.selections
      .filter((s) => s.espn_id && /^manual/i.test(s.note))
      .map((s) => [`${s.season}:${s.wiki_title}`, { id: s.espn_id, note: s.note }]),
  )
  const prevPlayers = new Map(existing.players.map((p) => [p.espn_id, p]))
  const pinnedTitles = parseWikiTitles(
    await readFile(path.join(CONTENT, 'wiki_titles.csv'), 'utf8').catch(() => ''),
  )

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
          number: r.number,
          wiki_title: r.wikiTitle,
          name: r.name,
          team: r.team,
          espn_id: manualIds.get(`${season}:${r.wikiTitle}`)?.id ?? '',
          // the curator's note travels with the id, or the next pull would drop both
          note: manualIds.get(`${season}:${r.wikiTitle}`)?.note ?? '',
        })
      log(`${season}: ${roster.length} skill players (${title})`)
      found = true
      break
    }
    if (!found) log(`${season}: no Pro Bowl page found`)
  }

  // 1b. Frank's extras (content/extra_selections.csv): non-Pro-Bowlers added to the pool by
  // hand, already keyed by ESPN id. They stay in their own file (build:content merges them);
  // here they only join the facts pull. Skipped when the player is on that season's roster.
  const extraSelections: SelectionRow[] = []
  try {
    const { content: extras, errors: extraErrors } = parseProBowlContent({
      selections: await readFile(path.join(CONTENT, 'extra_selections.csv'), 'utf8'),
      players: PLAYER_HEADER.join(',') + '\n',
      draftTeams: await readFile(path.join(CONTENT, 'draft_teams.csv'), 'utf8'),
    })
    const fatal = extraErrors.filter((e) => /missing columns|must be/.test(e))
    if (fatal.length) throw new Error(`extra_selections.csv invalid:\n${fatal.join('\n')}`)
    const onRoster = new Set(selections.map((s) => `${s.season}:${s.espn_id}`))
    let added = 0
    for (const x of extras.selections) {
      if (x.season < args.first || x.season > args.through) continue
      if (!x.espn_id || onRoster.has(`${x.season}:${x.espn_id}`)) continue
      extraSelections.push({ ...x })
      onRoster.add(`${x.season}:${x.espn_id}`)
      added++
    }
    log(`extras: ${added} selections from extra_selections.csv join the facts pull`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  // 2. Resolve names → ESPN ids
  const factsCache = new Map<string, EspnAthleteFacts | null>()
  const facts = async (id: string) => {
    if (id.startsWith('wiki:')) return null // no ESPN record; the Wikipedia article carries the row
    if (!factsCache.has(id)) factsCache.set(id, await espn.athleteFacts(id))
    return factsCache.get(id)!
  }
  const infoboxCache = new Map<string, InfoboxFacts>()
  const infobox = async (title: string) => {
    if (!infoboxCache.has(title))
      infoboxCache.set(title, parseInfobox((await wiki.wikitext(title)) ?? ''))
    return infoboxCache.get(title)!
  }
  // College programs by every name ESPN gives them, for matching the infobox's school.
  const collegeByKey = new Map<string, EspnCollegeTeam | null>() // null = ambiguous
  for (const t of await espn.colleges())
    for (const k of [t.displayName, t.name, t.shortDisplayName, t.abbreviation, t.nickname]) {
      const key = nameKey(k)
      if (!key) continue
      const prev = collegeByKey.get(key)
      if (prev === undefined) collegeByKey.set(key, t)
      else if (prev && prev.id !== t.id) collegeByKey.set(key, null)
    }
  const resolveCollege = (c: { name: string; link: string | null } | undefined) => {
    if (!c) return null
    const keys = [
      c.link?.replace(/\s+football$/i, ''),
      c.link?.replace(/\s+football$/i, '').replace(/\s*\([^)]*\)/, ''),
      c.name,
    ]
    for (const k of keys) {
      const hit = k ? collegeByKey.get(nameKey(k)) : undefined
      if (hit) return hit
    }
    return null
  }
  const collegeOverrides: string[] = []
  const multiNumber: string[] = []

  interface Verified {
    id: string
    displayName: string
    /** ESPN's display name equals the page name, suffix included ("Frank Gore" ≠ "Frank Gore Jr."). */
    strict: boolean
    /** Equal once suffixes and punctuation are folded. */
    loose: boolean
    /** Draft/debut year, college, or a jersey number agrees with the player's Wikipedia infobox. */
    corroborated: boolean
    /** College or draft/debut year agrees: enough to separate namesakes who share a number. */
    strong: boolean
  }
  /**
   * Which ESPN record is this Pro Bowler? Position and career span must fit; a
   * record whose college disagrees with Wikipedia is a namesake unless its
   * draft or debut year corroborates it (ESPN's college is wrong for a dozen
   * retired players, so a mismatch alone is not disqualifying).
   */
  const verify = async (
    candidates: { id: string; displayName: string }[],
    s: SelectionRow,
    query: string,
  ): Promise<{ pick?: Verified; note: string }> => {
    const info = await infobox(s.wiki_title)
    const wikiCollege = resolveCollege(info.colleges.at(-1))
    const draftYear = info.draftYear ?? info.undraftedYear
    const plausible: Verified[] = []
    for (const c of candidates) {
      const f = await facts(c.id)
      if (!f) continue
      // ESPN drops the position on some retired records ("-"); then the name and career span must carry it.
      const posKnown = !!f.position && f.position !== '-'
      if (posKnown && !POS_OK[s.pos].includes(f.position!)) continue
      if (f.debutYear && f.debutYear > s.season + 1) continue
      const strict = normalizeName(f.displayName).toLowerCase() === query.toLowerCase()
      const loose = nameKey(f.displayName) === nameKey(query)
      if (!posKnown && !loose) continue
      const sameCollege = !!wikiCollege && !!f.college && wikiCollege.id === f.college.id
      const collegeMismatch = !!wikiCollege && !!f.college && !sameCollege
      const yearFits =
        draftYear !== null &&
        ((f.draft?.year ?? null) === draftYear ||
          (f.debutYear !== null && Math.abs(f.debutYear - draftYear) <= 1))
      // Undrafted players have no draft year to match; a jersey the infobox lists still ties the record to the article.
      const jerseyFits = f.jersey !== null && info.numbers.includes(f.jersey)
      const corroborated = sameCollege || yearFits || jerseyFits
      if (collegeMismatch && !corroborated) continue
      plausible.push({
        id: c.id,
        displayName: f.displayName,
        strict,
        loose,
        corroborated,
        strong: sameCollege || yearFits,
      })
    }
    const ids = (l: Verified[]) => l.map((v) => v.id).join('/')
    const ss = plausible.filter((v) => v.strict && v.strong)
    if (ss.length === 1) return { pick: ss[0], note: '' }
    if (ss.length > 1) return { note: `ambiguous: ESPN ${ids(ss)} all fit` }
    const sc = plausible.filter((v) => v.strict && v.corroborated)
    if (sc.length === 1) return { pick: sc[0], note: '' }
    if (sc.length > 1) return { note: `ambiguous: ESPN ${ids(sc)} share a number with the article` }
    const st = plausible.filter((v) => v.strict)
    if (st.length === 1) return { pick: st[0], note: '' }
    if (st.length > 1) return { note: `ambiguous: ESPN ${ids(st)}, none corroborated by Wikipedia` }
    const lc = plausible.filter((v) => v.loose && v.corroborated)
    const pick = lc.length === 1 ? lc[0] : plausible.length === 1 ? plausible[0] : undefined
    if (pick) return { pick, note: `matched ${pick.displayName} by position/career` }
    return {
      note: candidates.length
        ? `unresolved: ${candidates.length} ESPN candidates, none verified`
        : 'unresolved: no ESPN search hit',
    }
  }
  /** Wikipedia's own position wording for each slot, for the no-ESPN-record fallback. */
  const POS_WORDS: Record<Skill, string[]> = {
    QB: ['quarterback'],
    RB: ['running back', 'halfback', 'tailback'],
    WR: ['wide receiver'],
    TE: ['tight end'],
  }
  const resolved = new Map<string, string>() // wiki_title → espn_id
  const wikiKeyed: string[] = []
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
    const { pick, note } = await verify(await espn.searchPlayers(query), s, query)
    if (pick) {
      s.espn_id = pick.id
      s.note = note
    } else {
      // ESPN has no NFL record at all for a few retired greats (Jerry Rice). The Wikipedia
      // article, when it names the same position, carries the row: college, draft, numbers.
      const info = await infobox(s.wiki_title)
      const pos = info.position?.toLowerCase() ?? ''
      if (POS_WORDS[s.pos].some((w) => pos.includes(w))) {
        s.espn_id = `wiki:${s.wiki_title.replace(/ /g, '_')}`
        s.note = `no ESPN record (${note}); keyed by the Wikipedia article`
        wikiKeyed.push(`${s.season} ${s.name}`)
      } else s.note = note
    }
    if (s.espn_id) resolved.set(s.wiki_title, s.espn_id)
  }
  if (wikiKeyed.length) log(`keyed by Wikipedia (no ESPN record): ${wikiKeyed.join(', ')}`)
  // Fullbacks share the running-back list on some Pro Bowl pages but are not a skill
  // position in this game (Frank, 2026-09-09: John Kuhn was a FB, not a RB). Drop them.
  const fullbacks: string[] = []
  for (let i = selections.length - 1; i >= 0; i--) {
    const s = selections[i]!
    if (!s.espn_id) continue
    const f = await facts(s.espn_id)
    if (f?.position === 'FB') {
      fullbacks.push(`${s.season} ${s.name}`)
      selections.splice(i, 1)
    }
  }
  if (fullbacks.length)
    log(`dropped ${fullbacks.length} fullback selection(s): ${fullbacks.reverse().join(', ')}`)
  const forFacts = [...selections, ...extraSelections]
  const ids = [...new Set(forFacts.map((s) => s.espn_id).filter(Boolean))]
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
    forFacts
      .filter((s) => s.espn_id)
      .map((s) => [s.espn_id, pinnedTitles.get(s.espn_id) ?? s.wiki_title]),
  )
  const posFor = new Map(forFacts.filter((s) => s.espn_id).map((s) => [s.espn_id, s.pos]))
  for (const id of ids) {
    const f = await facts(id)
    const prev = prevPlayers.get(id)
    const wikiTitle = titleFor.get(id)!
    const info = await infobox(wikiTitle)
    const pos = posFor.get(id)!
    const name = f?.displayName ?? forFacts.find((s) => s.espn_id === id)!.name
    // College: Wikipedia's last-listed school wins when ESPN knows the program.
    let college = f?.college ?? null
    let collegeSource = college ? 'espn' : info.college ? 'wikipedia (no logo)' : ''
    const wikiCollege = resolveCollege(info.colleges.at(-1))
    if (wikiCollege && (!college || wikiCollege.id !== college.id)) {
      if (college)
        collegeOverrides.push(`${name}: ESPN ${college.name} → Wikipedia ${wikiCollege.name}`)
      college = { id: wikiCollege.id, name: wikiCollege.name, logo: wikiCollege.logo }
      collegeSource = 'wikipedia (ESPN logo)'
    }
    // Jersey fallback (used only when a roster page prints no number): safe only for a one-number career.
    let jersey: number | null = null
    let jerseySource = ''
    if (info.numbers.length === 1 && (f?.jersey === null || f?.jersey === info.numbers[0])) {
      jersey = info.numbers[0]!
      jerseySource = f?.jersey ? 'espn' : 'wikipedia'
    } else if (info.numbers.length === 0 && f?.jersey) {
      jersey = f.jersey
      jerseySource = 'espn'
    } else if (info.numbers.length > 1) multiNumber.push(`${name} (${info.numbers.join(', ')})`)
    const row: PlayerRow = {
      espn_id: id,
      name,
      pos,
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
      country: '',
      country_name: '',
      country_source: '',
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
  if (collegeOverrides.length)
    log(
      `college from Wikipedia over ESPN (${collegeOverrides.length}):\n  ${collegeOverrides.join('\n  ')}`,
    )
  if (multiNumber.length)
    log(
      `no jersey fallback, several numbers worn (${multiNumber.length}): ${multiNumber.join('; ')}`,
    )
  const unresolved = selections.filter((s) => !s.espn_id)
  if (unresolved.length)
    log(
      `unresolved (${unresolved.length}):\n  ${unresolved.map((s) => `${s.season} ${s.pos} ${s.name} — ${s.note}`).join('\n  ')}`,
    )
}

function appendNote(notes: string, extra: string): string {
  if (notes.split('; ').includes(extra)) return notes
  return notes ? `${notes}; ${extra}` : extra
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
