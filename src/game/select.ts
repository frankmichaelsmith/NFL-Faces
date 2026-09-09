/**
 * Roll and face selection. Pure functions over the content bundle.
 *
 * Rules (CLAUDE.md, locked 2026-09-09):
 * - A roll is a uniformly random combo whose answer has not yet been the
 *   correct answer in this streak (repeat protection at roll time).
 * - Two distractors, each slot drawn independently: with probability
 *   `alumniProb` from the combo's alumni (if any remain), otherwise uniformly
 *   from the full distractor pool. Distinct from each other and the answer.
 * - The correct face sits in a uniformly random slot.
 * - The roll is decided here, before anything animates.
 */
import type { Bundle, Combo } from './bundle'
import { sample, shuffle, type Rng } from './rng'

export interface SelectOptions {
  /** Per-slot probability of drawing a distractor from the alumni pool. */
  alumniProb: number
}

export type Slot = 0 | 1 | 2

export interface Round {
  combo: Combo
  /** Person ids in on-screen order. Exactly one equals combo.answer. */
  faces: readonly [string, string, string]
  answerSlot: Slot
  /** How many of the two wrong faces came from the alumni pool (0–2). */
  alumniCount: number
}

/** Combos still available for a streak that has already used `used` answers. */
export function eligibleCombos(bundle: Bundle, used: ReadonlySet<string>): Combo[] {
  return bundle.combos.filter((c) => !used.has(c.answer))
}

/** Uniform over eligible combos; null when the streak has exhausted every answer. */
export function pickCombo(bundle: Bundle, used: ReadonlySet<string>, rng: Rng): Combo | null {
  const pool = eligibleCombos(bundle, used)
  return pool.length ? sample(rng, pool) : null
}

/**
 * Draw one distractor for a combo. `exclude` holds ids already on screen.
 * Alumni first with probability alumniProb, else the whole pool.
 */
export function pickDistractor(
  combo: Combo,
  rng: Rng,
  opts: SelectOptions,
  exclude: ReadonlySet<string>,
): { id: string; alumni: boolean } {
  const pool = combo.distractors.filter((d) => !exclude.has(d))
  if (pool.length === 0) throw new Error(`No distractor left for ${combo.season}:${combo.team}`)
  const alumni = combo.alumni.filter((a) => !exclude.has(a))
  if (alumni.length > 0 && rng() < opts.alumniProb) {
    return { id: sample(rng, alumni), alumni: true }
  }
  const id = sample(rng, pool)
  return { id, alumni: combo.alumni.includes(id) }
}

/** Build a full round for an already-chosen combo. */
export function buildRound(combo: Combo, rng: Rng, opts: SelectOptions): Round {
  if (combo.distractors.length < 2)
    throw new Error(`Combo ${combo.season}:${combo.team} has fewer than two distractors`)
  const exclude = new Set<string>([combo.answer])
  const d1 = pickDistractor(combo, rng, opts, exclude)
  exclude.add(d1.id)
  const d2 = pickDistractor(combo, rng, opts, exclude)
  const faces = shuffle(rng, [combo.answer, d1.id, d2.id]) as [string, string, string]
  return {
    combo,
    faces,
    answerSlot: faces.indexOf(combo.answer) as Slot,
    alumniCount: Number(d1.alumni) + Number(d2.alumni),
  }
}

/** Pick a roll and its faces. Null when no combo is left for this streak. */
export function nextRound(
  bundle: Bundle,
  used: ReadonlySet<string>,
  rng: Rng,
  opts: SelectOptions,
): Round | null {
  const combo = pickCombo(bundle, used, rng)
  return combo ? buildRound(combo, rng, opts) : null
}

/**
 * Replace one wrong face (e.g. its photo failed to load) with another
 * distractor not already on screen. Returns null when the slot holds the
 * answer or the pool is exhausted; the caller should reroll the combo then.
 */
export function replaceFace(round: Round, slot: Slot, rng: Rng, opts: SelectOptions): Round | null {
  if (slot === round.answerSlot) return null
  const exclude = new Set(round.faces)
  exclude.add(round.combo.answer)
  if (round.combo.distractors.every((d) => exclude.has(d))) return null
  const replacement = pickDistractor(round.combo, rng, opts, exclude)
  const faces = [...round.faces] as [string, string, string]
  const wasAlumni = round.combo.alumni.includes(faces[slot])
  faces[slot] = replacement.id
  return {
    ...round,
    faces,
    alumniCount: round.alumniCount - Number(wasAlumni) + Number(replacement.alumni),
  }
}
