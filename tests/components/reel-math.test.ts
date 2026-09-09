import { describe, expect, it } from 'vitest'
import {
  CENTER_TOP_PX,
  cyclesFor,
  drumPose,
  ITEM_HEIGHT_PX,
  reelEase,
  reelStrip,
} from '../../src/components/reel-math'

describe('reelStrip', () => {
  const values = ['A', 'B', 'C', 'D']
  it('repeats the wheel for the requested cycles and ends on the target', () => {
    const s = reelStrip(values, 'C', 2)
    expect(s.items).toEqual(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'])
    expect(s.items[s.landIndex]).toBe('C')
    expect(s.landIndex).toBe(10)
    // the landed item sits in the middle of the two-item window
    expect(s.finalY).toBe(-10 * ITEM_HEIGHT_PX + CENTER_TOP_PX)
    expect(CENTER_TOP_PX).toBe(ITEM_HEIGHT_PX / 2)
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

describe('drum perspective and easing', () => {
  it('leaves the centre row flat and tilts neighbours away symmetrically', () => {
    expect(drumPose(0)).toEqual({ rotateX: -0, opacity: 1, scale: 1 })
    const up = drumPose(-ITEM_HEIGHT_PX)
    const down = drumPose(ITEM_HEIGHT_PX)
    expect(up.rotateX).toBeGreaterThan(0)
    expect(down.rotateX).toBeLessThan(0)
    expect(up.rotateX).toBeCloseTo(-down.rotateX)
    expect(up.opacity).toBeLessThan(1)
    expect(drumPose(1000).rotateX).toBe(-62)
  })
  it('spins down monotonically onto the landing point and never overshoots', () => {
    expect(reelEase(0)).toBe(0)
    expect(reelEase(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = reelEase(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeLessThanOrEqual(1)
      prev = v
    }
    expect(reelEase(0.5)).toBeGreaterThan(0.85) // most of the travel happens early
    expect(reelEase(1.5)).toBe(1)
  })
})
