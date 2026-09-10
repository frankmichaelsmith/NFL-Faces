/**
 * NBA assets (decision 0009):
 * - draft-team tiles from content/nba_draft_teams.csv → public/tiles/nba-{key}.png (+ UNDRAFTED shares the NFL tile)
 * - country flags from the flag-icons set (MIT) → public/flags/{code}.png, 4:3 flag centred on a 320 px square
 * College logos for NBA players are written by `npm run tiles`, which reads both player files.
 *
 *   npm run nba:assets
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseCsv } from './lib/csv'
import { parseProBowlContent } from './lib/probowl'

const ROOT = path.resolve(import.meta.dirname, '..')
const TILES = path.join(ROOT, 'public/tiles')
const FLAGS = path.join(ROOT, 'public/flags')
const FLAG_SRC = path.join(ROOT, 'node_modules/flag-icons/flags/4x3')
const SIZE = 512
const FLAG_SIZE = 320

function tileSvg(label: string, color: string, alt: string, size = SIZE): string {
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
  await mkdir(TILES, { recursive: true })
  await mkdir(FLAGS, { recursive: true })
  const read = (f: string) => readFile(path.join(ROOT, 'content', f), 'utf8')
  const { content, errors } = parseProBowlContent(
    {
      selections: await read('nba_selections.csv'),
      players: await read('nba_players.csv'),
      draftTeams: await read('nba_draft_teams.csv'),
    },
    { positions: ['G', 'F', 'C'] },
  )
  if (errors.length) throw new Error(errors.join('\n'))

  for (const t of content.draftTeams)
    await sharp(Buffer.from(tileSvg(t.label, t.color, t.alt_color)))
      .png()
      .toFile(path.join(TILES, `nba-${t.abbr}.png`))
  console.log(`tiles: ${content.draftTeams.length} NBA draft-team tiles written to public/tiles`)

  // Flags: every code in nba_countries.csv that a player actually uses, plus every code in the table.
  const parsed = parseCsv(await read('nba_countries.csv'))
  const codeIdx = parsed.header.indexOf('code')
  const codes = new Set(parsed.rows.map((r) => r[codeIdx]!))
  for (const p of content.players) if (p.country) codes.add(p.country)
  let ok = 0
  const missing: string[] = []
  for (const code of codes) {
    const src = path.join(FLAG_SRC, `${code}.svg`)
    try {
      const flag = await sharp(src, { density: 300 })
        .resize(FLAG_SIZE, Math.round((FLAG_SIZE * 3) / 4), { fit: 'fill' })
        .png()
        .toBuffer()
      // Rounded corners via an SVG mask, then centred on a transparent square.
      const mask = Buffer.from(
        `<svg width="${FLAG_SIZE}" height="${Math.round((FLAG_SIZE * 3) / 4)}"><rect width="100%" height="100%" rx="${Math.round(FLAG_SIZE * 0.06)}" fill="#fff"/></svg>`,
      )
      const rounded = await sharp(flag)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer()
      await sharp({
        create: {
          width: FLAG_SIZE,
          height: FLAG_SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: rounded, gravity: 'centre' }])
        .png({ compressionLevel: 9 })
        .toFile(path.join(FLAGS, `${code}.png`))
      ok++
    } catch {
      missing.push(code)
    }
  }
  console.log(
    `flags: ${ok} written to public/flags${missing.length ? `; missing in flag-icons: ${missing.join(', ')}` : ''}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
