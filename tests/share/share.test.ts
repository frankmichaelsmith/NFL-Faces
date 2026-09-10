import { describe, expect, it, vi } from 'vitest'
import { share } from '../../src/share/share'
import { shareText } from '../../src/share/text'

describe('shareText', () => {
  it('prints the trophy line, one ❌ line per wheel, and the bare address', () => {
    expect(
      shareText({
        streak: 16,
        roll: '2019 · Jack Doyle · Jersey Number',
        url: 'https://www.spinstreak.app/',
      }),
    ).toBe('🏆 16 CORRECT\n❌ LOST ON 2019\n❌ JACK DOYLE\n❌ JERSEY NUMBER\nwww.spinstreak.app')
  })
  it('handles a two-wheel roll, a zero streak, and no roll at all', () => {
    expect(shareText({ streak: 0, roll: '2005 · BENGALS', url: 'https://spinstreak.app' })).toBe(
      '🏆 0 CORRECT\n❌ LOST ON 2005\n❌ BENGALS\nspinstreak.app',
    )
    expect(shareText({ streak: 367, roll: null, url: 'www.spinstreak.app' })).toBe(
      '🏆 367 CORRECT\nwww.spinstreak.app',
    )
  })
})

const payload = { streak: 4, roll: '2010 · JETS', url: 'https://www.spinstreak.app' }

describe('share', () => {
  it('uses the native share sheet with text only', async () => {
    const nav = {
      share: vi.fn(async (_data: ShareData) => {}),
      clipboard: { writeText: vi.fn(async () => {}) },
    }
    expect(await share(payload, { nav: nav as unknown as Navigator })).toBe('shared')
    expect(nav.share).toHaveBeenCalledWith({
      text: '🏆 4 CORRECT\n❌ LOST ON 2010\n❌ JETS\nwww.spinstreak.app',
    })
    expect(nav.share.mock.calls[0]![0]).not.toHaveProperty('files')
    expect(nav.clipboard.writeText).not.toHaveBeenCalled()
  })
  it('reports a dismissed share sheet as cancelled, not failed', async () => {
    const nav = {
      share: vi.fn(async () => {
        throw Object.assign(new Error('x'), { name: 'AbortError' })
      }),
    }
    expect(await share(payload, { nav: nav as unknown as Navigator })).toBe('cancelled')
  })
  it('falls back to the clipboard when there is no share sheet or it refuses', async () => {
    const writeText = vi.fn(async () => {})
    expect(
      await share(payload, { nav: { clipboard: { writeText } } as unknown as Navigator }),
    ).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(
      '🏆 4 CORRECT\n❌ LOST ON 2010\n❌ JETS\nwww.spinstreak.app',
    )
    const refusing = {
      share: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }),
      clipboard: { writeText },
    }
    expect(await share(payload, { nav: refusing as unknown as Navigator })).toBe('copied')
  })
  it('fails quietly when nothing is available', async () => {
    expect(await share(payload, { nav: {} as Navigator })).toBe('failed')
    const blocked = {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    }
    expect(await share(payload, { nav: blocked as unknown as Navigator })).toBe('failed')
  })
})
