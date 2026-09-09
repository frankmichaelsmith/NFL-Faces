import { describe, expect, it } from 'vitest'
import { defaultCrop, parseCropSpec, planCrop } from './photos'

describe('planCrop', () => {
  const sil = { width: 600, height: 436, top: 48, headCenterX: 293.5, headWidth: 163 }
  it('squares 1.75 head widths around the head with a little room above', () => {
    const box = planCrop(sil)
    expect(box.width).toBe(box.height)
    expect(box.width).toBe(Math.round(163 * 1.75))
    expect(box.left).toBe(Math.round(293.5 - box.width / 2))
    expect(box.top).toBe(Math.round(48 - box.width * 0.1))
  })
  it('clamps to the image when the head sits near an edge', () => {
    const box = planCrop({ ...sil, headCenterX: 20, top: 2 })
    expect(box.left).toBe(0)
    expect(box.top).toBe(0)
    const big = planCrop({ ...sil, headWidth: 900 })
    expect(big.width).toBe(436)
    expect(big.left + big.width).toBeLessThanOrEqual(600)
  })
})

describe('parseCropSpec', () => {
  it('maps a normalized box to pixels, squared on the shorter side', () => {
    expect(parseCropSpec('0.25,0.1,0.5,0.6', 1000, 800)).toEqual({
      left: 250,
      top: 80,
      width: 480,
      height: 480,
    })
  })
  it('rejects malformed specs', () => {
    expect(() => parseCropSpec('0.1,0.2', 100, 100)).toThrow(/Bad crop spec/)
    expect(() => parseCropSpec('0,0,2,1', 100, 100)).toThrow(/Bad crop spec/)
  })
})

describe('defaultCrop', () => {
  it('is a centered square biased to the top', () => {
    expect(defaultCrop(1000, 1500)).toEqual({ left: 150, top: 120, width: 700, height: 700 })
    const wide = defaultCrop(1600, 900)
    expect(wide.width).toBe(630)
    expect(wide.top + wide.height).toBeLessThanOrEqual(900)
  })
})
