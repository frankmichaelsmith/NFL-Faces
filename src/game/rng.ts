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

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
