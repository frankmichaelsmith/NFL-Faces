import { describe, expect, it, vi } from 'vitest'
import { createFeedback } from '../../src/audio/feedback'

/** Minimal AudioContext stand-in that records oscillator starts. */
function fakeContext() {
  const starts: number[] = []
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} })
  const node = () => ({ connect: () => node() })
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: async () => {},
    createGain: () => ({ gain: param(), connect: () => node() }),
    createOscillator: () => ({
      type: 'sine',
      frequency: param(),
      connect: () => node(),
      start: (t: number) => starts.push(t),
      stop() {},
    }),
  }
  return { ctx: ctx as unknown as AudioContext, starts }
}

describe('feedback (sound + haptics)', () => {
  it('is silent and still while muted', () => {
    const vibrate = vi.fn()
    const created = vi.fn(() => fakeContext().ctx)
    const f = createFeedback(true, { createContext: created, vibrate })
    f.unlock()
    f.play('tick')
    f.play('miss')
    expect(created).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
    expect(f.muted()).toBe(true)
  })

  it('creates the context on unlock and plays cues with matching haptics when unmuted', () => {
    const { ctx, starts } = fakeContext()
    const vibrate = vi.fn()
    const f = createFeedback(false, { createContext: () => ctx, vibrate })
    f.unlock()
    f.play('tick')
    expect(vibrate).toHaveBeenCalledWith(10)
    f.play('correct')
    expect(vibrate).toHaveBeenCalledTimes(1) // no haptic on correct
    f.play('miss')
    expect(vibrate).toHaveBeenLastCalledWith(150)
    // tick = 1 oscillator, chime = 2, thud = 1
    expect(starts).toHaveLength(4)
  })

  it('toggling mute takes effect immediately', () => {
    const vibrate = vi.fn()
    const f = createFeedback(true, { createContext: () => fakeContext().ctx, vibrate })
    f.setMuted(false)
    f.play('miss')
    expect(vibrate).toHaveBeenCalledTimes(1)
    f.setMuted(true)
    f.play('miss')
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('survives a missing AudioContext and a throwing vibrate', () => {
    const f = createFeedback(false, {
      createContext: () => null,
      vibrate: () => {
        throw new Error('no')
      },
    })
    expect(() => f.play('tick')).not.toThrow()
  })
})
