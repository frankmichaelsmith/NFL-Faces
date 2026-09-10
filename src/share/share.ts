/**
 * Share (Frank, 2026-09-09): copy the text to the clipboard, nothing else.
 * No share sheet, no image. The button reports "Copied" itself.
 */
import { shareText, type SharePayload } from './text'

export type ShareResult = 'copied' | 'failed'

export interface ShareDeps {
  nav?: Pick<Navigator, 'clipboard'>
  /** Last-resort copy for browsers without the async clipboard (hidden textarea + execCommand). */
  legacyCopy?: (text: string) => boolean
}

export async function share(payload: SharePayload, deps: ShareDeps = {}): Promise<ShareResult> {
  const nav = deps.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  const text = shareText(payload)
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text)
      return 'copied'
    } catch {
      /* blocked: try the legacy path */
    }
  }
  return (deps.legacyCopy ?? legacyCopy)(text) ? 'copied' : 'failed'
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
