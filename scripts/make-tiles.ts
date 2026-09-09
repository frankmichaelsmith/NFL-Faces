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
      await sharp(trimmed)
        .resize(Math.round(SIZE * 0.8), Math.round(SIZE * 0.8), {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .extend({
          top: Math.round(SIZE * 0.1),
          bottom: Math.round(SIZE * 0.1),
          left: Math.round(SIZE * 0.1),
          right: Math.round(SIZE * 0.1),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
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
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
