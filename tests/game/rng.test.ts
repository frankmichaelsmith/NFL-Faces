import { describe, expect, it } from 'vitest'
import { mulberry32, randomInt, sample, shuffle } from '../../src/game/rng'

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(mulberry32(124)()).not.toBe(mulberry32(123)())
  })
  it('stays in [0, 1) and randomInt covers the range', () => {
    const rng = mulberry32(1)
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      seen.add(randomInt(rng, 5))
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })
  it('sample throws on empty and shuffle preserves members without mutating', () => {
    expect(() => sample(mulberry32(1), [])).toThrow()
    const src = [1, 2, 3, 4, 5]
    const out = shuffle(mulberry32(2), src)
    expect(src).toEqual([1, 2, 3, 4, 5])
    expect([...out].sort()).toEqual(src)
  })
})
