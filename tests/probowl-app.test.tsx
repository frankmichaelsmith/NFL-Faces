import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createFeedback } from '../src/audio/feedback'
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
  teams: [{ id: 'PIT', label: 'Steelers' }],
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
  ],
  probowl: {
    seasons: [2010, 2011],
    rosters: { '2010': ['brady', 'brees'], '2011': ['rodgers'] },
    numbers: { '2010': { brady: 12, brees: 9 }, '2011': { rodgers: 12 } },
    players: {
      brady: { name: 'Tom Brady', pos: 'QB', jersey: 12, college: 'mich', draft: 'NE' },
      brees: { name: 'Drew Brees', pos: 'QB', jersey: 9, college: 'pur', draft: 'SD' },
      rodgers: { name: 'Aaron Rodgers', pos: 'QB', jersey: 12, college: 'cal', draft: 'GB' },
    },
    colleges: {
      mich: { name: 'Michigan', logo: 'mich.png' },
      pur: { name: 'Purdue', logo: 'pur.png' },
      cal: { name: 'California', logo: 'cal.png' },
    },
    teams: {
      NE: { label: 'NE', name: 'New England Patriots', color: '002244', alt: 'c60c30' },
      SD: { label: 'SD', name: 'San Diego Chargers', color: '0080C6', alt: 'FFC20E' },
      GB: { label: 'GB', name: 'Green Bay Packers', color: '203731', alt: 'FFB612' },
    },
    combos: [
      {
        season: 2010,
        player: 'brady',
        category: 'draft',
        answer: 'NE',
        distractors: ['SD', 'GB', 'UDFA'],
      },
      { season: 2010, player: 'brees', category: 'number', answer: '9', distractors: ['12', '4'] },
      {
        season: 2011,
        player: 'rodgers',
        category: 'alma',
        answer: 'cal',
        distractors: ['mich', 'pur'],
      },
    ],
  },
}

// Timing overrides only: the wheels must stay the mode's own.
const config = { spinMsPerWheel: 10, feedbackMs: 10, decisionMs: GAME_CONFIG.decisionMs }
const deps = { feedback: createFeedback(true) }

async function startRound(wheels: number) {
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  await act(async () => {
    vi.advanceTimersByTime(wheels * config.spinMsPerWheel + 5)
  })
  await act(async () => {
    vi.advanceTimersByTime(40)
  })
  expect(screen.getByTestId('faces')).toBeInTheDocument()
}

describe('Pro Bowl Mode', () => {
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
    localStorage.clear()
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
    cleanup()
  })

  it('opens in Pro Bowl Mode with no picker while Faces is hidden, but still honours a forced mode', () => {
    render(<App bundle={bundle} config={config} deps={deps} />)
    expect(screen.queryByTestId('mode-picker')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Spin Streak' })).toBeInTheDocument()
    expect(screen.getByText(/Tap the correct answer in 6 seconds/i)).toBeInTheDocument()
    cleanup()
    // a device that last played Faces still lands in Pro Bowl Mode
    localStorage.setItem(
      'nfl-faces:stats:v1',
      JSON.stringify({
        ...JSON.parse(localStorage.getItem('nfl-faces:stats:v1') ?? '{}'),
        last_mode: 'faces',
      }),
    )
    render(<App bundle={bundle} config={config} deps={deps} />)
    expect(screen.getByText(/Tap the correct answer in 6 seconds/i)).toBeInTheDocument()
    cleanup()
    // a bundle without a Pro Bowl section falls back to Faces
    render(<App bundle={{ ...bundle, probowl: undefined }} config={config} deps={deps} />)
    expect(screen.getByText(/Tap the quarterback/i)).toBeInTheDocument()
    cleanup()
    // an explicit mode wins
    render(<App bundle={bundle} config={config} deps={deps} mode="faces" />)
    expect(screen.getByText(/Tap the quarterback/i)).toBeInTheDocument()
  })

  it('spins three wheels, names a Pro Bowler from that season, and renders category cards', async () => {
    render(<App bundle={bundle} config={config} deps={deps} mode="probowl" rng={mulberry32(2)} />)
    await startRound(3)
    const season = Number(screen.getByTestId('wheel-season').dataset.value)
    const player = screen.getByTestId('wheel-player').dataset.value!
    const category = screen.getByTestId('wheel-category').dataset.value!
    const rosterNames = bundle.probowl!.rosters[String(season)]!.map(
      (id) => bundle.probowl!.players[id]!.name,
    )
    expect(rosterNames).toContain(player)
    expect(['Alma Mater', 'Draft Team', 'Jersey Number', 'Position']).toContain(category)
    const cards = [0, 1, 2].map((i) => screen.getByTestId(`face-${i}`))
    expect(cards).toHaveLength(3)
    const combo = bundle.probowl!.combos.find(
      (c) => c.season === season && bundle.probowl!.players[c.player]!.name === player,
    )!
    expect(cards.map((c) => c.dataset.value)).toContain(combo.answer)
    if (combo.category === 'draft' || combo.category === 'alma')
      for (const c of cards) expect(c.querySelector('img')).not.toBeNull()
    else for (const c of cards) expect(c.querySelector('img')).toBeNull()
  })

  it('scores a correct tap, then a wrong tap reveals both labels and keeps a Pro Bowl best', async () => {
    render(<App bundle={bundle} config={config} deps={deps} mode="probowl" rng={mulberry32(3)} />)
    await startRound(3)
    const answerOf = () => {
      const season = Number(screen.getByTestId('wheel-season').dataset.value)
      const player = screen.getByTestId('wheel-player').dataset.value!
      return bundle.probowl!.combos.find(
        (c) => c.season === season && bundle.probowl!.players[c.player]!.name === player,
      )!.answer
    }
    const slotOf = (value: string) =>
      [0, 1, 2].find((i) => screen.getByTestId(`face-${i}`).dataset.value === value)!
    fireEvent.pointerDown(screen.getByTestId(`face-${slotOf(answerOf())}`))
    expect(screen.getByTestId('streak').textContent).toBe('1')
    // captions appear only under picture cards (logo / tile), never under a number or position
    const captioned = () =>
      ['Alma Mater', 'Draft Team'].includes(screen.getByTestId('wheel-category').dataset.value!)
    if (captioned()) expect(screen.getByTestId('answer-name')).toBeInTheDocument()
    else expect(screen.queryByTestId('answer-name')).toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(config.feedbackMs + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(3 * config.spinMsPerWheel + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(40)
    })
    const right = slotOf(answerOf())
    const wrong = (right + 1) % 3
    fireEvent.pointerDown(screen.getByTestId(`face-${wrong}`))
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    if (captioned()) {
      expect(screen.getByTestId('answer-name')).toBeInTheDocument()
      expect(screen.getByTestId('tapped-name')).toBeInTheDocument()
    } else {
      expect(screen.queryByTestId('answer-name')).toBeNull()
      expect(screen.queryByTestId('tapped-name')).toBeNull()
    }
    expect(screen.getByTestId('game-over').dataset.roll).toMatch(
      /^20\d\d · .+ · (Alma Mater|Draft Team|Jersey Number|Position)$/,
    )
    cleanup()
    render(<App bundle={bundle} config={config} deps={deps} mode="probowl" />)
    expect(screen.getByTestId('best').textContent).toContain('Best streak 1')
    cleanup()
    render(<App bundle={bundle} config={config} deps={deps} mode="faces" />)
    expect(screen.queryByTestId('best')).toBeNull()
  })
})
