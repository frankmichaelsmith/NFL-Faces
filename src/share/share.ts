/**
 * Share flow: the native share sheet with the text (Frank, 2026-09-09: no
 * image), else copy the text to the clipboard.
 */
import { shareText, type SharePayload } from './text'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export interface ShareDeps {
  nav?: Pick<Navigator, 'share' | 'clipboard'>
}

export async function share(payload: SharePayload, deps: ShareDeps = {}): Promise<ShareResult> {
  const nav = deps.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  const text = shareText(payload)

  // 1. Native share sheet (phones).
  if (nav?.share) {
    try {
      await nav.share({ text })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
      // fall through to the clipboard
    }
  }

  // 2. Clipboard (desktop, or a share sheet that refused).
  if (nav?.clipboard) {
    try {
      await nav.clipboard.writeText(text)
      return 'copied'
    } catch {
      /* blocked clipboard */
    }
  }
  return 'failed'
}
