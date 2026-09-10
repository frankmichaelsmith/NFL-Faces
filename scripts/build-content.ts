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
import { buildProBowl, parseProBowlContent, renderProBowlReport } from './lib/probowl'

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
  // Pro Bowl Mode section (optional until its content exists).
  let probowlReport = ''
  const pb = await readProBowl()
  if (pb) {
    const { content: pbContent, errors: pbErrors } = parseProBowlContent(pb)
    if (pbErrors.length) {
      console.error(`Pro Bowl content validation failed with ${pbErrors.length} error(s):`)
      for (const e of pbErrors.slice(0, 50)) console.error('  ' + e)
      process.exit(1)
    }
    const { section, report: r } = buildProBowl(pbContent)
    bundle.probowl = section
    probowlReport = '\n' + renderProBowlReport(section, r)
    if (r.hardFailures.length) {
      console.error(`Pro Bowl HARD FAILURES (${r.hardFailures.length}):`)
      for (const f of r.hardFailures) console.error('  ' + f)
      process.exit(1)
    }
    console.log(
      `probowl: ${section.combos.length} combos, ${section.seasons.length} seasons, ${Object.keys(section.players).length} players, ${r.unresolved.length} unresolved selections`,
    )
  }
  // NBA pool (decision 0009): same builder, Country instead of Position.
  const nba = await readNba()
  if (nba) {
    const positions = ['G', 'F', 'C']
    const { content: nbaContent, errors: nbaErrors } = parseProBowlContent(nba, { positions })
    if (nbaErrors.length) {
      console.error(`NBA content validation failed with ${nbaErrors.length} error(s):`)
      for (const e of nbaErrors.slice(0, 50)) console.error('  ' + e)
      process.exit(1)
    }
    const { section, report: r } = buildProBowl(nbaContent, {
      categories: ['alma', 'draft', 'number', 'country'],
      positions,
    })
    bundle.nba = section
    probowlReport += '\n' + renderProBowlReport(section, r).replace('## Pro Bowl Mode', '## NBA')
    if (r.hardFailures.length) {
      console.error(`NBA HARD FAILURES (${r.hardFailures.length}):`)
      for (const f of r.hardFailures) console.error('  ' + f)
      process.exit(1)
    }
    console.log(
      `nba: ${section.combos.length} combos, ${section.seasons.length} seasons, ${Object.keys(section.players).length} players, ${Object.keys(section.countries ?? {}).length} countries`,
    )
  }
  await mkdir(path.join(ROOT, 'public/data'), { recursive: true })
  await writeFile(path.join(ROOT, 'public/data/bundle.json'), JSON.stringify(bundle))
  await writeFile(
    path.join(ROOT, 'docs/build-report.md'),
    renderReport(bundle, report) + probowlReport,
  )
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

async function readNba() {
  const read = (f: string) => readFile(path.join(ROOT, 'content', f), 'utf8')
  try {
    const [selections, players, draftTeams] = await Promise.all([
      read('nba_selections.csv'),
      read('nba_players.csv'),
      read('nba_draft_teams.csv'),
    ])
    return { selections, players, draftTeams }
  } catch {
    return null
  }
}

async function readProBowl() {
  const read = (f: string) => readFile(path.join(ROOT, 'content', f), 'utf8')
  try {
    const [roster, players, draftTeams] = await Promise.all([
      read('probowl_selections.csv'),
      read('probowl_players.csv'),
      read('draft_teams.csv'),
    ])
    // Frank's extras (decision 0007, 2026-09-10): non-Pro-Bowlers in the pool, same columns.
    let extras = ''
    try {
      extras = await read('extra_selections.csv')
    } catch {
      /* none */
    }
    const extraRows = extras.split('\n').slice(1).join('\n').trim()
    const selections = extraRows ? roster.trimEnd() + '\n' + extraRows + '\n' : roster
    return { selections, players, draftTeams }
  } catch {
    return null
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
