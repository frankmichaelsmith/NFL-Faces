/**
 * NBA mode (decision 0009): the slider switches sport, a round plays over the
 * NBA pool with the Birthplace category on the wheel, and /leaderboard/nba
 * opens the NBA board with its toggle set.
 */
import { expect, test } from '@playwright/test'

interface Pool {
  players: Record<string, { name: string }>
  rosters: Record<string, string[]>
  combos: { season: number; player: string; category: string; answer: string }[]
  categories?: string[]
}
const CATEGORY: Record<string, string> = {
  'Alma Mater': 'alma',
  'Draft Team': 'draft',
  'Jersey Number': 'number',
  Birthplace: 'country',
}

test('NBA: pick the sport, play a round, and the category wheel offers Birthplace', async ({
  page,
}) => {
  await page.goto('/')
  const bundle = (await (await page.request.get('/data/bundle.json')).json()) as { nba: Pool }
  await page.getByTestId('mode-nba').click()
  await expect(page.getByTestId('mode-nba')).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: /^(Start|Play Again)$/ }).click()
  await expect(page.getByTestId('face-0')).toBeEnabled({ timeout: 10_000 })
  await expect(page.getByTestId('wheel-category')).toHaveAttribute('data-settled', 'true')
  const season = Number(await page.getByTestId('wheel-season').getAttribute('data-value'))
  const player = await page.getByTestId('wheel-player').getAttribute('data-value')
  const label = (await page.getByTestId('wheel-category').getAttribute('data-value'))!
  expect(Object.keys(CATEGORY)).toContain(label)
  const id = bundle.nba.rosters[String(season)]!.find(
    (x) => bundle.nba.players[x]!.name === player,
  )!
  const combo = bundle.nba.combos.find(
    (c) => c.season === season && c.player === id && c.category === CATEGORY[label],
  )!
  expect(combo).toBeTruthy()
  // Flag and logo cards carry an image; number cards do not.
  const right = page.locator(`[data-testid^="face-"][data-value="${combo.answer}"]`)
  if (combo.category === 'country')
    await expect(right.locator('img')).toHaveAttribute('src', /\/flags\//)
  await right.dispatchEvent('pointerdown')
  await expect(page.getByTestId('streak')).toHaveText('1')
  // The reel lists the NBA categories, Birthplace included, Position excluded.
  const reel = await page.getByTestId('wheel-category').locator('.reel-item').allTextContents()
  const labels = new Set(reel.map((t) => t.trim()))
  expect(labels.has('Birthplace') || labels.has('BIRTHPLACE')).toBe(true)
  expect([...labels].some((t) => /^position$/i.test(t))).toBe(false)
})

test('/leaderboard/nba opens the NBA board with the sport toggle set', async ({ page }) => {
  await page.goto('/leaderboard/nba')
  await expect(page.getByTestId('leaderboard')).toHaveAttribute('aria-label', 'NBA leaderboard')
  await expect(page.getByTestId('board-mode-nba')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('board-mode-probowl').click()
  await expect(page).toHaveURL(/\/leaderboard$/)
  await page.getByTestId('close-board').click()
  await expect(page).toHaveURL(/\/$/)
})
