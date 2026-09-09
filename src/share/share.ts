/**
 * Share flow (spec §14): native share sheet with the PNG where supported,
 * plain-text share next, clipboard + download as the last resort.
 */
import { renderShareCard, type CardSize } from './card'
import { shareText, type SharePayload } from './text'

export type ShareResult = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'failed'

export interface ShareDeps {
  nav?: Pick<Navigator, 'share' | 'canShare' | 'clipboard'>
  render?: (payload: SharePayload, size: CardSize) => Promise<Blob | null>
  download?: (blob: Blob, filename: string) => void
}

export async function share(payload: SharePayload, deps: ShareDeps = {}): Promise<ShareResult> {
  const nav = deps.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  const render = deps.render ?? renderShareCard
  const download = deps.download ?? downloadBlob
  const text = shareText(payload)
  const filename = `nfl-faces-${payload.streak}.png`

  const png = await render(payload, 'square').catch(() => null)

  // 1. Native share with the image.
  if (nav?.share) {
    const files = png ? [new File([png], filename, { type: 'image/png' })] : []
    const withFiles = files.length > 0 && nav.canShare?.({ files }) === true
    try {
      await nav.share(withFiles ? { text, files } : { text })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
      // fall through to the copy path
    }
  }

  // 2. Clipboard + download.
  const copied = nav?.clipboard
    ? await nav.clipboard.writeText(text).then(
        () => true,
        () => false,
      )
    : false
  if (png) {
    try {
      download(png, filename)
      return copied ? 'copied' : 'downloaded'
    } catch {
      /* ignore */
    }
  }
  return copied ? 'copied' : 'failed'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
