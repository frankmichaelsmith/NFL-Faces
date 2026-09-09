/**
 * Pull the content CSVs from ESPN.
 *
 *   npm run pull:espn -- [--through 2026] [--refresh] [--samples]
 *
 * - Completed seasons: every passer per team from the team-leaders feed
 *   (passing yards, ESPN order). The build ranks them; nothing is decided here.
 * - The live season (regular season not yet ended): the depth chart's QB list,
 *   rank 1 flagged as starter, merged with any leaders rows once games exist.
 * - people.csv is merged: curator columns (included, photo_*, notes) survive re-pulls.
 * - teams.csv is regenerated; active_from = first season the team has any passer row.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GAME_CONFIG } from '../src/game/config'
import { EspnClient, type EspnAthlete } from './lib/espn'
import { serializeCsv } from './lib/csv'
import {
  parseContent,
  PERSON_HEADER,
  STINT_HEADER,
  TEAM_HEADER,
  type PersonRow,
  type StintRow,
} from './lib/content'

/** Franchise labels that differ from ESPN's nickname (Frank, 2026-09-09: Washington reads "Washington"). */
const LABEL_OVERRIDES: Record<string, string> = { WSH: 'Washington' }
const ROLE = GAME_CONFIG.roles[0]!

const ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')

interface Args {
  through: number
  refresh: boolean
  samples: boolean
}

function parseArgs(argv: string[]): Args {
  const now = new Date()
  const defaultThrough = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const args: Args = { through: defaultThrough, refresh: false, samples: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--through') args.through = Number(argv[++i])
    else if (a === '--refresh') args.refresh = true
    else if (a === '--samples') args.samples = true
    else throw new Error(`Unknown argument ${a}`)
  }
  return args
}

async function readExistingPeople(): Promise<Map<string, PersonRow>> {
  try {
    const [teams, people, stints] = await Promise.all(
      ['teams.csv', 'people.csv', 'stints.csv'].map((f) => readFile(path.join(CONTENT, f), 'utf8')),
    )
    const { content } = parseContent({ teams: teams!, people: people!, stints: stints! })
    return new Map(content.people.map((p) => [p.espn_id, p]))
  } catch {
    return new Map()
  }
}

function kebab(a: EspnAthlete): string {
  const clean = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const last = clean(a.lastName || a.displayName.split(' ').slice(-1)[0]!)
  const first = clean(a.firstName || a.displayName.split(' ')[0]!)
  return `${last}-${first}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const log = (m: string) => console.log(m)
  const client = new EspnClient({
    cacheDir: path.join(ROOT, '.cache/espn'),
    refresh: args.refresh,
    log,
  })
  const now = new Date()

  // Seasons and their state.
  const seasons: { season: number; live: boolean }[] = []
  for (let s = GAME_CONFIG.firstSeason; s <= args.through; s++) {
    const end = await client.regularSeasonEnd(s)
    if (!end) {
      log(`season ${s}: not on ESPN, skipped`)
      continue
    }
    seasons.push({ season: s, live: end > now })
  }
  const live = seasons.filter((s) => s.live).map((s) => s.season)
  log(
    `seasons ${seasons[0]?.season}–${seasons.at(-1)?.season}${live.length ? `, live: ${live.join(', ')}` : ''}`,
  )

  // Teams.
  const teams = (await client.teams()).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation))
  log(`${teams.length} teams`)

  // Stints.
  const stints: StintRow[] = []
  await Promise.all(
    teams.flatMap((t) =>
      seasons.map(async ({ season, live }) => {
        const rows = new Map<string, StintRow>()
        for (const p of await client.passers(season, t.id)) {
          rows.set(p.athleteId, {
            season,
            team_id: t.abbreviation,
            espn_id: p.athleteId,
            role: ROLE,
            passing_yards: p.passingYards,
            espn_order: p.order,
            starter: false,
            source: 'leaders',
          })
        }
        if (live) {
          const qbs = await client.depthChartQbs(season, t.id)
          for (const q of qbs) {
            const existing = rows.get(q.athleteId)
            if (existing) existing.starter = q.rank === 1
            else
              rows.set(q.athleteId, {
                season,
                team_id: t.abbreviation,
                espn_id: q.athleteId,
                role: ROLE,
                passing_yards: null,
                espn_order: 100 + q.rank,
                starter: q.rank === 1,
                source: 'depthchart',
              })
          }
          if (!qbs.length) log(`warning: no depth chart QBs for ${t.abbreviation} ${season}`)
        }
        stints.push(...rows.values())
      }),
    ),
  )
  stints.sort(
    (a, b) =>
      a.season - b.season || a.team_id.localeCompare(b.team_id) || a.espn_order - b.espn_order,
  )
  log(`${stints.length} stints`)

  // People (merge with curator columns).
  const existing = await readExistingPeople()
  const ids = [...new Set(stints.map((s) => s.espn_id))].sort((a, b) => Number(a) - Number(b))
  const athletes = new Map<string, EspnAthlete>()
  await Promise.all(ids.map(async (id) => athletes.set(id, await client.athlete(id))))
  const usedPersonIds = new Set<string>()
  const people: PersonRow[] = ids.map((id) => {
    const a = athletes.get(id)!
    const prev = existing.get(id)
    let personId = prev?.person_id ?? kebab(a)
    if (usedPersonIds.has(personId)) personId = `${personId}-${id}`
    usedPersonIds.add(personId)
    return {
      espn_id: id,
      person_id: personId,
      display_name: a.displayName,
      included: prev?.included ?? true,
      espn_headshot: a.headshotUrl !== null,
      photo_source: prev?.photo_source ?? '',
      photo_license: prev?.photo_license ?? '',
      photo_crop: prev?.photo_crop ?? '',
      photo_approved: prev?.photo_approved ?? false,
      notes: prev?.notes ?? '',
    }
  })
  const withHeadshot = people.filter((p) => p.espn_headshot).length
  log(`${people.length} people, ${withHeadshot} with an ESPN headshot`)

  // Teams CSV: active_from derived from data.
  const firstSeasonByTeam = new Map<string, number>()
  for (const s of stints)
    firstSeasonByTeam.set(
      s.team_id,
      Math.min(firstSeasonByTeam.get(s.team_id) ?? Infinity, s.season),
    )
  const teamRows = teams.map((t) => [
    t.abbreviation,
    t.id,
    LABEL_OVERRIDES[t.abbreviation] ?? t.nickname,
    t.location,
    firstSeasonByTeam.get(t.abbreviation) ?? GAME_CONFIG.firstSeason,
  ])

  await mkdir(CONTENT, { recursive: true })
  await writeFile(path.join(CONTENT, 'teams.csv'), serializeCsv([...TEAM_HEADER], teamRows))
  await writeFile(
    path.join(CONTENT, 'people.csv'),
    serializeCsv(
      [...PERSON_HEADER],
      people.map((p) => PERSON_HEADER.map((h) => p[h])),
    ),
  )
  await writeFile(
    path.join(CONTENT, 'stints.csv'),
    serializeCsv(
      [...STINT_HEADER],
      stints.map((s) => STINT_HEADER.map((h) => s[h])),
    ),
  )
  log(`wrote content/teams.csv, people.csv, stints.csv`)

  if (args.samples) {
    const dir = path.join(ROOT, 'samples')
    await mkdir(dir, { recursive: true })
    const pit = teams.find((t) => t.abbreviation === 'PIT')!
    const liveSeason = live[0] ?? seasons.at(-1)!.season
    const samples: Record<string, string> = {
      espn_team: `/teams/${pit.id}`,
      espn_season_type: `/seasons/${liveSeason}/types/2`,
      espn_leaders: `/seasons/2010/types/2/teams/${pit.id}/leaders`,
      espn_athlete: '/athletes/5536',
      espn_athlete_no_headshot: '/athletes/22',
      espn_depthchart: `/seasons/${liveSeason}/teams/${pit.id}/depthcharts`,
    }
    for (const [name, p] of Object.entries(samples))
      await writeFile(path.join(dir, `${name}.json`), JSON.stringify(await client.get(p), null, 2))
    log(`wrote ${Object.keys(samples).length} samples`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
