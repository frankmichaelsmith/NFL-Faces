/**
 * Candidate skill players who were NOT Pro Bowlers in a season but led their
 * teams in passing, rushing or receiving (Frank, 2026-09-10: "notable players
 * who aren't in the database"). Data only: ESPN team season leaders, minus
 * the season's Pro Bowl roster. Writes content/candidates.csv for Frank to
 * approve (the `approved` column), nothing else changes.
 *
 *   npm run candidates -- [--first 1995] [--through 2025] [--per-season 30]
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serializeCsv } from './lib/csv'
import { EspnClient, NotFound } from './lib/espn'
import { parseProBowlContent } from './lib/probowl'

const ROOT = path.resolve(import.meta.dirname, '..')
const QUOTA: Record<'QB' | 'RB' | 'WR' | 'TE', number> = { QB: 8, RB: 8, WR: 11, TE: 3 }

interface Line {
  id: string
  team: string
  passYds: number
  passTd: number
  rushYds: number
  rushTd: number
  recYds: number
  recTd: number
}
interface Candidate extends Line {
  season: number
  pos: 'QB' | 'RB' | 'WR' | 'TE'
  name: string
  inPool: boolean
  score: number
}

const CATS: Record<string, keyof Omit<Line, 'id' | 'team'>> = {
  passingYards: 'passYds',
  passingTouchdowns: 'passTd',
  rushingYards: 'rushYds',
  rushingTouchdowns: 'rushTd',
  receivingYards: 'recYds',
  receivingTouchdowns: 'recTd',
}

function args() {
  const a = { first: 1995, through: 2025, perSeason: 30, fillTo: 0 }
  const v = process.argv.slice(2)
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--first') a.first = Number(v[++i])
    else if (v[i] === '--through') a.through = Number(v[++i])
    else if (v[i] === '--per-season') a.perSeason = Number(v[++i])
    // --fill-to N: instead of 30 suggestions, propose exactly enough players (not yet in the
    // pool, extras included) to bring each season to N. Writes content/candidates_fill.csv.
    else if (v[i] === '--fill-to') a.fillTo = Number(v[++i])
  }
  return a
}

async function main() {
  const { first, through, perSeason, fillTo } = args()
  const espn = new EspnClient({ cacheDir: path.join(ROOT, '.cache/espn'), refresh: false })
  const read = (f: string) => readFile(path.join(ROOT, 'content', f), 'utf8')
  const { content, errors } = parseProBowlContent({
    selections: await read('probowl_selections.csv'),
    players: await read('probowl_players.csv'),
    draftTeams: await read('draft_teams.csv'),
  })
  if (errors.length) throw new Error(errors.join('\n'))
  const proBowlers = new Map<number, Set<string>>()
  for (const s of content.selections) {
    if (!s.espn_id) continue
    ;(proBowlers.get(s.season) ?? proBowlers.set(s.season, new Set()).get(s.season)!).add(s.espn_id)
  }
  // Extras already in the pool count too when filling.
  try {
    const extras = parseProBowlContent({
      selections: await read('extra_selections.csv'),
      players: await read('probowl_players.csv'),
      draftTeams: await read('draft_teams.csv'),
    })
    for (const s of extras.content.selections)
      if (s.espn_id)
        (proBowlers.get(s.season) ?? proBowlers.set(s.season, new Set()).get(s.season)!).add(
          s.espn_id,
        )
  } catch {
    /* no extras file */
  }
  const pool = new Set(content.players.map((p) => p.espn_id))
  const teamAbbr = new Map<string, string>()
  const abbr = async (id: string) => {
    if (!teamAbbr.has(id)) teamAbbr.set(id, (await espn.team(id)).abbreviation)
    return teamAbbr.get(id)!
  }

  const out: Candidate[] = []
  for (let season = first; season <= through; season++) {
    let teamRefs: { $ref: string }[]
    try {
      teamRefs = (
        await espn.get<{ items: { $ref: string }[] }>(`/seasons/${season}/teams?limit=40`)
      ).items
    } catch (e) {
      if (e instanceof NotFound) {
        console.log(`${season}: no teams`)
        continue
      }
      throw e
    }
    const lines = new Map<string, Line>()
    for (const ref of teamRefs) {
      const teamId = ref.$ref.split('/teams/')[1]!.split('?')[0]!
      let doc: {
        categories?: { name: string; leaders: { value: number; athlete: { $ref: string } }[] }[]
      }
      try {
        doc = await espn.get(`/seasons/${season}/types/2/teams/${teamId}/leaders`)
      } catch (e) {
        if (e instanceof NotFound) continue
        throw e
      }
      const team = await abbr(teamId)
      for (const cat of doc.categories ?? []) {
        const field = CATS[cat.name]
        if (!field) continue
        for (const l of cat.leaders) {
          const id = l.athlete.$ref.split('/athletes/')[1]!.split('?')[0]!
          const line =
            lines.get(id) ??
            lines
              .set(id, {
                id,
                team,
                passYds: 0,
                passTd: 0,
                rushYds: 0,
                rushTd: 0,
                recYds: 0,
                recTd: 0,
              })
              .get(id)!
          // A player traded mid-season appears for two teams: keep the bigger line's team, add the stats.
          if (l.value > line[field] && field.endsWith('Yds')) line.team = team
          line[field] += l.value
        }
      }
    }
    const pb = proBowlers.get(season) ?? new Set<string>()
    const rest = [...lines.values()].filter((l) => !pb.has(l.id))
    // Only the statistically relevant ones get an ESPN lookup (position + name).
    const byPass = [...rest].sort((a, b) => b.passYds - a.passYds).slice(0, 16)
    const byRush = [...rest].sort((a, b) => b.rushYds - a.rushYds).slice(0, 20)
    const byRec = [...rest].sort((a, b) => b.recYds - a.recYds).slice(0, 34)
    const shortlist = new Map<string, Line>()
    for (const l of [...byPass, ...byRush, ...byRec]) shortlist.set(l.id, l)
    const seasonOut: Candidate[] = []
    for (const l of shortlist.values()) {
      const f = await espn.athleteFacts(l.id)
      if (!f) continue
      let pos = f.position && f.position !== '-' ? f.position : ''
      if (pos === 'FB' || pos === 'HB') pos = pos === 'HB' ? 'RB' : 'FB'
      if (!pos) pos = l.passYds > l.rushYds + l.recYds ? 'QB' : l.recYds > l.rushYds ? 'WR' : 'RB'
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue
      const p = pos as Candidate['pos']
      const score =
        p === 'QB'
          ? l.passYds + 20 * l.passTd
          : p === 'RB'
            ? l.rushYds + l.recYds + 20 * (l.rushTd + l.recTd)
            : l.recYds + 20 * l.recTd
      seasonOut.push({ ...l, season, pos: p, name: f.displayName, inPool: pool.has(l.id), score })
    }
    // Quotas mirror a Pro Bowl roster; anything unfilled goes to the best remaining by score.
    const picked: Candidate[] = []
    const left = [...seasonOut].sort((a, b) => b.score - a.score)
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
      const take = left.filter((c) => c.pos === pos).slice(0, QUOTA[pos])
      picked.push(...take)
    }
    const want = fillTo ? Math.max(0, fillTo - pb.size) : perSeason
    // Filling: scores are not comparable across positions (a passer's yards dwarf a back's),
    // so rank within each position and interleave in roster proportions (QB 8 : RB 8 : WR 11 : TE 3).
    const rankWithin = new Map<Candidate, number>()
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as const)
      left.filter((c) => c.pos === pos).forEach((c, i) => rankWithin.set(c, (i + 1) / QUOTA[pos]))
    const interleaved = [...left].sort((a, b) => rankWithin.get(a)! - rankWithin.get(b)!)
    const chosenList = fillTo
      ? interleaved.slice(0, want)
      : (() => {
          for (const c of left) if (picked.length < perSeason && !picked.includes(c)) picked.push(c)
          picked.sort((a, b) => a.pos.localeCompare(b.pos) || b.score - a.score)
          return picked.slice(0, perSeason)
        })()
    out.push(...chosenList)
    console.log(
      `${season}: ${chosenList.length} candidates (${lines.size} leaders, ${pb.size} already in the pool${fillTo ? `, target ${fillTo}` : ''})`,
    )
  }

  const header = [
    'season',
    'pos',
    'name',
    'espn_id',
    'team',
    'pass_yds',
    'pass_td',
    'rush_yds',
    'rush_td',
    'rec_yds',
    'rec_td',
    'already_in_pool',
    'approved',
  ]
  await writeFile(
    path.join(ROOT, 'content', fillTo ? 'candidates_fill.csv' : 'candidates.csv'),
    serializeCsv(
      header,
      out.map((c) => [
        c.season,
        c.pos,
        c.name,
        c.id,
        c.team,
        c.passYds,
        c.passTd,
        c.rushYds,
        c.rushTd,
        c.recYds,
        c.recTd,
        c.inPool ? 'yes' : '',
        '',
      ]),
    ),
  )
  console.log(
    `wrote ${out.length} candidates to content/${fillTo ? 'candidates_fill.csv' : 'candidates.csv'}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
