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
  // Faces is hidden from the start screen for now; ?mode=faces still opens it.
  await page.goto('/?mode=faces')
  await expect(page.getByRole('heading', { name: /NFL Spin Streak/i })).toBeVisible()
  const bundle = (await (await page.request.get('/data/bundle.json')).json()) as Bundle

  await page.getByRole('button', { name: 'Start' }).click()
  const faces = page.getByTestId('faces')
  await expect(faces).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('wheel-team')).toHaveAttribute('data-settled', 'true')

  // The drum: after landing, the winning row sits in the middle of the window, flat,
  // with the neighbours tilted away (real rAF runs here, unlike jsdom).
  await page.waitForTimeout(150)
  // Typed structurally: the e2e tsconfig has no DOM lib.
  type Box = { top: number; bottom: number; height: number }
  type Row = {
    style: { transform: string }
    textContent: string | null
    getBoundingClientRect(): Box
  }
  type ReelEl = {
    getBoundingClientRect(): Box
    querySelectorAll(sel: string): Iterable<Row>
    dataset: { value: string }
  }
  const drum = await page.getByTestId('wheel-team').evaluate((node) => {
    const reel = node as unknown as ReelEl
    const rect = reel.getBoundingClientRect()
    const rows = [...reel.querySelectorAll('.reel-item')]
    const value = reel.dataset.value.replace(/\s+/g, '')
    const inWindow = rows.filter((r) => {
      const b = r.getBoundingClientRect()
      return b.bottom > rect.top && b.top < rect.bottom
    })
    const winner = inWindow.find((r) => r.textContent!.replace(/\s+/g, '') === value)!
    const wb = winner.getBoundingClientRect()
    return {
      height: Math.round(rect.height),
      visibleRows: inWindow.length,
      winnerTop: Math.round(wb.top - rect.top),
      winnerHeight: Math.round(wb.height),
      winnerTransform: winner.style.transform,
      neighbourTransforms: inWindow.filter((r) => r !== winner).map((r) => r.style.transform),
    }
  })
  expect(drum.height).toBeGreaterThanOrEqual(128)
  expect(drum.height).toBeLessThanOrEqual(132)
  expect(drum.visibleRows).toBe(3)
  expect(Math.abs(drum.winnerTop - 32)).toBeLessThanOrEqual(3)
  expect(drum.winnerTransform).toMatch(/rotateX\((-?0(\.\d+)?)deg\)/)
  for (const t of drum.neighbourTransforms) expect(t).toMatch(/rotateX\(-?[1-9]\d(\.\d+)?deg\)/)

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
  await page.goto('/?mode=faces')
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
