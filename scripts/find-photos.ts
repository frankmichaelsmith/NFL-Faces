/**
 * Candidate finder for people with no approved photo (M9 backfill).
 *
 *   npm run photos:find -- [--only <espn_id,...>]
 *
 * For each person the build report lists as missing a photo, looks at:
 *   1. the English Wikipedia article's lead image (only if it lives on Commons),
 *   2. Commons searches: "Name", Name quarterback, Name NFL, Name football.
 * Licence-checks every candidate, downloads a 400 px thumbnail to
 * .cache/photos/candidates/{espn_id}-{n}.jpg, writes candidates.json, and a
 * numbered contact sheet per person for a curator to pick from.
 * Nothing here touches content/ — picking is a human step.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { parseContent } from './lib/content'
import { buildBundle } from './lib/build'
import { GAME_CONFIG } from '../src/game/config'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, '.cache/photos/candidates')
const UA =
  'nfl-faces-photos/0.1 (https://github.com/frankmichaelsmith/NFL-Faces; fmsfranksmith@gmail.com)'
const LICENSE_OK = /^(cc0|cc[- ]by(-sa)?[- ]?\d|public domain|pd)/i

export interface Candidate {
  espn_id: string
  name: string
  n: number
  title: string
  license: string
  artist: string
  via: string
  thumb: string
  width: number
  height: number
  file: string
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  return res.ok ? ((await res.json()) as T) : null
}

interface ImageInfo {
  url: string
  thumburl?: string
  width: number
  height: number
  extmetadata?: Record<string, { value: string }>
}

async function commonsInfo(title: string) {
  const q = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '400',
    format: 'json',
    titles: title,
  })
  const d = await getJson<{ query: { pages: Record<string, { imageinfo?: ImageInfo[] }> } }>(
    `https://commons.wikimedia.org/w/api.php?${q}`,
  )
  const ii = d && Object.values(d.query.pages)[0]?.imageinfo?.[0]
  if (!ii) return null
  const meta = ii.extmetadata ?? {}
  return {
    title,
    license: meta.LicenseShortName?.value ?? '',
    artist: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim(),
    thumb: ii.thumburl ?? ii.url,
    width: ii.width,
    height: ii.height,
  }
}

async function wikipediaLead(name: string): Promise<string | null> {
  const q = new URLSearchParams({
    action: 'query',
    titles: name,
    prop: 'pageimages',
    piprop: 'name',
    redirects: '1',
    format: 'json',
  })
  const d = await getJson<{ query: { pages: Record<string, { pageimage?: string }> } }>(
    `https://en.wikipedia.org/w/api.php?${q}`,
  )
  const img = d && Object.values(d.query.pages)[0]?.pageimage
  return img ? `File:${img}` : null
}

async function commonsSearch(query: string): Promise<string[]> {
  const q = new URLSearchParams({
    action: 'query',
    list: 'search',
    srnamespace: '6',
    srlimit: '8',
    format: 'json',
    srsearch: query,
  })
  const d = await getJson<{ query: { search: { title: string }[] } }>(
    `https://commons.wikimedia.org/w/api.php?${q}`,
  )
  return d ? d.query.search.map((h) => h.title).filter((t) => /\.(jpe?g|png)$/i.test(t)) : []
}

async function main() {
  const only = process.argv.includes('--only')
    ? new Set(process.argv[process.argv.indexOf('--only') + 1]!.split(','))
    : null
  await mkdir(OUT, { recursive: true })
  const files = await Promise.all(
    ['teams.csv', 'people.csv', 'stints.csv'].map((f) =>
      readFile(path.join(ROOT, 'content', f), 'utf8'),
    ),
  )
  const [teams, people, stints] = files as [string, string, string]
  const { content } = parseContent({ teams, people, stints })
  const { report } = buildBundle(content, {
    firstSeason: GAME_CONFIG.firstSeason,
    roles: GAME_CONFIG.roles,
    requirePhoto: false,
    sources: files,
  })
  const missing = report.missingPhotos.filter((m) => !only || only.has(m.espn_id))
  console.log(`${missing.length} people without an approved photo`)

  const all: Candidate[] = []
  for (const m of missing) {
    const seen = new Set<string>()
    const titles: { title: string; via: string }[] = []
    const lead = await wikipediaLead(m.name)
    if (lead) titles.push({ title: lead, via: 'wikipedia lead' })
    const last = m.name.split(' ').pop()!.toLowerCase()
    for (const q of [
      `"${m.name}"`,
      `${m.name} quarterback`,
      `${m.name} NFL`,
      `${m.name} football`,
    ]) {
      for (const t of await commonsSearch(q))
        if (t.toLowerCase().includes(last)) titles.push({ title: t, via: q })
    }
    let n = 0
    for (const { title, via } of titles) {
      if (seen.has(title) || n >= 6) continue
      seen.add(title)
      const info = await commonsInfo(title)
      if (!info || !LICENSE_OK.test(info.license)) continue
      const res = await fetch(info.thumb, { headers: { 'User-Agent': UA } })
      if (!res.ok) continue
      n++
      const file = path.join(OUT, `${m.espn_id}-${n}.jpg`)
      await sharp(Buffer.from(await res.arrayBuffer()))
        .jpeg()
        .toFile(file)
      all.push({ espn_id: m.espn_id, name: m.name, n, ...info, via, file })
    }
    console.log(`  ${m.name} (${m.espn_id}): ${n} candidate(s)`)
  }
  await writeFile(path.join(OUT, 'candidates.json'), JSON.stringify(all, null, 2))

  // One contact sheet: a row per person, tiles labelled n.
  const tile = 180
  const byPerson = new Map<string, Candidate[]>()
  for (const c of all) byPerson.set(c.espn_id, [...(byPerson.get(c.espn_id) ?? []), c])
  const rows = [...byPerson.values()]
  if (rows.length) {
    const comps: OverlayOptions[] = []
    for (const [r, cands] of rows.entries()) {
      const label = Buffer.from(
        `<svg width="${tile}" height="${tile}"><rect width="100%" height="100%" fill="#111"/><text x="8" y="${tile / 2}" fill="#fff" font-size="16" font-family="Helvetica">${cands[0]!.name.replace(/&/g, '&amp;')}</text><text x="8" y="${tile / 2 + 22}" fill="#9ca3af" font-size="13" font-family="Helvetica">${cands[0]!.espn_id}</text></svg>`,
      )
      comps.push({ input: label, left: 0, top: r * tile })
      for (const c of cands) {
        const img = await sharp(c.file)
          .resize(tile, tile, { fit: 'cover', position: 'top' })
          .composite([
            {
              input: Buffer.from(
                `<svg width="${tile}" height="${tile}"><rect x="0" y="0" width="28" height="24" fill="#34d399"/><text x="6" y="18" font-size="16" font-weight="bold" font-family="Helvetica" fill="#000">${c.n}</text></svg>`,
              ),
            },
          ])
          .toBuffer()
        comps.push({ input: img, left: c.n * tile, top: r * tile })
      }
    }
    await sharp({
      create: { width: 7 * tile, height: rows.length * tile, channels: 3, background: '#000' },
    })
      .composite(comps)
      .jpeg({ quality: 80 })
      .toFile(path.join(OUT, 'sheet.jpg'))
    console.log(`sheet: ${path.join(OUT, 'sheet.jpg')} (${rows.length} people with candidates)`)
  }
  const none = missing.filter((m) => !byPerson.has(m.espn_id)).map((m) => m.name)
  if (none.length) console.log(`no licensed candidate: ${none.join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
