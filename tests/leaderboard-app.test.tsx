import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createFeedback } from '../src/audio/feedback'
import type { Bundle } from '../src/game/bundle'
import { GAME_CONFIG } from '../src/game/config'
import { mulberry32 } from '../src/game/rng'
import { createLeaderboardClient } from '../src/leaderboard/client'

const bundle: Bundle = {
  buildHash: 'test',
  generatedAt: '',
  firstSeason: 2010,
  lastSeason: 2010,
  liveSeason: null,
  roles: ['QB'],
  teams: [{ id: 'PIT', label: 'Steelers' }],
  people: {},
  combos: [],
  probowl: {
    seasons: [2010],
    rosters: { '2010': ['brady', 'brees'] },
    numbers: { '2010': { brady: 12, brees: 9 } },
    players: {
      brady: { name: 'Tom Brady', pos: 'QB', jersey: 12, college: null, draft: null },
      brees: { name: 'Drew Brees', pos: 'QB', jersey: 9, college: null, draft: null },
    },
    colleges: {},
    teams: {},
    combos: [
      { season: 2010, player: 'brady', category: 'number', answer: '12', distractors: ['9', '4'] },
      { season: 2010, player: 'brees', category: 'number', answer: '9', distractors: ['12', '4'] },
    ],
  },
}
const config = { spinMsPerWheel: 10, feedbackMs: 10, decisionMs: GAME_CONFIG.decisionMs }
const deps = () => ({ feedback: createFeedback(true), leaderboard: client })

/** Fake /api with a tiny in-memory board. */
let rows: { name: string; streak: number; token: string }[] = []
const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input)
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const auth = ((init?.headers ?? {}) as Record<string, string>)['authorization'] ?? ''
  const token = auth.replace('Bearer ', '')
  if (path.endsWith('/api/register')) {
    const b = JSON.parse(String(init?.body)) as { email: string; name: string }
    if (!b.email.includes('@'))
      return json(400, { error: 'invalid', message: 'Enter a valid email address' })
    const t = `tok-${b.name}`
    rows.push({ name: b.name, streak: 0, token: t })
    return json(201, { playerId: b.name, name: b.name, token: t, day: '2026-09-09' })
  }
  if (path.endsWith('/api/score')) {
    const me = rows.find((r) => r.token === token)
    if (!me) return json(401, { error: 'unauthorized', message: 'no' })
    const b = JSON.parse(String(init?.body)) as { streak: number }
    me.streak = Math.max(me.streak, b.streak)
    const rank = 1 + rows.filter((r) => r.streak > me.streak).length
    return json(200, { day: '2026-09-09', best: me.streak, improved: true, rank })
  }
  if (path.includes('/api/leaderboard')) {
    const sorted = [...rows].filter((r) => r.streak > 0).sort((a, b) => b.streak - a.streak)
    return json(200, {
      day: '2026-09-09',
      mode: 'probowl',
      rows: sorted.map((r, i) => ({
        rank: i + 1,
        name: r.name,
        streak: r.streak,
        you: r.token === token,
      })),
      you: null,
      players: sorted.length,
    })
  }
  return json(404, { error: 'not_found', message: 'no' })
}) as unknown as typeof fetch
let client = createLeaderboardClient({ fetch: fetchFn })

/**
 * Testing Library's waitFor hangs under fake timers, and polling inside one
 * act() never sees updates (act flushes at its end). So: check, then flush
 * microtasks and a few fake milliseconds inside a short act, and repeat.
 */
async function until(check: () => void) {
  for (let i = 0; i < 100; i++) {
    try {
      check()
      return
    } catch {
      await act(async () => {
        vi.advanceTimersByTime(20)
        await Promise.resolve()
      })
    }
  }
  check()
}

async function startRound() {
  fireEvent.click(screen.getByRole('button', { name: 'Start' }))
  await act(async () => {
    vi.advanceTimersByTime(3 * config.spinMsPerWheel + 5)
  })
  await act(async () => {
    vi.advanceTimersByTime(40)
  })
  expect(screen.getByTestId('faces')).toBeInTheDocument()
}
function answerValue() {
  const player = screen.getByTestId('wheel-player').dataset.value!
  const id = Object.entries(bundle.probowl!.players).find(([, p]) => p.name === player)![0]
  return bundle.probowl!.combos.find((c) => c.player === id)!.answer
}
function slotOf(value: string, want: boolean) {
  return [0, 1, 2].find((i) => (screen.getByTestId(`face-${i}`).dataset.value === value) === want)!
}
async function tapWrong() {
  fireEvent.pointerDown(screen.getByTestId(`face-${slotOf(answerValue(), false)}`))
  expect(screen.getByTestId('game-over')).toBeInTheDocument()
}
async function tapRight() {
  fireEvent.pointerDown(screen.getByTestId(`face-${slotOf(answerValue(), true)}`))
  await act(async () => {
    vi.advanceTimersByTime(config.feedbackMs + 5)
  })
  await act(async () => {
    vi.advanceTimersByTime(3 * config.spinMsPerWheel + 5)
  })
  await act(async () => {
    vi.advanceTimersByTime(40)
  })
}

describe('Leaderboard flow (decision 0008)', () => {
  beforeEach(() => {
    localStorage.clear()
    rows = [{ name: 'Rival', streak: 3, token: 'tok-Rival' }]
    client = createLeaderboardClient({ fetch: fetchFn })
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
    cleanup()
  })

  it('gates the second game behind email + name, posts the first streak, and shows the rank', async () => {
    render(<App bundle={bundle} config={config} deps={deps()} rng={mulberry32(5)} />)
    await startRound()
    await tapRight() // streak 1
    await tapWrong() // game over at 1
    // The gate replaces the buttons.
    expect(screen.getByTestId('signup')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull()
    expect(screen.queryByTestId('share')).toBeNull()
    // A bad email shows the server's message.
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByTestId('signup-name'), { target: { value: 'Frank' } })
    fireEvent.submit(screen.getByTestId('signup'))
    await until(() => expect(screen.getByTestId('signup-error')).toHaveTextContent(/valid email/))
    // The real thing.
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'frank@example.com' } })
    fireEvent.submit(screen.getByTestId('signup'))
    await until(() =>
      expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument(),
    )
    // The streak that just ended was posted with the new token: Rival has 3, so we are #2.
    await until(() =>
      expect(screen.getByTestId('rank-line')).toHaveTextContent("You're #2 on today's leaderboard"),
    )
    expect(rows.find((r) => r.name === 'Frank')!.streak).toBe(1)
    // The board marks our row.
    fireEvent.click(screen.getByTestId('open-board'))
    await until(() => expect(screen.getAllByTestId('board-row')).toHaveLength(2))
    const ours = screen.getAllByTestId('board-row')[1]!
    expect(ours).toHaveTextContent('Frank')
    expect(ours.dataset.you).toBe('true')
    fireEvent.click(screen.getByTestId('close-board'))
    expect(screen.queryByTestId('leaderboard')).toBeNull()
    // Play again freely: no gate, and the next streak posts on its own.
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    await act(async () => {
      vi.advanceTimersByTime(3 * config.spinMsPerWheel + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(40)
    })
    await tapWrong()
    expect(screen.queryByTestId('signup')).toBeNull()
    await until(() =>
      expect(screen.getByTestId('rank-line')).toHaveTextContent(/#\d+ on today's leaderboard/),
    )
  })

  it('a device that played before but has no email is gated on the start screen too', async () => {
    localStorage.setItem(
      'nfl-faces:stats:v1',
      JSON.stringify({
        total_streaks: 2,
        modes: { probowl: { best_streak: 4, best_streak_roll: 'x' } },
      }),
    )
    render(<App bundle={bundle} config={config} deps={deps()} rng={mulberry32(1)} />)
    expect(screen.queryByTestId('signup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByTestId('signup')).toBeInTheDocument()
    expect(screen.queryByTestId('faces')).toBeNull()
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByTestId('signup-name'), { target: { value: 'Al' } })
    fireEvent.submit(screen.getByTestId('signup'))
    // Joining starts the game straight away.
    await until(() => expect(screen.queryByTestId('signup')).toBeNull())
    await act(async () => {
      vi.advanceTimersByTime(3 * config.spinMsPerWheel + 5)
    })
    await act(async () => {
      vi.advanceTimersByTime(40)
    })
    expect(screen.getByTestId('faces')).toBeInTheDocument()
    expect(client.identity()?.name).toBe('Al')
  })

  it('a fresh device is not gated and can browse the board from the start screen', async () => {
    render(<App bundle={bundle} config={config} deps={deps()} rng={mulberry32(1)} />)
    fireEvent.click(screen.getByTestId('open-board'))
    await until(() => expect(screen.getAllByTestId('board-row')).toHaveLength(1))
    expect(screen.getByText(/add your email to get on the board/i)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('close-board'))
    await startRound()
  })
})
