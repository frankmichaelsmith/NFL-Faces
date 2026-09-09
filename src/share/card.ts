/**
 * Share card rendered client-side to a PNG (spec §14): streak, losing roll,
 * game name, URL. No answer face or name, by decision. Two sizes: 1080×1080
 * for stories, 1200×630 for link previews.
 */
import type { SharePayload } from './text'

export type CardSize = 'square' | 'wide'

export const CARD_DIMENSIONS: Record<CardSize, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  wide: { width: 1200, height: 630 },
}

export interface CardTheme {
  background: string
  accent: string
  text: string
  muted: string
  displayFont: string
  bodyFont: string
}

export const DEFAULT_THEME: CardTheme = {
  background: '#0b1020',
  accent: '#34d399',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.6)',
  displayFont: '"Barlow Condensed", "Arial Narrow", Impact, sans-serif',
  bodyFont: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

/** Layout for one card size, in pixels. Pure so it can be unit-tested without a canvas. */
export function cardLayout(size: CardSize) {
  const { width, height } = CARD_DIMENSIONS[size]
  const pad = Math.round(width * 0.07)
  const wide = size === 'wide'
  return {
    width,
    height,
    pad,
    title: { x: pad, y: pad + (wide ? 44 : 56), size: wide ? 44 : 56 },
    streak: { x: pad, y: wide ? height * 0.62 : height * 0.55, size: wide ? 300 : 420 },
    label: { x: pad, y: wide ? height * 0.62 + 56 : height * 0.55 + 70, size: wide ? 40 : 48 },
    roll: { x: pad, y: wide ? height * 0.62 + 130 : height * 0.55 + 160, size: wide ? 48 : 60 },
    url: { x: pad, y: height - pad, size: wide ? 32 : 36 },
  }
}

/**
 * Draw the card and resolve a PNG Blob. Resolves null where canvas is
 * unavailable (tests, ancient browsers); callers fall back to text.
 */
export async function renderShareCard(
  payload: SharePayload,
  size: CardSize,
  theme: CardTheme = DEFAULT_THEME,
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const L = cardLayout(size)
  canvas.width = L.width
  canvas.height = L.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  try {
    await document.fonts?.load(`900 100px ${theme.displayFont.split(',')[0]}`)
  } catch {
    /* fall back to the system stack */
  }

  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, L.width, L.height)

  // Subtle field-stripe texture.
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.lineWidth = 2
  for (let y = 0; y < L.height; y += 60) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(L.width, y)
    ctx.stroke()
  }

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.text
  ctx.font = `900 ${L.title.size}px ${theme.displayFont}`
  ctx.fillText((payload.gameName ?? 'NFL Faces').toUpperCase(), L.title.x, L.title.y)

  ctx.fillStyle = theme.accent
  ctx.font = `900 ${L.streak.size}px ${theme.displayFont}`
  ctx.fillText(String(payload.streak), L.streak.x - 6, L.streak.y)

  ctx.fillStyle = theme.muted
  ctx.font = `600 ${L.label.size}px ${theme.bodyFont}`
  ctx.fillText(payload.streak === 1 ? 'IN A ROW' : 'IN A ROW', L.label.x, L.label.y)

  if (payload.roll) {
    ctx.fillStyle = theme.text
    ctx.font = `700 ${L.roll.size}px ${theme.displayFont}`
    ctx.fillText(`DIED ON ${payload.roll.toUpperCase()}`, L.roll.x, L.roll.y)
  }

  ctx.fillStyle = theme.muted
  ctx.font = `500 ${L.url.size}px ${theme.bodyFont}`
  ctx.fillText(payload.url.replace(/^https?:\/\//, ''), L.url.x, L.url.y)

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
