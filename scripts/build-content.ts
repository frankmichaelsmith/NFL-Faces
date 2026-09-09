/**
 * content/*.csv → public/data/bundle.json + docs/build-report.md
 *
 *   npm run build:content -- [--allow-missing-photos]
 *
 * Exit 1 on any validation error or hard failure (a combo with < 2 distractors).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GAME_CONFIG } from '../src/game/config'
import { parseContent } from './lib/content'
import { buildBundle, renderReport } from './lib/build'
import { renderAttribution } from './lib/attribution'

const ROOT = path.resolve(import.meta.dirname, '..')

async function main() {
  // Since M5 every pool member needs an approved photo; the flag is for content work in progress.
  const requirePhoto = !process.argv.includes('--allow-missing-photos')
  const files = await Promise.all(
    ['teams.csv', 'people.csv', 'stints.csv'].map((f) =>
      readFile(path.join(ROOT, 'content', f), 'utf8'),
    ),
  )
  const [teams, people, stints] = files as [string, string, string]
  const { content, errors } = parseContent({ teams, people, stints })
  if (errors.length) {
    console.error(`content validation failed with ${errors.length} error(s):`)
    for (const e of errors.slice(0, 50)) console.error('  ' + e)
    if (errors.length > 50) console.error(`  … and ${errors.length - 50} more`)
    process.exit(1)
  }
  const { bundle, report } = buildBundle(content, {
    firstSeason: GAME_CONFIG.firstSeason,
    roles: GAME_CONFIG.roles,
    requirePhoto,
    sources: files,
  })
  await mkdir(path.join(ROOT, 'public/data'), { recursive: true })
  await writeFile(path.join(ROOT, 'public/data/bundle.json'), JSON.stringify(bundle))
  await writeFile(path.join(ROOT, 'docs/build-report.md'), renderReport(bundle, report))
  await writeFile(
    path.join(ROOT, 'public/attribution.html'),
    renderAttribution(content.people.filter((p) => p.espn_id in bundle.people)),
  )
  console.log(
    `bundle ${bundle.buildHash}: ${bundle.combos.length} combos, ${report.answers} answers, ${report.people} people, ` +
      `${report.missingPhotos.length} answers without a photo, ${report.droppedCombos.length} dropped, ${report.ties.length} ties` +
      (bundle.liveSeason ? `, live season ${bundle.liveSeason}` : ''),
  )
  console.log('report: docs/build-report.md')
  if (report.hardFailures.length) {
    console.error(`HARD FAILURES (${report.hardFailures.length}):`)
    for (const f of report.hardFailures) console.error('  ' + f)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
