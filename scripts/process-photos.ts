/**
 * Produce public/faces/{espn_id}.jpg for every person in the bundle.
 *
 *   npm run photos -- [--only <espn_id,...>] [--refresh] [--sheet]
 *
 * Sources, in order (CLAUDE.md, decision 0003):
 *   1. ESPN headshot by espn_id (uniform framing → automatic face crop, auto-approved).
 *   2. Wikimedia Commons search for people ESPN lacks: best candidate file,
 *      license checked against the allow-list, default crop, NOT approved
 *      until a curator sets photo_crop and photo_approved in people.csv.
 *   3. Anything still missing is listed for manual sourcing.
 *
 * Originals are cached in raw-photos/ (gitignored). people.csv is updated in
 * place: photo_source, photo_license, photo_approved, notes.
 * --sheet writes contact sheets to .cache/photos/ for eyeballing.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { Bundle } from '../src/game/bundle'
import { serializeCsv } from './lib/csv'
import { parseContent, PERSON_HEADER, type PersonRow } from './lib/content'
import { defaultCrop, measureSilhouette, parseCropSpec, planCrop, renderFace } from './lib/photos'

const ROOT = path.resolve(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'raw-photos')
const OUT = path.join(ROOT, 'public/faces')
const UA =
  'nfl-faces-photos/0.1 (https://github.com/frankmichaelsmith/NFL-Faces; fmsfranksmith@gmail.com)'
const ESPN_HEADSHOT = (id: string) => `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`
const LICENSE_OK = /^(cc0|cc[- ]by(-sa)?[- ]?\d|public domain|pd)/i

interface Args {
  only: Set<string> | null
  refresh: boolean
  sheet: boolean
}

function parseArgs(argv: string[]): Args {
  const a: Args = { only: null, refresh: false, sheet: false }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!
    if (v === '--only') a.only = new Set(argv[++i]!.split(','))
    else if (v === '--refresh') a.refresh = true
    else if (v === '--sheet') a.sheet = true
    else throw new Error(`Unknown argument ${v}`)
  }
  return a
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function cached(file: string, url: string, refresh: boolean): Promise<Buffer | null> {
  if (!refresh && existsSync(file)) return readFile(file)
  const buf = await fetchBuffer(url)
  if (buf) await writeFile(file, buf)
  return buf
}

// ---- Wikimedia Commons ---------------------------------------------------------

interface CommonsPick {
  title: string
  url: string
  license: string
  artist: string
}

async function commonsSearch(name: string): Promise<CommonsPick | null> {
  const q = new URLSearchParams({
    action: 'query',
    list: 'search',
    srnamespace: '6',
    srlimit: '10',
    format: 'json',
    srsearch: `"${name}" football`,
  })
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) return null
  const hits = ((await res.json()) as { query: { search: { title: string }[] } }).query.search
    .map((h) => h.title)
    .filter((t) => /\.(jpe?g|png)$/i.test(t))
  const last = name.split(' ').pop()!.toLowerCase()
  const ranked = hits
    .filter((t) => t.toLowerCase().includes(last))
    .sort((a, b) => Number(/cropped/i.test(b)) - Number(/cropped/i.test(a)))
  for (const title of ranked) {
    const info = await commonsInfo(title)
    if (info && LICENSE_OK.test(info.license)) return info
  }
  return null
}

async function commonsInfo(title: string): Promise<CommonsPick | null> {
  const q = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1000',
    format: 'json',
    titles: title,
  })
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) return null
  const pages = (
    (await res.json()) as { query: { pages: Record<string, { imageinfo?: RawImageInfo[] }> } }
  ).query.pages
  const ii = Object.values(pages)[0]?.imageinfo?.[0]
  if (!ii) return null
  const meta = ii.extmetadata ?? {}
  return {
    title,
    url: ii.thumburl ?? ii.url,
    license: meta.LicenseShortName?.value ?? '',
    artist: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim(),
  }
}

interface RawImageInfo {
  url: string
  thumburl?: string
  extmetadata?: Record<string, { value: string }>
}

// ---- main ------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(RAW, { recursive: true })
  await mkdir(OUT, { recursive: true })
  const bundle = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/bundle.json'), 'utf8'),
  ) as Bundle
  const files = await Promise.all(
    ['teams.csv', 'people.csv', 'stints.csv'].map((f) =>
      readFile(path.join(ROOT, 'content', f), 'utf8'),
    ),
  )
  const [teams, peopleCsv, stints] = files as [string, string, string]
  const { content, errors } = parseContent({ teams, people: peopleCsv, stints })
  if (errors.length) throw new Error(`content invalid:\n${errors.join('\n')}`)
  const people = new Map(content.people.map((p) => [p.espn_id, p]))
  const ids = Object.keys(bundle.people).filter((id) => !args.only || args.only.has(id))

  const done: string[] = []
  const review: string[] = []
  const manual: string[] = []
  const log = (m: string) => console.log(m)

  for (const id of ids) {
    const p = people.get(id)
    if (!p) throw new Error(`bundle person ${id} missing from people.csv`)
    const out = path.join(OUT, `${id}.jpg`)
    try {
      if (await processPerson(p, out, args.refresh)) {
        if (p.photo_approved) done.push(id)
        else review.push(id)
      } else manual.push(id)
    } catch (e) {
      log(`  ! ${p.display_name} (${id}): ${(e as Error).message}`)
      manual.push(id)
    }
  }

  // Write people.csv back with the updated photo columns.
  await writeFile(
    path.join(ROOT, 'content/people.csv'),
    serializeCsv(
      [...PERSON_HEADER],
      content.people.map((p) => PERSON_HEADER.map((h) => p[h])),
    ),
  )
  log(
    `faces written: ${done.length} approved, ${review.length} awaiting review, ${manual.length} need manual sourcing`,
  )
  if (review.length)
    log(
      `review (set photo_crop / photo_approved in people.csv): ${review.map((i) => people.get(i)!.display_name).join(', ')}`,
    )
  if (manual.length)
    log(`manual: ${manual.map((i) => `${people.get(i)!.display_name} (${i})`).join(', ')}`)

  if (args.sheet) {
    const dir = path.join(ROOT, '.cache/photos')
    await mkdir(dir, { recursive: true })
    await sheet(done, path.join(dir, 'sheet-approved.jpg'))
    await sheet(review, path.join(dir, 'sheet-review.jpg'))
    log(`contact sheets in ${dir}`)
  }
}

/** Returns true when a face file now exists for this person. Mutates the row's photo columns. */
async function processPerson(p: PersonRow, out: string, refresh: boolean): Promise<boolean> {
  const id = p.espn_id
  const cropSpec = p.photo_crop

  // 1. ESPN
  if (p.espn_headshot) {
    const raw = await cached(path.join(RAW, `${id}.png`), ESPN_HEADSHOT(id), refresh)
    if (raw) {
      const sil = await measureSilhouette(raw)
      const meta = await sharp(raw).metadata()
      const box = cropSpec
        ? parseCropSpec(cropSpec, meta.width!, meta.height!)
        : sil
          ? planCrop(sil)
          : defaultCrop(meta.width!, meta.height!)
      await renderFace(raw, box, out)
      p.photo_source = 'espn'
      p.photo_license = 'ESPN headshot (see docs/decisions/0003)'
      p.photo_approved = cropSpec ? true : sil !== null
      if (!sil && !cropSpec)
        p.notes = appendNote(p.notes, 'ESPN headshot has no alpha silhouette; check crop')
      return true
    }
  }

  // 2. Existing non-ESPN source already recorded (commons or manual file in raw-photos/).
  const rawJpg = path.join(RAW, `${id}.jpg`)
  if (p.photo_source && !p.photo_source.startsWith('espn') && existsSync(rawJpg) && !refresh) {
    await renderFromRaw(p, rawJpg, out)
    return true
  }

  // 3. Wikimedia Commons
  const pick = await commonsSearch(p.display_name)
  if (pick) {
    const raw = await cached(rawJpg, pick.url, true)
    if (raw) {
      p.photo_source = `commons:${pick.title}`
      p.photo_license = pick.license
      p.notes = appendNote(p.notes, pick.artist ? `Photo: ${pick.artist}` : '')
      await renderFromRaw(p, rawJpg, out)
      return true
    }
  }
  return false
}

async function renderFromRaw(p: PersonRow, rawFile: string, out: string) {
  const meta = await sharp(rawFile).metadata()
  const box = p.photo_crop
    ? parseCropSpec(p.photo_crop, meta.width!, meta.height!)
    : defaultCrop(meta.width!, meta.height!)
  await renderFace(rawFile, box, out)
  // Non-ESPN photos are approved only once a curator has set the crop.
  if (!p.photo_crop) p.photo_approved = false
}

function appendNote(notes: string, extra: string): string {
  if (!extra || notes.includes(extra)) return notes
  return notes ? `${notes}; ${extra}` : extra
}

async function sheet(ids: string[], file: string) {
  if (!ids.length) return
  const cols = 10
  const size = 120
  const tiles = await Promise.all(
    ids.map((id) =>
      sharp(path.join(OUT, `${id}.jpg`))
        .resize(size, size)
        .toBuffer(),
    ),
  )
  const rows = Math.ceil(tiles.length / cols)
  await sharp({
    create: {
      width: cols * (size + 4),
      height: rows * (size + 4),
      channels: 3,
      background: '#000',
    },
  })
    .composite(
      tiles.map((t, i) => ({
        input: t,
        left: (i % cols) * (size + 4),
        top: Math.floor(i / cols) * (size + 4),
      })),
    )
    .jpeg({ quality: 80 })
    .toFile(file)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
