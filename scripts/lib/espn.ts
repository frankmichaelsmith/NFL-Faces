/**
 * Thin ESPN core-API client for the pull script.
 *
 * Only this file knows ESPN URLs and raw shapes. Everything downstream works on
 * the normalized records returned here. Responses are cached on disk under
 * .cache/espn (gitignored) so re-pulls are fast and reproducible.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const BASE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl'
const UA = 'nfl-faces-pull/0.1 (+https://github.com/frankmichaelsmith/nfl-faces)'

export interface EspnClientOptions {
  cacheDir: string
  /** League root; defaults to the NFL. NBA: https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba */
  base?: string
  /** Max in-flight requests. ESPN is tolerant but not infinite. */
  concurrency?: number
  /** Bypass the cache (still writes it). */
  refresh?: boolean
  log?: (msg: string) => void
}

export class NotFound extends Error {}

/** Extract the numeric id at the end of an ESPN `$ref` URL. */
export function idFromRef(ref: string): string {
  const last = ref.split('?')[0]!.split('/').pop()
  if (!last || !/^\d+$/.test(last)) throw new Error(`Cannot parse id from ref: ${ref}`)
  return last
}

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
    ' ',
  ),
)

export class EspnClient {
  private readonly opts: Required<EspnClientOptions>
  private inflight = 0
  private readonly queue: Array<() => void> = []

  constructor(opts: EspnClientOptions) {
    this.opts = { concurrency: 12, refresh: false, log: () => {}, base: BASE, ...opts }
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inflight >= this.opts.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.inflight++
    try {
      return await fn()
    } finally {
      this.inflight--
      this.queue.shift()?.()
    }
  }

  /** GET a JSON document, with disk cache and retry. Throws NotFound on 404. */
  async get<T = unknown>(pathname: string): Promise<T> {
    const url = pathname.startsWith('http') ? pathname : this.opts.base + pathname
    const key = createHash('sha1').update(url).digest('hex')
    const file = path.join(this.opts.cacheDir, key + '.json')
    if (!this.opts.refresh) {
      try {
        const cached = JSON.parse(await readFile(file, 'utf8')) as { status: number; body: T }
        if (cached.status === 404) throw new NotFound(url)
        return cached.body
      } catch (e) {
        if (e instanceof NotFound) throw e
        // cache miss → fall through
      }
    }
    return this.slot(async () => {
      let lastErr: unknown
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': UA } })
          if (res.status === 404) {
            await this.store(file, { status: 404, body: null })
            throw new NotFound(url)
          }
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
          const body = (await res.json()) as T
          await this.store(file, { status: 200, body })
          return body
        } catch (e) {
          if (e instanceof NotFound) throw e
          lastErr = e
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
        }
      }
      throw lastErr
    })
  }

  private async store(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(value))
  }

  // ---- normalized accessors -------------------------------------------------

  async teams(): Promise<EspnTeam[]> {
    const list = await this.get<{ items: { $ref: string }[] }>('/teams?limit=40')
    return Promise.all(list.items.map((i) => this.team(idFromRef(i.$ref))))
  }

  async team(id: string): Promise<EspnTeam> {
    const t = await this.get<RawTeam>(`/teams/${id}`)
    return { id: t.id, abbreviation: t.abbreviation, nickname: t.name, location: t.location }
  }

  /** Regular-season end date for a season, or null if ESPN has no such season. */
  async regularSeasonEnd(season: number): Promise<Date | null> {
    try {
      const t = await this.get<{ endDate: string }>(`/seasons/${season}/types/2`)
      return new Date(t.endDate)
    } catch (e) {
      if (e instanceof NotFound) return null
      throw e
    }
  }

  /**
   * Every player who threw for the team that regular season, in ESPN's order
   * (descending passing yards). Empty array when the team/season doesn't exist.
   */
  async passers(season: number, teamId: string): Promise<EspnPasser[]> {
    let doc: RawLeaders
    try {
      doc = await this.get<RawLeaders>(`/seasons/${season}/types/2/teams/${teamId}/leaders`)
    } catch (e) {
      if (e instanceof NotFound) return []
      throw e
    }
    const cat = doc.categories?.find((c) => c.name === 'passingYards')
    if (!cat) return []
    return cat.leaders.map((l, i) => ({
      athleteId: idFromRef(l.athlete.$ref),
      passingYards: l.value,
      order: i,
    }))
  }

  /** Ranked QB depth chart for the live season. rank 1 = starter. */
  async depthChartQbs(
    season: number,
    teamId: string,
  ): Promise<{ athleteId: string; rank: number }[]> {
    let doc: RawDepthCharts
    try {
      doc = await this.get<RawDepthCharts>(`/seasons/${season}/teams/${teamId}/depthcharts`)
    } catch (e) {
      if (e instanceof NotFound) return []
      throw e
    }
    for (const item of doc.items ?? []) {
      const qb = item.positions?.qb
      if (qb?.athletes?.length) {
        return qb.athletes
          .map((a) => ({ athleteId: idFromRef(a.athlete.$ref), rank: a.rank }))
          .sort((a, b) => a.rank - b.rank)
      }
    }
    return []
  }

  /** NFL players matching a name via ESPN's site search. Ids only; verify with athleteFacts(). */
  async searchPlayers(name: string): Promise<{ id: string; displayName: string }[]> {
    // 50, not 10: retired stars rank below active players and college namesakes (Ricky Williams, Jerry Rice).
    const url = `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(name)}&limit=50`
    const d = await this.get<{
      results?: { type: string; contents: { uid?: string; displayName: string }[] }[]
    }>(url)
    const players = d.results?.find((r) => r.type === 'player')?.contents ?? []
    return (
      players
        // NFL-tagged players first; retired greats sometimes come back as sport-only ("s:1100") entries.
        .filter((c) => /^s:(20~l:28|1100)~a:\d+$/.test(c.uid ?? ''))
        .map((c) => ({ id: c.uid!.split('a:')[1]!, displayName: c.displayName }))
    )
  }

  /** Everything Pro Bowl Mode needs from an athlete: position, jersey, college, draft, career span. */
  /** League-wide season leaders: category name → athletes best first (ESPN's qualifiers apply). */
  async leagueLeaders(
    season: number,
    limit = 60,
  ): Promise<Record<string, { athleteId: string; value: number; display: string }[]>> {
    let doc: {
      categories?: {
        name: string
        leaders: { value: number; displayValue: string; athlete: { $ref: string } }[]
      }[]
    }
    try {
      doc = await this.get(`/seasons/${season}/types/2/leaders?limit=${limit}`)
    } catch (e) {
      if (e instanceof NotFound) return {}
      throw e
    }
    const out: Record<string, { athleteId: string; value: number; display: string }[]> = {}
    for (const c of doc.categories ?? [])
      out[c.name] = c.leaders.map((l) => ({
        athleteId: idFromRef(l.athlete.$ref),
        value: l.value,
        display: l.displayValue,
      }))
    return out
  }

  /** Every college football program ESPN knows (id, names, logo), for matching Wikipedia's college names. */
  async colleges(): Promise<EspnCollegeTeam[]> {
    const d = await this.get<{
      sports: { leagues: { teams: { team: RawCollegeTeam }[] }[] }[]
    }>('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000')
    return (d.sports[0]?.leagues[0]?.teams ?? []).map(({ team: t }) => ({
      id: t.id,
      name: t.location,
      displayName: t.displayName,
      shortDisplayName: t.shortDisplayName ?? '',
      abbreviation: t.abbreviation ?? '',
      nickname: t.nickname ?? '',
      logo: t.logos?.[0]?.href ?? null,
    }))
  }
  async athleteFacts(id: string): Promise<EspnAthleteFacts | null> {
    let a: RawAthleteFull
    try {
      a = await this.get<RawAthleteFull>(`/athletes/${id}`)
    } catch (e) {
      if (e instanceof NotFound) return null
      throw e
    }
    const college = a.college ? await this.get<RawCollege>(a.college.$ref).catch(() => null) : null
    const draftTeam = a.draft?.team
      ? await this.get<RawTeam>(a.draft.team.$ref).catch(() => null)
      : null
    return {
      id: a.id,
      displayName: a.displayName,
      position: a.position?.abbreviation ?? null,
      jersey: a.jersey ? Number(a.jersey) : null,
      college: college
        ? { id: college.id, name: college.name, logo: college.logos?.[0]?.href ?? null }
        : null,
      draft: a.draft
        ? {
            year: a.draft.year,
            round: a.draft.round,
            pick: a.draft.selection,
            teamAbbr: draftTeam?.abbreviation ?? null,
            teamName: draftTeam?.displayName ?? null,
          }
        : null,
      debutYear: a.debutYear ?? null,
      active: a.active ?? null,
      // Some US records carry only city and state; a US state code means the USA.
      birthCountry:
        a.birthPlace?.country ??
        (a.birthPlace?.state && US_STATES.has(a.birthPlace.state) ? 'USA' : null),
      citizenship: a.citizenship ?? null,
    }
  }

  async athlete(id: string): Promise<EspnAthlete> {
    const a = await this.get<RawAthlete>(`/athletes/${id}`)
    return {
      id: a.id,
      displayName: a.displayName,
      firstName: a.firstName ?? '',
      lastName: a.lastName ?? '',
      position: a.position?.abbreviation ?? null,
      headshotUrl: a.headshot?.href ?? null,
    }
  }
}

// ---- normalized types --------------------------------------------------------

export interface EspnTeam {
  id: string
  abbreviation: string
  nickname: string
  location: string
}
export interface EspnPasser {
  athleteId: string
  passingYards: number
  order: number
}
export interface EspnAthlete {
  id: string
  displayName: string
  firstName: string
  lastName: string
  position: string | null
  headshotUrl: string | null
}

export interface EspnAthleteFacts {
  id: string
  displayName: string
  position: string | null
  jersey: number | null
  college: { id: string; name: string; logo: string | null } | null
  draft: {
    year: number
    round: number
    pick: number
    teamAbbr: string | null
    /** The team's name in the draft season (era-correct: "Seattle SuperSonics"). */
    teamName: string | null
  } | null
  debutYear: number | null
  active: boolean | null
  /** Country of birth as ESPN spells it ("USA", "West Germany"), or null. */
  birthCountry: string | null
  /** Citizenship when ESPN records one (recent internationals), or null. */
  citizenship: string | null
}

// ---- raw shapes (observed 2026-09-09; samples in /samples) -------------------

interface RawTeam {
  displayName?: string
  id: string
  abbreviation: string
  name: string
  location: string
}
interface RawLeaders {
  categories?: { name: string; leaders: { value: number; athlete: { $ref: string } }[] }[]
}
interface RawDepthCharts {
  items?: {
    name: string
    positions?: Record<string, { athletes?: { rank: number; athlete: { $ref: string } }[] }>
  }[]
}
interface RawAthleteFull extends RawAthlete {
  jersey?: string
  birthPlace?: { city?: string; state?: string; country?: string }
  citizenship?: string
  college?: { $ref: string }
  draft?: { year: number; round: number; selection: number; team?: { $ref: string } }
  debutYear?: number
  active?: boolean
}
export interface EspnCollegeTeam {
  id: string
  /** ESPN's "location", e.g. "NC State", "Miami (OH)". */
  name: string
  displayName: string
  shortDisplayName: string
  abbreviation: string
  nickname: string
  logo: string | null
}
interface RawCollegeTeam {
  id: string
  location: string
  displayName: string
  shortDisplayName?: string
  abbreviation?: string
  nickname?: string
  logos?: { href: string }[]
}
interface RawCollege {
  id: string
  name: string
  logos?: { href: string }[]
}
interface RawAthlete {
  id: string
  displayName: string
  firstName?: string
  lastName?: string
  position?: { abbreviation?: string }
  headshot?: { href?: string }
}
