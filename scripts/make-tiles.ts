/**
 * Pro Bowl Mode assets.
 *
 *   npm run tiles -- [--refresh]
 *
 * - Draft-team tiles: one rounded square per row of content/draft_teams.csv,
 *   the tile label in the alternate colour on the primary colour (no logos,
 *   by design), plus an UNDRAFTED tile. → public/tiles/{key}.png
 * - College logos: every college referenced by probowl_players.csv, downloaded
 *   once (raw-photos/colleges/, gitignored), trimmed of transparent margins and
 *   fitted into a fixed square so all logos read at roughly the same size.
 *   → public/colleges/{id}.png
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseProBowlContent } from './lib/probowl'

const ROOT = path.resolve(import.meta.dirname, '..')
const TILES = path.join(ROOT, 'public/tiles')
const COLLEGES = path.join(ROOT, 'public/colleges')
const RAW = path.join(ROOT, 'raw-photos/colleges')
const SIZE = 512
const UA =
  'nfl-faces-assets/0.1 (https://github.com/frankmichaelsmith/NFL-Faces; fmsfranksmith@gmail.com)'
/** Logos render at ~110 px on a phone; 320 px keeps them crisp at 2× and a quarter of the bytes. */
const LOGO_SIZE = 320
/** The card colour logos sit on (src/index.css --color-card). */
const CARD_RGB = [0x18, 0x20, 0x36] as const
/**
 * Perceptual distance (CIE76 ΔE in Lab) below which a logo gets a light halo
 * (Frank, 2026-09-09: Utah State's navy vanished on the navy card). Hue counts
 * here, so crimson on navy passes while navy on navy does not.
 */
const MIN_DELTA_E = 24

function rgbToLab([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** Median ΔE between a logo's opaque pixels and the card colour. Low = the logo melts into the card. */
export async function logoDistance(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const card = rgbToLab(CARD_RGB)
  const ds: number[] = []
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3]! < 200) continue
    const [L, a, b] = rgbToLab([data[i]!, data[i + 1]!, data[i + 2]!])
    ds.push(Math.hypot(L - card[0], a - card[1], b - card[2]))
  }
  if (!ds.length) return 100
  ds.sort((x, y) => x - y)
  return ds[Math.floor(ds.length / 2)]!
}

/**
 * A white outline behind the logo: the alpha channel dilated by `radius`
 * pixels (done in plain code so no colour-space rules get in the way), painted
 * white, with the logo composited back on top.
 */
async function withHalo(png: Buffer, radius = 9): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) alpha[i] = data[i * 4 + 3]!
  // Separable dilation: max over a horizontal window, then a vertical one.
  const pass = (src: Uint8Array, dx: number, dy: number) => {
    const out = new Uint8Array(src.length)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let m = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k * dx
          const yy = y + k * dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          const v = src[yy * width + xx]!
          if (v > m) m = v
        }
        out[y * width + x] = m
      }
    return out
  }
  const dilated = pass(pass(alpha, 1, 0), 0, 1)
  const halo = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    halo[i * 4] = 255
    halo[i * 4 + 1] = 255
    halo[i * 4 + 2] = 255
    halo[i * 4 + 3] = dilated[i]!
  }
  return sharp(halo, { raw: { width, height, channels: 4 } })
    .blur(1)
    .composite([{ input: png }])
    .png()
    .toBuffer() as Promise<Buffer>
}

export function tileSvg(label: string, color: string, alt: string, size = SIZE): string {
  const long = label.length > 4
  const font = long
    ? Math.round(size * 0.17)
    : label.length === 2
      ? Math.round(size * 0.5)
      : Math.round(size * 0.42)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#${color}"/>
  <text x="50%" y="50%" dy="${Math.round(font * 0.36)}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="900" font-size="${font}" fill="#${alt}" letter-spacing="${-font * 0.03}">${label}</text>
</svg>`
}

async function main() {
  const refresh = process.argv.includes('--refresh')
  await mkdir(TILES, { recursive: true })
  await mkdir(COLLEGES, { recursive: true })
  await mkdir(RAW, { recursive: true })
  const read = (f: string) => readFile(path.join(ROOT, 'content', f), 'utf8')
  const { content, errors } = parseProBowlContent({
    selections: await read('probowl_selections.csv'),
    players: await read('probowl_players.csv'),
    draftTeams: await read('draft_teams.csv'),
  })
  if (errors.length) throw new Error(errors.join('\n'))

  // Tiles
  for (const t of content.draftTeams) {
    await sharp(Buffer.from(tileSvg(t.label, t.color, t.alt_color)))
      .png()
      .toFile(path.join(TILES, `${t.abbr}.png`))
  }
  await sharp(Buffer.from(tileSvg('UNDRAFTED', '3A3F4B', 'FFFFFF')))
    .png()
    .toFile(path.join(TILES, 'UDFA.png'))
  console.log(`tiles: ${content.draftTeams.length + 1} written to public/tiles`)

  // College logos
  const colleges = new Map<string, string>()
  for (const p of content.players)
    if (p.college_id && p.college_logo) colleges.set(p.college_id, p.college_logo)
  let ok = 0
  const failed: string[] = []
  const haloed: string[] = []
  for (const [id, url] of colleges) {
    const rawFile = path.join(RAW, `${id}.png`)
    try {
      if (refresh || !existsSync(rawFile)) {
        const res = await fetch(url, { headers: { 'User-Agent': UA } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await writeFile(rawFile, Buffer.from(await res.arrayBuffer()))
      }
      // Trim transparent margins, then fit into a square with padding so every logo reads the same size.
      const trimmed = await sharp(rawFile).ensureAlpha().trim({ threshold: 10 }).toBuffer()
      let logo: Buffer = await sharp(trimmed)
        .resize(Math.round(LOGO_SIZE * 0.8), Math.round(LOGO_SIZE * 0.8), {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .extend({
          top: Math.round(LOGO_SIZE * 0.1),
          bottom: Math.round(LOGO_SIZE * 0.1),
          left: Math.round(LOGO_SIZE * 0.1),
          right: Math.round(LOGO_SIZE * 0.1),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer()
      const distance = await logoDistance(logo)
      if (distance < MIN_DELTA_E) {
        logo = await withHalo(logo)
        haloed.push(`${id} (ΔE ${distance.toFixed(0)})`)
      }
      await sharp(logo)
        .png({ compressionLevel: 9 })
        .toFile(path.join(COLLEGES, `${id}.png`))
      ok++
    } catch (e) {
      failed.push(`${id}: ${(e as Error).message}`)
    }
  }
  console.log(
    `colleges: ${ok} logos written to public/colleges${failed.length ? `, ${failed.length} failed` : ''}`,
  )
  for (const f of failed) console.log('  ! ' + f)
  console.log(`haloed (ΔE < ${MIN_DELTA_E} from the card): ${haloed.length}: ${haloed.join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
