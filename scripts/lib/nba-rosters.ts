/**
 * Season-accurate NBA jersey numbers from Wikipedia team-season pages
 * ("2003–04 Los Angeles Lakers season"), whose roster tables list every
 * player's number that season:
 *
 *   {{player2 | num = 8 | first = Kobe | last = Bryant | pos = G | ... }}
 *
 * Pure parsing here; the pull fetches the pages (one per franchise per season).
 */
import { nameKey } from './wiki'

/** Franchise names by the season (end year) they were used, for page titles. */
const FRANCHISES: { name: string; from?: number; to?: number }[] = [
  { name: 'Atlanta Hawks' },
  { name: 'Boston Celtics' },
  { name: 'Chicago Bulls' },
  { name: 'Cleveland Cavaliers' },
  { name: 'Dallas Mavericks' },
  { name: 'Denver Nuggets' },
  { name: 'Detroit Pistons' },
  { name: 'Golden State Warriors' },
  { name: 'Houston Rockets' },
  { name: 'Indiana Pacers' },
  { name: 'Los Angeles Clippers' },
  { name: 'Los Angeles Lakers' },
  { name: 'Miami Heat' },
  { name: 'Milwaukee Bucks' },
  { name: 'Minnesota Timberwolves' },
  { name: 'New York Knicks' },
  { name: 'Orlando Magic' },
  { name: 'Philadelphia 76ers' },
  { name: 'Phoenix Suns' },
  { name: 'Portland Trail Blazers' },
  { name: 'Sacramento Kings' },
  { name: 'San Antonio Spurs' },
  { name: 'Toronto Raptors', from: 1996 },
  { name: 'Utah Jazz' },
  { name: 'Vancouver Grizzlies', from: 1996, to: 2001 },
  { name: 'Memphis Grizzlies', from: 2002 },
  { name: 'Seattle SuperSonics', to: 2008 },
  { name: 'Oklahoma City Thunder', from: 2009 },
  { name: 'New Jersey Nets', to: 2012 },
  { name: 'Brooklyn Nets', from: 2013 },
  { name: 'Washington Bullets', to: 1997 },
  { name: 'Washington Wizards', from: 1998 },
  { name: 'Charlotte Hornets', to: 2002 },
  { name: 'New Orleans Hornets', from: 2003, to: 2005 },
  { name: 'New Orleans/Oklahoma City Hornets', from: 2006, to: 2007 },
  { name: 'New Orleans Hornets', from: 2008, to: 2013 },
  { name: 'New Orleans Pelicans', from: 2014 },
  { name: 'Charlotte Bobcats', from: 2005, to: 2014 },
  { name: 'Charlotte Hornets', from: 2015 },
]

/** "2004" → "2003–04"; "2000" → "1999–2000" (Wikipedia's convention). */
export function seasonSlug(endYear: number): string {
  const start = endYear - 1
  return endYear % 100 === 0 ? `${start}–${endYear}` : `${start}–${String(endYear).slice(2)}`
}

/** Wikipedia page titles for every franchise active in a season (end year). */
export function teamSeasonTitles(endYear: number): string[] {
  return FRANCHISES.filter(
    (f) => (f.from === undefined || endYear >= f.from) && (f.to === undefined || endYear <= f.to),
  ).map((f) => `${seasonSlug(endYear)} ${f.name} season`)
}

export interface RosterNumber {
  /** nameKey of "first last". */
  key: string
  name: string
  number: number
}

/** Every {{player}} / {{player2}} / {{NBA roster/player}} row with a number. */
export function parseRosterNumbers(wikitext: string): RosterNumber[] {
  const out: RosterNumber[] = []
  const re = /\{\{\s*(?:player2?|NBA roster\/player)\s*\|([^{}]*)\}\}/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(wikitext))) {
    const fields: Record<string, string> = {}
    for (const part of m[1]!.split('|')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim()
    }
    // "45, 23" = two numbers that season (Jordan, 1994–95): one row each, so the pull sees a conflict.
    const nums = (fields['num'] ?? fields['number'] ?? '').match(/\d+/g) ?? []
    const first = fields['first'] ?? ''
    const last = fields['last'] ?? ''
    if (!nums.length || !last) continue
    const name = `${first} ${last}`.trim()
    for (const n of nums) out.push({ key: nameKey(name), name, number: Number(n) })
  }
  return out
}
