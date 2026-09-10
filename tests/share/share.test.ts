import { describe, expect, it, vi } from 'vitest'
import { cardLayout, renderShareCard } from '../../src/share/card'
import { share } from '../../src/share/share'
import { shareText } from '../../src/share/text'

describe('shareText', () => {
  it('matches the spec format with streak, losing roll and url', () => {
    expect(shareText({ streak: 12, roll: '2005 · BENGALS', url: 'https://nflfaces.app' })).toBe(
      'Spin Streak 🏈 12 in a row. Died on 2005 BENGALS. https://nflfaces.app',
    )
  })
  it('handles a streak of one and a missing roll', () => {
    expect(shareText({ streak: 1, roll: null, url: 'u' })).toBe('Spin Streak 🏈 1 in a row. u')
  })
})

describe('cardLayout', () => {
  it('fits every element inside both card sizes', () => {
    for (const size of ['square', 'wide'] as const) {
      const L = cardLayout(size)
      for (const el of [L.title, L.streak, L.label, L.roll, L.url]) {
        expect(el.x).toBeGreaterThanOrEqual(0)
        expect(el.y).toBeLessThanOrEqual(L.height)
        expect(el.y - el.size).toBeGreaterThanOrEqual(-1)
      }
    }
    expect(cardLayout('square')).toMatchObject({ width: 1080, height: 1080 })
    expect(cardLayout('wide')).toMatchObject({ width: 1200, height: 630 })
  })
})

describe('renderShareCard', () => {
  it('resolves null where the canvas 2D context is unavailable (jsdom)', async () => {
    const blob = await renderShareCard({ streak: 3, roll: '2010 · JETS', url: 'u' }, 'square')
    expect(blob).toBeNull()
  })
})

describe('share flow', () => {
  const payload = { streak: 4, roll: '2012 · JETS', url: 'https://x' }
  const png = new Blob(['png'], { type: 'image/png' })

  it('uses the native share sheet with the PNG when files are supported', async () => {
    const shareFn = vi.fn<(d: ShareData) => Promise<void>>(async () => {})
    const nav = { share: shareFn, canShare: vi.fn(() => true), clipboard: undefined }
    const r = await share(payload, { nav: nav as never, render: async () => png })
    expect(r).toBe('shared')
    const arg = shareFn.mock.calls[0]![0]
    expect(arg.text).toContain('4 in a row')
    expect(arg.files![0]!.name).toBe('spin-streak-4.png')
  })

  it('shares text only when files are not shareable', async () => {
    const shareFn = vi.fn<(d: ShareData) => Promise<void>>(async () => {})
    const nav = { share: shareFn, canShare: vi.fn(() => false), clipboard: undefined }
    await share(payload, { nav: nav as never, render: async () => png })
    expect(shareFn.mock.calls[0]![0]).toEqual({ text: shareText(payload) })
  })

  it('reports a cancelled sheet without falling back to the clipboard', async () => {
    const nav = {
      share: vi.fn(async () => {
        throw Object.assign(new Error('x'), { name: 'AbortError' })
      }),
      canShare: () => false,
      clipboard: { writeText: vi.fn(async () => {}) },
    }
    expect(await share(payload, { nav: nav as never, render: async () => null })).toBe('cancelled')
    expect(nav.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('falls back to clipboard + download without native share', async () => {
    const writeText = vi.fn(async () => {})
    const download = vi.fn()
    const r = await share(payload, {
      nav: { clipboard: { writeText } } as never,
      render: async () => png,
      download,
    })
    expect(r).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(shareText(payload))
    expect(download).toHaveBeenCalledWith(png, 'spin-streak-4.png')
  })

  it('reports failure when nothing works', async () => {
    expect(await share(payload, { nav: {} as never, render: async () => null })).toBe('failed')
  })
})
