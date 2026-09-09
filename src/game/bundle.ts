/**
 * The content bundle the client loads once (public/data/bundle.json).
 * Produced by `npm run build:content`; consumed by src/game. Nothing here
 * references a raw ESPN field.
 */

export interface BundleTeam {
  id: string
  label: string
}

export interface BundlePerson {
  /** Display name, shown on the reveal after a miss. */
  name: string
  /** Filename under the image base URL, or null when no approved photo exists yet. */
  photo: string | null
}

export interface Combo {
  season: number
  team: string
  role: string
  /** The single correct person id. */
  answer: string
  /** Everyone eligible as a wrong face for this combo (already excludes the answer). */
  distractors: string[]
  /** Subset of `distractors` who were the answer for this team in another season. */
  alumni: string[]
}

// ---- Pro Bowl Mode -------------------------------------------------------------------

export type ProBowlCategory = 'alma' | 'draft' | 'number' | 'position'

export interface ProBowlPlayer {
  name: string
  pos: 'QB' | 'RB' | 'WR' | 'TE'
  /** Most recent number worn (informational; the season number lives in ProBowlSection.numbers). */
  jersey: number | null
  /** College id (key into ProBowlSection.colleges), or null. */
  college: string | null
  /** Draft team key (into ProBowlSection.teams), 'UDFA' for undrafted, or null when unknown. */
  draft: string | null
}

export interface ProBowlCombo {
  season: number
  /** Player id. */
  player: string
  category: ProBowlCategory
  /** The correct value: college id, team key or 'UDFA', jersey as a string, or position. */
  answer: string
  /** Wrong values eligible for this combo. */
  distractors: string[]
}

export interface ProBowlSection {
  seasons: number[]
  /** Player ids named to the Pro Bowl in each season (the name reel). */
  rosters: Record<string, string[]>
  /** Number worn in that season, by season then player id. The "Pro Number" truth. */
  numbers: Record<string, Record<string, number>>
  players: Record<string, ProBowlPlayer>
  colleges: Record<string, { name: string; logo: string | null }>
  /** Draft-team tiles: label printed on the tile plus its colours. */
  teams: Record<string, { label: string; name: string; color: string; alt: string }>
  combos: ProBowlCombo[]
}

export interface Bundle {
  buildHash: string
  generatedAt: string
  firstSeason: number
  lastSeason: number
  /** The in-progress season whose answers come from the live depth chart, or null. */
  liveSeason: number | null
  roles: string[]
  teams: BundleTeam[]
  people: Record<string, BundlePerson>
  combos: Combo[]
  /** Present once Pro Bowl content has been built. */
  probowl?: ProBowlSection
}
