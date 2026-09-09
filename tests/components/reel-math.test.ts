import { describe, expect, it } from 'vitest'
import { cyclesFor, ITEM_HEIGHT_PX, reelStrip } from '../../src/components/reel-math'

describe('reelStrip', () => {
  const values = ['A', 'B', 'C', 'D']
  it('repeats the wheel for the requested cycles and ends on the target', () => {
    const s = reelStrip(values, 'C', 2)
    expect(s.items).toEqual(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'])
    expect(s.items[s.landIndex]).toBe('C')
    expect(s.landIndex).toBe(10)
    // the landed item sits in the middle of a three-row window
    expect(s.finalY).toBe(-9 * ITEM_HEIGHT_PX)
    expect(s.items[s.landIndex + 1]).toBe('D')
  })
  it('lands on the first item without a partial tail beyond it', () => {
    const s = reelStrip(values, 'A', 1)
    expect(s.items).toEqual(['A', 'B', 'C', 'D', 'A', 'B'])
    expect(s.landIndex).toBe(4)
  })
  it('rejects a target that is not on the wheel', () => {
    expect(() => reelStrip(values, 'Z', 1)).toThrow(/not on the wheel/)
  })
})

describe('cyclesFor', () => {
  it('spins longer wheels through more passes, capped by DOM size', () => {
    expect(cyclesFor(1000, 27)).toBe(2)
    expect(cyclesFor(2000, 32)).toBe(3)
    expect(cyclesFor(2000, 100)).toBe(1)
    expect(cyclesFor(100, 5)).toBe(1)
  })
})
