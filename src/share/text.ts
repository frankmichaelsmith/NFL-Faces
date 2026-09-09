/** Share copy (spec §14). Pure; no DOM. */

export interface SharePayload {
  streak: number
  /** The losing roll as shown on the wheels, e.g. "2008 · BROWNS". */
  roll: string | null
  url: string
  gameName?: string
}

export function shareText({ streak, roll, url, gameName = 'NFL Faces' }: SharePayload): string {
  const count = streak === 1 ? '1 in a row' : `${streak} in a row`
  const died = roll ? ` Died on ${roll.replace(/\s*·\s*/g, ' ')}.` : ''
  return `${gameName} 🏈 ${count}.${died} ${url}`.trim()
}
