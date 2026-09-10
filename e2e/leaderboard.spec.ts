/**
 * Leaderboard flow (decision 0008) against the production build and the
 * preview server's in-memory /api: first streak ends → email gate → score
 * posted → board shows the player → reload plays without the gate.
 */
import { expect, test, type Page } from '@playwright/test'

interface ProBowl {
  players: Record<string, { name: string }>
  rosters: Record<string, string[]>
  combos: { season: number; player: string; category: string; answer: string }[]
}
const CATEGORY: Record<string, string> = {
  'Alma Mater': 'alma',
  'Draft Team': 'draft',
  'Jersey Number': 'number',
  Position: 'position',
}

/** Wait for the reels to settle and return the landed combo's answer value. */
async function landedAnswer(page: Page, pb: ProBowl): Promise<string> {
  // Cards are enabled only while the current round awaits a tap, so once one is
  // enabled the wheels and the cards describe the same round.
  await expect(page.getByTestId('face-0')).toBeEnabled({ timeout: 10_000 })
  await expect(page.getByTestId('wheel-category')).toHaveAttribute('data-settled', 'true')
  const season = Number(await page.getByTestId('wheel-season').getAttribute('data-value'))
  const player = await page.getByTestId('wheel-player').getAttribute('data-value')
  const label = (await page.getByTestId('wheel-category').getAttribute('data-value'))!
  // Two Pro Bowlers can share a name (Steve Smith); the season's roster picks the right one.
  const id = pb.rosters[String(season)]!.find((x) => pb.players[x]!.name === player)!
  const combo = pb.combos.find(
    (c) => c.season === season && c.player === id && c.category === CATEGORY[label],
  )!
  expect(combo).toBeTruthy()
  return combo.answer
}

test('first streak gates on email, the score posts, the board lists the player, and play continues', async ({
  page,
}) => {
  await page.goto('/')
  const bundle = (await (await page.request.get('/data/bundle.json')).json()) as {
    probowl: ProBowl
  }
  await page.getByRole('button', { name: 'Start' }).click()

  // Round 1: the right card, streak 1.
  const a1 = await landedAnswer(page, bundle.probowl)
  const right = page.locator(`[data-testid^="face-"][data-value="${a1}"]`)
  await expect(right).toBeEnabled()
  await right.dispatchEvent('pointerdown')
  await expect(page.getByTestId('streak')).toHaveText('1')

  // Round 2: a wrong card, game over at 1.
  await expect(page.getByTestId('face-0')).toBeDisabled()
  const a2 = await landedAnswer(page, bundle.probowl)
  const wrong = page.locator(`[data-testid^="face-"]:not([data-value="${a2}"])`).first()
  await expect(wrong).toBeEnabled()
  await wrong.dispatchEvent('pointerdown')
  await expect(page.getByTestId('game-over')).toBeVisible()

  // The gate replaces the buttons.
  await expect(page.getByTestId('signup')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play again' })).toHaveCount(0)
  const name = `PW ${Date.now().toString(36).slice(-4)}`
  await page.getByTestId('signup-email').fill(`e2e-${Date.now()}@example.com`)
  await page.getByTestId('signup-name').fill(name)
  await page.getByTestId('signup-submit').click()

  // Joined: the streak that just ended is on the board with a rank.
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()
  await expect(page.getByTestId('rank-line')).toContainText(/#\d+ on today's leaderboard/i)
  await page.getByTestId('open-board').click()
  const mine = page.locator('[data-testid="board-row"][data-you="true"]')
  await expect(mine).toContainText(name)
  await expect(mine).toContainText('1')
  await page.getByTestId('close-board').click()
  await expect(page.getByTestId('leaderboard')).toHaveCount(0)

  // The email is remembered: after a reload, Start plays with no gate.
  await page.reload()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('signup')).toHaveCount(0)
  await expect(page.getByTestId('faces')).toBeVisible({ timeout: 10_000 })
})
