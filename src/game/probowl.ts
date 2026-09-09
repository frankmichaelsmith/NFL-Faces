/**
 * Pro Bowl Mode selection (decision 0007). Pure functions over the bundle's
 * Pro Bowl section.
 *
 * - A roll picks a category by weight (`categoryWeights`, position rarely),
 *   then a uniformly random combo of that category whose player has not yet
 *   been rolled in this streak (one player per streak, any category).
 * - The two wrong cards are distinct values drawn uniformly from the combo's
 *   distractor pool; the correct card sits in a uniformly random slot.
 * - The roll is decided before anything animates.
 */
import type { ProBowlCategory, ProBowlCombo, ProBowlSection } from './bundle'
import { PROBOWL_CONFIG } from './config'
import { sample, shuffle, type Rng } from './rng'
import type { Slot } from './select'

export interface ProBowlRound {
  kind: 'probowl'
  combo: ProBowlCombo
  /** Values in on-screen order; exactly one equals combo.answer. */
  options: readonly [string, string, string]
  answerSlot: Slot
  /** Repeat-protection key: the player id. */
  usedKey: string
}

export const CATEGORY_LABELS: Record<ProBowlCategory, string> = {
  alma: 'Alma Mater',
  draft: 'Draft Team',
  number: 'Pro Number',
  position: 'Position',
}

export type CategoryWeights = Readonly<Record<string, number>>

/** Static wheel weights (never ramps): position lands on roughly one roll in twenty. */
export const CATEGORY_WEIGHTS: CategoryWeights = PROBOWL_CONFIG.categoryWeights ?? {}

/** Combos still available for a streak that has already rolled `used` players. */
export function eligibleProBowlCombos(
  section: ProBowlSection,
  used: ReadonlySet<string>,
): ProBowlCombo[] {
  return section.combos.filter((c) => !used.has(c.player))
}

export function pickProBowlCombo(
  section: ProBowlSection,
  used: ReadonlySet<string>,
  rng: Rng,
  weights: CategoryWeights = CATEGORY_WEIGHTS,
): ProBowlCombo | null {
  const pool = eligibleProBowlCombos(section, used)
  if (!pool.length) return null
  const byCategory = new Map<ProBowlCategory, ProBowlCombo[]>()
  for (const c of pool) {
    const list = byCategory.get(c.category)
    if (list) list.push(c)
    else byCategory.set(c.category, [c])
  }
  const categories = [...byCategory.keys()]
  const w = categories.map((c) => Math.max(0, weights[c] ?? 1))
  const total = w.reduce((a, b) => a + b, 0)
  // Every remaining category weighs nothing: fall back to a plain uniform roll.
  if (total <= 0) return sample(rng, pool)
  let r = rng() * total
  let chosen = categories[categories.length - 1]!
  for (let i = 0; i < categories.length; i++) {
    r -= w[i]!
    if (r < 0) {
      chosen = categories[i]!
      break
    }
  }
  return sample(rng, byCategory.get(chosen)!)
}

export function buildProBowlRound(combo: ProBowlCombo, rng: Rng): ProBowlRound {
  if (combo.distractors.length < 2)
    throw new Error(
      `Pro Bowl combo ${combo.season}:${combo.player}:${combo.category} has fewer than two distractors`,
    )
  const d1 = sample(rng, combo.distractors)
  const d2 = sample(
    rng,
    combo.distractors.filter((d) => d !== d1),
  )
  const options = shuffle(rng, [combo.answer, d1, d2]) as [string, string, string]
  return {
    kind: 'probowl',
    combo,
    options,
    answerSlot: options.indexOf(combo.answer) as Slot,
    usedKey: combo.player,
  }
}

/** Pick a roll and its cards. Null when every player has been rolled this streak. */
export function nextProBowlRound(
  section: ProBowlSection,
  used: ReadonlySet<string>,
  rng: Rng,
  weights: CategoryWeights = CATEGORY_WEIGHTS,
): ProBowlRound | null {
  const combo = pickProBowlCombo(section, used, rng, weights)
  return combo ? buildProBowlRound(combo, rng) : null
}

/** Human-readable value for a card or a wheel: college name, tile label, number, position. */
export function describeValue(
  section: ProBowlSection,
  category: ProBowlCategory,
  value: string,
): string {
  switch (category) {
    case 'alma':
      return section.colleges[value]?.name ?? value
    case 'draft':
      return value === 'UDFA' ? 'Undrafted' : (section.teams[value]?.name ?? value)
    case 'number':
      return `#${value}`
    case 'position':
      return value
  }
}
