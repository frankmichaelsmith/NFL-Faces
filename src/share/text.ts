/**
 * Share copy (Frank, 2026-09-09 — replaces the spec §14 card): plain text,
 * one line per wheel of the losing roll, no image.
 *
 *   🏆 16 CORRECT
 *   ❌ LOST ON 2019
 *   ❌ JACK DOYLE
 *   ❌ JERSEY NUMBER
 *   www.spinstreak.app
 *
 * Pure; no DOM.
 */

export interface SharePayload {
  streak: number
  /** The losing roll as shown on the wheels, e.g. "2019 · Jack Doyle · Jersey Number". Null when the pool ran out. */
  roll: string | null
  /** Site URL; printed without the scheme so it reads as an address and still auto-links. */
  url: string
}

export function shareText({ streak, roll, url }: SharePayload): string {
  const lines = [`🏆 ${streak} CORRECT`]
  const parts = roll ? roll.split(/\s*·\s*/).filter(Boolean) : []
  parts.forEach((p, i) => lines.push(`❌ ${i === 0 ? 'LOST ON ' : ''}${p.toUpperCase()}`))
  lines.push(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))
  return lines.join('\n')
}
