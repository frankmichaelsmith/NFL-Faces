import { describe, expect, it } from 'vitest'
import { createAnalytics, memoryBackend, noopBackend } from '../../src/analytics/analytics'

describe('analytics layer', () => {
  it('forwards identify and typed events to the backend', () => {
    const { backend, calls, ids } = memoryBackend()
    const a = createAnalytics(backend)
    a.identify('device-1')
    a.track('streak_ended', { streak_length: 3, end_reason: 'wrong', is_new_best: true })
    expect(ids).toEqual(['device-1'])
    expect(calls).toEqual([
      { name: 'streak_ended', props: { streak_length: 3, end_reason: 'wrong', is_new_best: true } },
    ])
  })
  it('never throws when a backend fails', () => {
    const a = createAnalytics({
      identify() {
        throw new Error('boom')
      },
      capture() {
        throw new Error('boom')
      },
    })
    expect(() => a.identify('x')).not.toThrow()
    expect(() => a.track('session_started', { build_hash: 'h' })).not.toThrow()
  })
  it('the no-op backend is silent', () => {
    expect(() => createAnalytics(noopBackend).track('mute_toggled', { muted: true })).not.toThrow()
  })
})
