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
const TEXT = '🏆 4 CORRECT\n❌ LOST ON 2010\n❌ JETS\nwww.spinstreak.app'

describe('share', () => {
  it('copies the text to the clipboard and never opens a share sheet', async () => {
    const writeText = vi.fn(async () => {})
    const nav = { share: vi.fn(), clipboard: { writeText } }
    expect(await share(payload, { nav: nav as unknown as Navigator })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(TEXT)
    expect(nav.share).not.toHaveBeenCalled()
  })
  it('falls back to the legacy copy when the async clipboard is missing or blocked', async () => {
    const legacyCopy = vi.fn(() => true)
    expect(await share(payload, { nav: {} as Navigator, legacyCopy })).toBe('copied')
    expect(legacyCopy).toHaveBeenCalledWith(TEXT)
    const blocked = {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    }
    expect(await share(payload, { nav: blocked as unknown as Navigator, legacyCopy })).toBe(
      'copied',
    )
  })
  it('fails quietly when nothing can copy', async () => {
    expect(await share(payload, { nav: {} as Navigator, legacyCopy: () => false })).toBe('failed')
  })
})
