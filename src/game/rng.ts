/**
 * Randomness for the game core. Everything that draws a random number takes an
 * `Rng` so tests and the simulation can be seeded and reproduced.
 */

/** Returns a float in [0, 1), like Math.random. */
export type Rng = () => number

/** Small, fast, seedable PRNG (mulberry32). Good enough for game selection. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const defaultRng: Rng = () => Math.random()

/** Integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n)
}

/** Uniform pick from a non-empty array. */
export function sample<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('sample() from an empty array')
  return items[randomInt(rng, items.length)]!
}

/**
 * Pick with probability proportional to `weightOf(item)` (negatives count as 0).
 * If every weight is 0 the pick is uniform, so a fully down-weighted pool still rolls.
 */
export function weightedSample<T>(rng: Rng, items: readonly T[], weightOf: (t: T) => number): T {
  if (items.length === 0) throw new Error('weightedSample() from an empty array')
  let total = 0
  const w = items.map((t) => {
    const x = Math.max(0, weightOf(t))
    total += x
    return x
  })
  if (total <= 0) return sample(rng, items)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= w[i]!
    if (r < 0) return items[i]!
  }
  return items[items.length - 1]!
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
