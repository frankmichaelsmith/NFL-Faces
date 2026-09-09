/**
 * Pure helpers for the reel strip. The reel shows a vertical strip of every
 * value on the wheel, repeated for a few cycles, and animates to the target.
 */

export const ITEM_HEIGHT_PX = 64
/** Rows visible in the reel window: the landed value plus one neighbour above and below. */
export const VISIBLE_ROWS = 3
export const VIEWPORT_HEIGHT_PX = ITEM_HEIGHT_PX * VISIBLE_ROWS

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
  const centerOffset = Math.floor(VISIBLE_ROWS / 2)
  return { items, landIndex, finalY: -(landIndex - centerOffset) * ITEM_HEIGHT_PX }
}

/** How many full cycles a spin of `durationMs` should cover. */
export function cyclesFor(durationMs: number, valueCount: number): number {
  // Roughly one full pass per 600 ms, never fewer than one, capped so the DOM stays small.
  const passes = Math.max(1, Math.round(durationMs / 600))
  return Math.min(passes, Math.max(1, Math.floor(160 / valueCount)))
}
