/**
 * Season-accurate NFL jersey numbers from Wikipedia team-season pages whose
 * {{NFL final roster}} block lists {{NFLplayer|18|Peyton Manning}} rows.
 * Coverage varies by franchise and year (most 1995–2002 and 2010+ pages have
 * it; many 2003–2009 pages do not). Pure parsing here.
 */
import { nameKey } from './wiki'

/** Franchise names by the seasons they were used, for page titles. */
const FRANCHISES: { name: string; from?: number; to?: number }[] = [
  { name: 'Arizona Cardinals' },
  { name: 'Atlanta Falcons' },
  { name: 'Baltimore Ravens', from: 1996 },
  { name: 'Buffalo Bills' },
  { name: 'Carolina Panthers' },
  { name: 'Chicago Bears' },
  { name: 'Cincinnati Bengals' },
  { name: 'Cleveland Browns', to: 1995 },
  { name: 'Cleveland Browns', from: 1999 },
  { name: 'Dallas Cowboys' },
  { name: 'Denver Broncos' },
  { name: 'Detroit Lions' },
  { name: 'Green Bay Packers' },
  { name: 'Houston Oilers', to: 1996 },
  { name: 'Tennessee Oilers', from: 1997, to: 1998 },
  { name: 'Tennessee Titans', from: 1999 },
  { name: 'Houston Texans', from: 2002 },
  { name: 'Indianapolis Colts' },
  { name: 'Jacksonville Jaguars' },
  { name: 'Kansas City Chiefs' },
  { name: 'Las Vegas Raiders', from: 2020 },
  { name: 'Oakland Raiders', to: 2019 },
  { name: 'Los Angeles Chargers', from: 2017 },
  { name: 'San Diego Chargers', to: 2016 },
  { name: 'Los Angeles Rams', from: 2016 },
  { name: 'St. Louis Rams', to: 2015 },
  { name: 'Miami Dolphins' },
  { name: 'Minnesota Vikings' },
  { name: 'New England Patriots' },
  { name: 'New Orleans Saints' },
  { name: 'New York Giants' },
  { name: 'New York Jets' },
  { name: 'Philadelphia Eagles' },
  { name: 'Pittsburgh Steelers' },
  { name: 'San Francisco 49ers' },
  { name: 'Seattle Seahawks' },
  { name: 'Tampa Bay Buccaneers' },
  { name: 'Washington Redskins', to: 2019 },
  { name: 'Washington Football Team', from: 2020, to: 2021 },
  { name: 'Washington Commanders', from: 2022 },
]

export function nflTeamSeasonTitles(season: number): string[] {
  return FRANCHISES.filter(
    (f) => (f.from === undefined || season >= f.from) && (f.to === undefined || season <= f.to),
  ).map((f) => `${season} ${f.name} season`)
}

export interface RosterNumber {
  key: string
  name: string
  number: number
}

/** Every {{NFLplayer|num|Name|…}} row with a number ("&nbsp;7" → 7). */
export function parseNflRosterNumbers(wikitext: string): RosterNumber[] {
  const out: RosterNumber[] = []
  const re = /\{\{\s*NFLplayer\s*\|([^|{}]*)\|([^|{}]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(wikitext))) {
    const num = m[1]!.replace(/&nbsp;|\s/g, '')
    const name = m[2]!.trim()
    if (!/^\d+$/.test(num) || !name) continue
    out.push({ key: nameKey(name), name, number: Number(num) })
  }
  return out
}
