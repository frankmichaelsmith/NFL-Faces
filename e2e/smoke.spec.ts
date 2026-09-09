/**
 * End-to-end smoke test against the production build (spec §26 M8).
 * Plays one real round: reads the wheels, works out the answer from the
 * served bundle, taps it, and expects the streak to tick to 1.
 */
import { expect, test } from '@playwright/test'

interface Bundle {
  teams: { id: string; label: string }[]
  combos: { season: number; team: string; answer: string }[]
}

test('start, spin, tap the correct face, streak becomes 1', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /NFL Faces/i })).toBeVisible()
  const bundle = (await (await page.request.get('/data/bundle.json')).json()) as Bundle

  await page.getByRole('button', { name: 'Start' }).click()
  const faces = page.getByTestId('faces')
  await expect(faces).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('wheel-team')).toHaveAttribute('data-settled', 'true')

  const season = Number(await page.getByTestId('wheel-season').getAttribute('data-value'))
  const teamLabel = await page.getByTestId('wheel-team').getAttribute('data-value')
  const team = bundle.teams.find((t) => t.label.toUpperCase() === teamLabel)!
  const combo = bundle.combos.find((c) => c.season === season && c.team === team.id)!
  expect(combo).toBeTruthy()

  // The answer's card is the one whose image is the answer's face file.
  const card = page.locator(`[data-testid^="face-"]:has(img[src$="/${combo.answer}.jpg"])`)
  await expect(card).toHaveCount(1)
  await expect(card).toBeEnabled()
  await card.dispatchEvent('pointerdown')
  await expect(page.getByTestId('streak')).toHaveText('1')
  await expect(page.getByTestId('game-over')).toHaveCount(0)
})

test('a wrong tap ends the streak and reveals the answer with a share button', async ({ page }) => {
  await page.goto('/')
  const bundle = (await (await page.request.get('/data/bundle.json')).json()) as Bundle
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('faces')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('wheel-team')).toHaveAttribute('data-settled', 'true')
  const season = Number(await page.getByTestId('wheel-season').getAttribute('data-value'))
  const teamLabel = await page.getByTestId('wheel-team').getAttribute('data-value')
  const team = bundle.teams.find((t) => t.label.toUpperCase() === teamLabel)!
  const combo = bundle.combos.find((c) => c.season === season && c.team === team.id)!
  const wrong = page
    .locator(`[data-testid^="face-"]:not(:has(img[src$="/${combo.answer}.jpg"]))`)
    .first()
  await expect(wrong).toBeEnabled()
  await wrong.dispatchEvent('pointerdown')
  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(page.getByTestId('answer-name')).toBeVisible()
  await expect(page.getByTestId('share')).toBeVisible()
  await expect(page.getByTestId('losing-roll')).toContainText(String(season))
})
