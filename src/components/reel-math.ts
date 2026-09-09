/**
 * Pure helpers for the reel strip. The reel shows a vertical strip of every
 * value on the wheel, repeated for a few cycles, and animates to the target.
 */

export const ITEM_HEIGHT_PX = 80

export interface ReelStrip<T> {
  /** Items rendered top to bottom. */
  items: T[]
  /** Index in `items` of the landing item. */
  landIndex: number
  /** translateY (px) that centers the landing item in the viewport. */
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
  const landIndex = cycles * values.length + targetIdx
  return { items, landIndex, finalY: -landIndex * ITEM_HEIGHT_PX }
}

/** How many full cycles a spin of `durationMs` should cover. */
export function cyclesFor(durationMs: number, valueCount: number): number {
  // Roughly one full pass per 600 ms, never fewer than one, capped so the DOM stays small.
  const passes = Math.max(1, Math.round(durationMs / 600))
  return Math.min(passes, Math.max(1, Math.floor(160 / valueCount)))
}
