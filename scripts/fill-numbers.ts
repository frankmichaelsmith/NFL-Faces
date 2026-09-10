/**
 * Fill empty season numbers in the NFL selection files (Frank, 2026-09-10:
 * "double check that we have the correct jersey numbers that correspond to
 * the season"). Sources, in order:
 *   1. ESPN game rosters (2014 →): three games' rosters per team, matched by
 *      athlete id — exact.
 *   2. Wikipedia team-season {{NFL final roster}} rows, matched by name.
 * A player seen with two numbers in one season gets "a/b" (both correct).
 * Only empty `number` cells change; curated numbers stay.
 *
 *   npm run fill:numbers -- [--first 1995] [--through 2025]
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serializeCsv } from './lib/csv'
import { EspnClient, NotFound } from './lib/espn'
import { nflTeamSeasonTitles, parseNflRosterNumbers } from './lib/nfl-rosters'
import { SELECTION_HEADER, parseProBowlContent, type SelectionRow } from './lib/probowl'
import { WikiClient, nameKey } from './lib/wiki'

const ROOT = path.resolve(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const ESPN_FROM = 2014
const WEEKS = [1, 9, 17]

function parseArgs(argv: string[]) {
  const a = { first: 1995, through: 2025 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--first') a.first = Number(argv[++i])
    else if (argv[i] === '--through') a.through = Number(argv[++i])
  }
  return a
}

const looseKey = (name: string) => nameKey(name).replace(/\b([a-z]) (?=[a-z]\b)/g, '$1')

async function main() {
  const { first, through } = parseArgs(process.argv.slice(2))
  const espn = new EspnClient({ cacheDir: path.join(ROOT, '.cache/espn'), refresh: false })
  const wiki = new WikiClient(path.join(ROOT, '.cache/wiki'))
  const read = (f: string) => readFile(path.join(CONTENT, f), 'utf8')
  const draftTeams = await read('draft_teams.csv')
  const players = await read('probowl_players.csv')
  const files: Record<string, SelectionRow[]> = {}
  for (const f of ['probowl_selections.csv', 'extra_selections.csv']) {
    const { content, errors } = parseProBowlContent({
      selections: await read(f),
      players,
      draftTeams,
    })
    const fatal = errors.filter((e) => /missing columns|must be/.test(e))
    if (fatal.length) throw new Error(`${f}:\n${fatal.join('\n')}`)
    files[f] = content.selections
  }
  const all = Object.values(files).flat()
  const todo = all.filter((s) => s.number === null && s.season >= first && s.season <= through)
  console.log(`${todo.length} selections without a season number in ${first}–${through}`)
  const seasons = [...new Set(todo.map((s) => s.season))].sort()

  let filled = 0
  const twoNumbers: string[] = []
  const stillMissing: string[] = []
  for (const season of seasons) {
    const needs = todo.filter((s) => s.season === season)
    // Source 1: ESPN game rosters, by athlete id.
    const byId = new Map<string, Set<number>>()
    if (season >= ESPN_FROM) {
      for (const week of WEEKS) {
        let events: { $ref: string }[] = []
        try {
          events = (
            await espn.get<{ items: { $ref: string }[] }>(
              `/seasons/${season}/types/2/weeks/${week}/events?limit=20`,
            )
          ).items
        } catch (e) {
          if (!(e instanceof NotFound)) throw e
        }
        for (const ev of events) {
          const e = await espn.get<{
            competitions: { competitors: { roster?: { $ref: string } }[] }[]
          }>(ev.$ref)
          for (const c of e.competitions[0]?.competitors ?? []) {
            if (!c.roster) continue
            const r = await espn.get<{
              entries?: { jersey?: string; athlete?: { $ref: string } }[]
            }>(c.roster.$ref)
            for (const en of r.entries ?? []) {
              const id = en.athlete?.$ref.split('/athletes/')[1]?.split('?')[0]
              const n = en.jersey && /^\d+$/.test(en.jersey) ? Number(en.jersey) : null
              if (id && n !== null) (byId.get(id) ?? byId.set(id, new Set()).get(id)!).add(n)
            }
          }
        }
      }
    }
    // Source 2: Wikipedia final rosters, by name. Numbers are kept per page so a name that
    // appears on two teams' rosters reads as namesakes (two Rod Smiths on the 1997 Broncos aside).
    const byName = new Map<string, Map<number, Set<string>>>()
    let pages = 0
    for (const title of nflTeamSeasonTitles(season)) {
      const text = await wiki.wikitext(title)
      if (!text) continue
      const rows = parseNflRosterNumbers(text)
      if (rows.length) pages++
      for (const r of rows) {
        const m = byName.get(r.key) ?? byName.set(r.key, new Map()).get(r.key)!
        ;(m.get(r.number) ?? m.set(r.number, new Set()).get(r.number)!).add(title)
      }
    }
    const namesakes = new Set<string>()
    const fromName = (key: string): Set<number> | undefined => {
      const m = byName.get(key)
      if (!m) return undefined
      if (m.size === 1) return new Set(m.keys())
      // Several numbers: one person with two numbers only if a single page lists them all.
      const pagesSeen = new Set([...m.values()].flatMap((s) => [...s]))
      if (pagesSeen.size === 1) return new Set(m.keys())
      namesakes.add(key)
      return undefined
    }
    let seasonFilled = 0
    for (const s of needs) {
      let found = byId.get(s.espn_id)
      if (!found) {
        found = fromName(nameKey(s.name))
        if (!found && !namesakes.has(nameKey(s.name))) {
          const want = looseKey(s.name)
          for (const k of byName.keys()) if (looseKey(k) === want) found = fromName(k)
        }
      }
      if (!found || !found.size) {
        stillMissing.push(`${s.season} ${s.name}`)
        continue
      }
      const nums = [...found].sort((a, b) => a - b)
      s.number = nums[0]!
      if (nums.length > 1) {
        s.numbers = nums
        twoNumbers.push(`${s.season} ${s.name} (${nums.join('/')})`)
      }
      seasonFilled++
      filled++
    }
    console.log(
      `${season}: ${seasonFilled}/${needs.length} filled (ESPN ids ${byId.size}, Wikipedia roster pages ${pages})${namesakes.size ? `; namesakes skipped: ${[...namesakes].join(', ')}` : ''}`,
    )
  }
  for (const [f, rows] of Object.entries(files))
    await writeFile(
      path.join(CONTENT, f),
      serializeCsv(
        [...SELECTION_HEADER],
        rows.map((s) =>
          SELECTION_HEADER.map((h) => (h === 'number' && s.numbers ? s.numbers.join('/') : s[h])),
        ),
      ),
    )
  console.log(
    `filled ${filled} of ${todo.length}; ${stillMissing.length} still without a season number`,
  )
  if (twoNumbers.length) console.log(`two numbers in a season: ${twoNumbers.join('; ')}`)
  if (stillMissing.length)
    console.log(
      `still missing: ${stillMissing.slice(0, 60).join('; ')}${stillMissing.length > 60 ? ' …' : ''}`,
    )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
