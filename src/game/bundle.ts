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
}
