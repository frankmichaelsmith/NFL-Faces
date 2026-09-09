/**
 * Pure helpers for the reel strip. The reel shows a vertical strip of every
 * value on the wheel, repeated for a few cycles, and animates to the target.
 */

export const ITEM_HEIGHT_PX = 64
/** The window shows the landed value in full plus half of each neighbour, like a slot drum. */
export const VIEWPORT_HEIGHT_PX = ITEM_HEIGHT_PX * 2
/** Where the landed row's top sits inside the window. */
export const CENTER_TOP_PX = (VIEWPORT_HEIGHT_PX - ITEM_HEIGHT_PX) / 2

export interface ReelStrip<T> {
  /** Items rendered top to bottom. */
  items: T[]
  /** Index in `items` of the landing item. */
  landIndex: number
  /** translateY (px) that puts the landing item in the middle row of the window. */
  finalY: number
}

/**
 * Build the strip for one spin. `cycles` full passes precede the landing
 * item, so a longer spin covers more ground and still decelerates onto the
 * target. Throws if the target is not on the wheel.
 */
export function reelStrip<T>(values: readonly T[], target: T, cycles: number): ReelStrip<T> {
  const targetIdx = values.indexOf(target)
  if (targetIdx === -1) throw new Error(`Reel target ${String(target)} is not on the wheel`)
  const items: T[] = []
  for (let c = 0; c < cycles; c++) items.push(...values)
  items.push(...values.slice(0, targetIdx + 1))
  // One more so the row below the landed value is never empty.
  items.push(values[(targetIdx + 1) % values.length]!)
  const landIndex = cycles * values.length + targetIdx
  return { items, landIndex, finalY: -landIndex * ITEM_HEIGHT_PX + CENTER_TOP_PX }
}

/** How many full cycles a spin of `durationMs` should cover. */
export function cyclesFor(durationMs: number, valueCount: number): number {
  // Roughly one full pass per 600 ms, never fewer than one, capped so the DOM stays small.
  const passes = Math.max(1, Math.round(durationMs / 600))
  return Math.min(passes, Math.max(1, Math.floor(160 / valueCount)))
}

/**
 * Drum perspective for a row whose centre is `offsetPx` from the window centre:
 * rows above tilt back and shrink, rows below tilt forward. Returns the
 * rotateX angle in degrees and an opacity.
 */
export function drumPose(offsetPx: number): { rotateX: number; opacity: number; scale: number } {
  const t = Math.max(-1, Math.min(1, offsetPx / (ITEM_HEIGHT_PX * 1.25)))
  return { rotateX: -t * 62, opacity: 1 - Math.abs(t) * 0.55, scale: 1 - Math.abs(t) * 0.12 }
}

/**
 * Spin-down easing: fast at first, then a long deceleration straight onto the
 * landing point. Monotonic and never above 1, so the drum can never overshoot
 * (Frank, 2026-09-09: no bounce-back).
 */
export function reelEase(p: number): number {
  const q = Math.max(0, Math.min(1, p))
  return 1 - Math.pow(1 - q, 4)
}
