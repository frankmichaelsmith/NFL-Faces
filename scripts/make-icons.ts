/**
 * App icons for Spin Streak (Frank, 2026-09-09): a near-black navy tile, a
 * heavy white "S" on a slot-reel window (three rows, the middle one lit in
 * the accent green). Writes public/icons/*.
 *
 *   npm run icons
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const OUT = path.resolve(import.meta.dirname, '../public/icons')
const BG = '#0b1020'
const ACCENT = '#34d399'

function svg(size: number, maskable: boolean): string {
  // Maskable icons keep content inside the central 80% safe zone.
  const scale = maskable ? 0.8 : 1
  const font = Math.round(size * 0.66 * scale)
  const radius = maskable ? 0 : Math.round(size * 0.18)
  // Reel window: three rows behind the letter; the centre row is the lit, landed one.
  const c = size / 2
  const w = size * 0.72 * scale
  const rowH = size * 0.2 * scale
  const gap = size * 0.03 * scale
  const rows = [-1, 0, 1]
    .map((i) => {
      const y = c - rowH / 2 + i * (rowH + gap)
      const fill = i === 0 ? ACCENT : '#ffffff'
      const opacity = i === 0 ? 0.28 : 0.08
      return `<rect x="${c - w / 2}" y="${y}" width="${w}" height="${rowH}" rx="${rowH * 0.22}" fill="${fill}" fill-opacity="${opacity}"/>`
    })
    .join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  ${rows}
  <rect x="${c - w / 2}" y="${c - rowH / 2}" width="${w}" height="${rowH}" rx="${rowH * 0.22}" fill="none" stroke="${ACCENT}" stroke-width="${Math.max(1, size * 0.02)}"/>
  <text x="50%" y="${c + font * 0.36}" text-anchor="middle" font-family="Arial Narrow, Impact, Helvetica, Arial, sans-serif" font-weight="900" font-size="${font}" fill="#ffffff">S</text>
</svg>`
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const targets: [string, number, boolean][] = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, false],
  ]
  for (const [name, size, maskable] of targets) {
    await sharp(Buffer.from(svg(size, maskable)))
      .png()
      .toFile(path.join(OUT, name))
  }
  await writeFile(path.join(OUT, 'favicon.svg'), svg(64, false))
  console.log(`wrote ${targets.length + 1} icons to public/icons`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
