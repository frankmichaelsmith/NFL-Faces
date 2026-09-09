/** Display helpers for people. Pure; used for placeholder cards until photos land (M5). */

export function initials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z' .-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

/** Stable hue (0–359) from an id so a placeholder always looks the same. */
export function hueFor(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return (h >>> 0) % 360
}
