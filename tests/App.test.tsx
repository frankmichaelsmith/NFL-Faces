import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { Bundle } from '../src/game/bundle'
import { GAME_CONFIG } from '../src/game/config'
import { mulberry32 } from '../src/game/rng'

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
    vi.useRealTimers()
  })

  it('shows the start screen, then wheels and three face cards after the spin', async () => {
    render(<App bundle={bundle} config={config} rng={mulberry32(1)} />)
    expect(screen.getByRole('heading', { name: 'NFL Faces' })).toBeInTheDocument()
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
    expect(screen.getByTestId('losing-roll').textContent).toMatch(/Died on 2010 · /)
    // second tap is ignored
    fireEvent.pointerDown(screen.getByTestId(`face-${slot}`))
    expect(screen.getByTestId(`face-${wrong}`).dataset.look).toBe('wrong')
    fireEvent.click(screen.getByRole('button', { name: 'New streak' }))
    expect(screen.queryByTestId('game-over')).toBeNull()
  })

  it('letting the timer run out is a timeout that reveals the answer', async () => {
    render(<App bundle={bundle} config={config} rng={mulberry32(4)} />)
    await startRound()
    await act(async () => {
      vi.advanceTimersByTime(config.decisionMs + 50)
    })
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    expect(screen.getByText('Time ran out')).toBeInTheDocument()
    expect(screen.getByTestId('answer-name')).toBeInTheDocument()
  })

  it('remembers the best streak and its losing roll across a reload, and offers Share', async () => {
    localStorage.clear()
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
    const roll = screen.getByTestId('losing-roll').textContent!.replace('Died on ', '')
    cleanup()
    render(<App bundle={bundle} config={config} rng={mulberry32(6)} />)
    expect(screen.getByTestId('best').textContent).toContain('Best streak 1')
    expect(screen.getByTestId('best').textContent).toContain(roll)
  })
})
