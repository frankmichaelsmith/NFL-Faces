import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { Bundle } from '../src/game/bundle'
import { GAME_CONFIG } from '../src/game/config'
import { mulberry32 } from '../src/game/rng'
import { createAnalytics, memoryBackend } from '../src/analytics/analytics'
import { createFeedback } from '../src/audio/feedback'

const bundle: Bundle = {
  buildHash: 'test',
  generatedAt: '',
  firstSeason: 2010,
  lastSeason: 2011,
  liveSeason: null,
  roles: ['QB'],
  teams: [
    { id: 'PIT', label: 'Steelers' },
    { id: 'NE', label: 'Patriots' },
    { id: 'BAL', label: 'Ravens' },
  ],
  people: {
    ben: { name: 'Ben Roethlisberger', photo: null },
    tom: { name: 'Tom Brady', photo: null },
    joe: { name: 'Joe Flacco', photo: null },
  },
  combos: [
    {
      season: 2010,
      team: 'PIT',
      role: 'QB',
      answer: 'ben',
      distractors: ['tom', 'joe'],
      alumni: [],
    },
    {
      season: 2010,
      team: 'NE',
      role: 'QB',
      answer: 'tom',
      distractors: ['ben', 'joe'],
      alumni: [],
    },
    {
      season: 2010,
      team: 'BAL',
      role: 'QB',
      answer: 'joe',
      distractors: ['ben', 'tom'],
      alumni: [],
    },
  ],
}

// Fast timings so the tests do not wait on real spins.
const config = { ...GAME_CONFIG, spinMsPerWheel: 10, feedbackMs: 10, decisionMs: 5000 }

/** Drive the app from the start screen to a painted round. Returns the answer slot. */
async function startRound() {
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  // spin → landed
  await act(async () => {
    vi.advanceTimersByTime(config.wheels.length * config.spinMsPerWheel + 5)
  })
  // two animation frames → painted
  await act(async () => {
    vi.advanceTimersByTime(40)
  })
  expect(screen.getByTestId('faces')).toBeInTheDocument()
}

function answerSlot(): 0 | 1 | 2 {
  // The wheels show the team; map it back to the combo and find its answer's slot.
  const team = screen.getByTestId('wheel-team').dataset.value!
  const combo = bundle.combos.find(
    (c) => bundle.teams.find((t) => t.id === c.team)!.label.toUpperCase() === team,
  )!
  const buttons = [0, 1, 2].map((i) => screen.getByTestId(`face-${i}`))
  // Placeholder cards show initials; find the card whose initials match the answer.
  const want = bundle.people[combo.answer]!.name.split(' ')
    .map((p) => p[0])
    .join('')
  return buttons.findIndex((b) => b.textContent?.includes(want)) as 0 | 1 | 2
}

describe('App', () => {
  beforeEach(() => {
    // An email is on file and the API is stubbed, so the leaderboard gate stays out of these tests.
    localStorage.setItem(
      'nfl-faces:player:v1',
      JSON.stringify({ playerId: 'p', name: 'Tester', email: 't@x.co', token: 'tok' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ day: '2026-09-09', best: 1, improved: true, rank: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the start screen, then wheels and three face cards after the spin', async () => {
    render(<App bundle={bundle} config={config} rng={mulberry32(1)} />)
    expect(screen.getByRole('heading', { name: 'Spin Streak' })).toBeInTheDocument()
    await startRound()
    expect(screen.getByTestId('wheel-season').dataset.value).toBe('2010')
    expect(['STEELERS', 'PATRIOTS', 'RAVENS']).toContain(
      screen.getByTestId('wheel-team').dataset.value,
    )
    expect(screen.getAllByRole('button', { name: /^Face \d$/ })).toHaveLength(3)
    expect(screen.getByTestId('streak').textContent).toBe('0')
  })

  it('a correct tap bumps the streak and spins again without another tap', async () => {
    render(<App bundle={bundle} config={config} rng={mulberry32(2)} />)
    await startRound()
    const slot = answerSlot()
    fireEvent.pointerDown(screen.getByTestId(`face-${slot}`))
    expect(screen.getByTestId('streak').textContent).toBe('1')
    expect(screen.getByTestId(`face-${slot}`).dataset.look).toBe('correct')
    await act(async () => {
      vi.advanceTimersByTime(config.feedbackMs + 5)
    })
    // a new round is spinning: wheels are unsettled again
    expect(screen.getByTestId('wheel-team').dataset.settled).toBe('false')
    expect(screen.queryByTestId('game-over')).toBeNull()
  })

  it('a wrong tap reveals the correct face with its name and offers a new streak', async () => {
    render(<App bundle={bundle} config={config} rng={mulberry32(3)} />)
    await startRound()
    const slot = answerSlot()
    const wrong = ((slot + 1) % 3) as 0 | 1 | 2
    fireEvent.pointerDown(screen.getByTestId(`face-${wrong}`))
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    expect(screen.getByTestId(`face-${wrong}`).dataset.look).toBe('wrong')
    expect(screen.getByTestId(`face-${slot}`).dataset.look).toBe('correct')
    expect(screen.getByTestId('answer-name')).toBeInTheDocument()
    expect(screen.getByTestId('final-streak').textContent).toBe('0')
    expect(screen.getByTestId('game-over').dataset.roll).toMatch(/^2010 · /)
    // second tap is ignored
    fireEvent.pointerDown(screen.getByTestId(`face-${slot}`))
    expect(screen.getByTestId(`face-${wrong}`).dataset.look).toBe('wrong')
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(screen.queryByTestId('game-over')).toBeNull()
  })

  it('letting the timer run out is a timeout that reveals the answer', async () => {
    render(<App bundle={bundle} config={config} rng={mulberry32(4)} />)
    await startRound()
    await act(async () => {
      vi.advanceTimersByTime(config.decisionMs + 50)
    })
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    // The panel shows only the number (Frank, 2026-09-09); the outcome is announced for screen readers.
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    expect(screen.getByText(/Time ran out/)).toBeInTheDocument()
    expect(screen.getByTestId('answer-name')).toBeInTheDocument()
  })

  it('remembers the best streak and its losing roll across a reload, and offers Share', async () => {
    localStorage.clear()
    // keep the email on file, or the leaderboard gate would replace the Share button
    localStorage.setItem(
      'nfl-faces:player:v1',
      JSON.stringify({ playerId: 'p', name: 'Tester', email: 't@x.co', token: 'tok' }),
    )
    render(<App bundle={bundle} config={config} rng={mulberry32(5)} />)
    await startRound()
    fireEvent.pointerDown(screen.getByTestId(`face-${answerSlot()}`))
    await act(async () => {
      vi.advanceTimersByTime(config.feedbackMs + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(config.wheels.length * config.spinMsPerWheel + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(40)
    })
    const slot = answerSlot()
    fireEvent.pointerDown(screen.getByTestId(`face-${((slot + 1) % 3) as 0 | 1 | 2}`))
    expect(screen.getByTestId('final-streak').textContent).toBe('1')
    expect(screen.getByTestId('share')).toBeInTheDocument()
    const roll = screen.getByTestId('game-over').dataset.roll!
    cleanup()
    render(<App bundle={bundle} config={config} rng={mulberry32(6)} />)
    expect(screen.getByTestId('best').textContent).toContain('Your top streak of the day: 1')
    expect(roll).toMatch(/^2010 · /)
    expect(screen.getByTestId('start-share')).toBeInTheDocument()
  })

  it('emits session_started, round_completed and streak_ended in the spec shape', async () => {
    localStorage.clear()
    const mem = memoryBackend()
    render(
      <App
        bundle={bundle}
        config={config}
        rng={mulberry32(7)}
        deps={{ analytics: createAnalytics(mem.backend), feedback: createFeedback(true) }}
      />,
    )
    expect(mem.calls[0]).toEqual({ name: 'session_started', props: { build_hash: 'test' } })
    expect(mem.ids).toHaveLength(1)
    await startRound()
    const slot = answerSlot()
    fireEvent.pointerDown(screen.getByTestId(`face-${slot}`))
    const round = mem.calls.find((c) => c.name === 'round_completed')!.props as Record<
      string,
      unknown
    >
    expect(round).toMatchObject({
      season: 2010,
      role: 'QB',
      answer_slot: slot,
      tapped_slot: slot,
      outcome: 'correct',
      streak_position: 1,
      build_hash: 'test',
    })
    expect((round.distractor_ids as string[]).length).toBe(2)
    expect(typeof round.time_to_tap_ms).toBe('number')
    await act(async () => {
      vi.advanceTimersByTime(config.feedbackMs + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(config.wheels.length * config.spinMsPerWheel + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(40)
    })
    await act(async () => {
      vi.advanceTimersByTime(config.decisionMs + 100)
    })
    const ended = mem.calls.find((c) => c.name === 'streak_ended')!.props
    expect(ended).toEqual({ streak_length: 1, end_reason: 'timeout', is_new_best: true })
    const last = mem.calls.filter((c) => c.name === 'round_completed').at(-1)!.props as Record<
      string,
      unknown
    >
    expect(last).toMatchObject({
      outcome: 'timeout',
      tapped_slot: null,
      time_to_tap_ms: null,
      streak_position: 2,
    })
  })

  it('sound is off by default; the toggle persists and is reported', () => {
    localStorage.clear()
    const mem = memoryBackend()
    render(
      <App
        bundle={bundle}
        config={config}
        deps={{ analytics: createAnalytics(mem.backend), feedback: createFeedback(true) }}
      />,
    )
    const btn = screen.getByTestId('mute')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(screen.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true')
    expect(mem.calls.at(-1)).toEqual({ name: 'mute_toggled', props: { muted: false } })
    cleanup()
    render(<App bundle={bundle} config={config} deps={{ feedback: createFeedback(true) }} />)
    expect(screen.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true')
  })
})
