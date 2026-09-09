/**
 * Placeholder app icons until the brand set arrives (spec §28): a near-black
 * navy tile with "NF" in a heavy condensed face. Writes public/icons/*.
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
  const font = Math.round(size * 0.5 * scale)
  const radius = maskable ? 0 : Math.round(size * 0.18)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
  <rect x="${size * 0.12}" y="${size * 0.7}" width="${size * 0.76}" height="${size * 0.045}" rx="${size * 0.02}" fill="${ACCENT}"/>
  <text x="50%" y="${size * 0.6}" text-anchor="middle" font-family="Arial Narrow, Impact, Helvetica, Arial, sans-serif" font-weight="900" font-size="${font}" fill="#ffffff" letter-spacing="${-font * 0.02}">NF</text>
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
