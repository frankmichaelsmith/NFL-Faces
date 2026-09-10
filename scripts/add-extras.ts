/**
 * Turn Frank's approved candidate list into content/extra_selections.csv:
 * players who were not Pro Bowlers that season but belong in the pool
 * (Frank, 2026-09-10). Each row is keyed by ESPN id like a Pro Bowl
 * selection; pull:probowl merges the file into probowl_selections.csv so the
 * usual facts pull (college, draft, numbers) runs for them too.
 *
 *   npm run extras -- content/candidates_approved.csv
 *
 * The Wikipedia article title is found by search and verified against ESPN
 * (position wording, and draft/debut year or college); an unverified match is
 * left blank with a note so the pull relies on ESPN alone for that player.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseCsv, serializeCsv } from './lib/csv'
import { EspnClient } from './lib/espn'
import { SELECTION_HEADER, parseProBowlContent, type SelectionRow } from './lib/probowl'
import { WikiClient, nameKey, parseInfobox, parseWikiTitles } from './lib/wiki'

const ROOT = path.resolve(import.meta.dirname, '..')
const POS_WORDS: Record<string, string[]> = {
  QB: ['quarterback'],
  RB: ['running back', 'halfback', 'tailback'],
  WR: ['wide receiver'],
  TE: ['tight end'],
}

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('usage: npm run extras -- <approved.csv>')
  const wiki = new WikiClient(path.join(ROOT, '.cache/wiki'))
  const espn = new EspnClient({ cacheDir: path.join(ROOT, '.cache/espn'), refresh: false })
  const read = (f: string) => readFile(path.join(ROOT, 'content', f), 'utf8')
  const { content, errors } = parseProBowlContent({
    selections: await read('probowl_selections.csv'),
    players: await read('probowl_players.csv'),
    draftTeams: await read('draft_teams.csv'),
  })
  if (errors.length) throw new Error(errors.join('\n'))
  // Titles already known from Pro Bowl rosters, by ESPN id.
  const knownTitle = new Map<string, string>()
  for (const s of content.selections)
    if (s.espn_id && s.wiki_title) knownTitle.set(s.espn_id, s.wiki_title)
  const onRoster = new Set(content.selections.map((s) => `${s.season}:${s.espn_id}`))
  // Curator-pinned titles (content/wiki_titles.csv) beat both.
  try {
    for (const [id, title] of parseWikiTitles(await read('wiki_titles.csv')))
      knownTitle.set(id, title)
  } catch {
    /* none */
  }

  const parsed = parseCsv(await readFile(input, 'utf8'))
  const rows = parsed.rows.map((cells) =>
    Object.fromEntries(parsed.header.map((h, i) => [h.replace(/^\uFEFF/, ''), cells[i] ?? ''])),
  ) as Record<string, string>[]
  const approved = rows.filter((r) => r.espn_id && r.name)
  const out: SelectionRow[] = []
  const unverified: string[] = []
  const skipped: string[] = []
  const titleCache = new Map<string, { title: string; note: string }>()
  for (const r of approved) {
    const season = Number(r.season)
    const id = r.espn_id!
    if (onRoster.has(`${season}:${id}`)) {
      skipped.push(`${season} ${r.name} (already on that Pro Bowl roster)`)
      continue
    }
    let title = knownTitle.get(id) ?? ''
    let note = 'extra: Frank 2026-09-10'
    if (!title) {
      if (!titleCache.has(id)) titleCache.set(id, await findTitle(wiki, espn, id, r.name!, r.pos!))
      const t = titleCache.get(id)!
      title = t.title
      if (t.note) {
        note += `; ${t.note}`
        if (!t.title) unverified.push(`${r.name} (${r.pos}, ESPN ${id}): ${t.note}`)
      }
    }
    out.push({
      season,
      pos: r.pos as SelectionRow['pos'],
      number: null,
      wiki_title: title,
      name: r.name!,
      team: r.team ?? '',
      espn_id: id,
      note,
    })
  }
  out.sort(
    (a, b) => a.season - b.season || a.pos.localeCompare(b.pos) || a.name.localeCompare(b.name),
  )
  await writeFile(
    path.join(ROOT, 'content', 'extra_selections.csv'),
    serializeCsv(
      [...SELECTION_HEADER],
      out.map((s) => SELECTION_HEADER.map((h) => s[h])),
    ),
  )
  console.log(
    `wrote ${out.length} extra selections (${new Set(out.map((s) => s.espn_id)).size} players)`,
  )
  if (skipped.length) console.log(`skipped ${skipped.length}: ${skipped.join('; ')}`)
  if (unverified.length)
    console.log(
      `no verified Wikipedia article (${unverified.length}); ESPN alone will feed these:\n  ${unverified.join('\n  ')}`,
    )
}

/**
 * Find and verify the player's Wikipedia article. Candidates must match the
 * name; the winner must agree with ESPN on college or draft pick (strong), or
 * be the only name match whose draft/debut year fits. The infobox position is
 * not required: retired players' infoboxes often carry their current job.
 * Empty title = nothing verified.
 */
async function findTitle(
  wiki: WikiClient,
  espn: EspnClient,
  id: string,
  name: string,
  pos: string,
): Promise<{ title: string; note: string }> {
  const f = await espn.athleteFacts(id)
  const draftYear = f?.draft?.year ?? null
  const draftPick = f?.draft?.pick ?? null
  const debut = f?.debutYear ?? null
  const college = f?.college?.name ?? null
  const titles = await wiki.search(
    `${name} American football ${POS_WORDS[pos]?.[0] ?? ''}`.trim(),
    8,
  )
  const key = nameKey(name)
  const strong: string[] = []
  const yearOnly: string[] = []
  for (const t of titles) {
    const plain = t.replace(/\s*\(.*\)$/, '')
    if (nameKey(plain) !== key) continue
    const text = await wiki.wikitext(t)
    if (!text) continue
    const info = parseInfobox(text)
    const p = info.position?.toLowerCase() ?? ''
    const posFits = (POS_WORDS[pos] ?? []).some((w) => p.includes(w))
    const year = info.draftYear ?? info.undraftedYear
    const yearFits =
      year !== null &&
      ((draftYear !== null && Math.abs(draftYear - year) <= 1) ||
        (debut !== null && Math.abs(debut - year) <= 1))
    const pickFits =
      draftPick !== null && info.draftPick === draftPick && draftYear === info.draftYear
    const collegeFits =
      !!college &&
      info.colleges.some(
        (c) => nameKey(c.name) === nameKey(college) || nameKey(college).includes(nameKey(c.name)),
      )
    // ESPN names a college and this article names a different one: a namesake, not a fit.
    const collegeClash = !!college && info.colleges.length > 0 && !collegeFits
    if (pickFits || (collegeFits && (yearFits || posFits))) strong.push(t)
    else if (yearFits && posFits && !collegeClash) yearOnly.push(t)
  }
  if (strong.length === 1) return { title: strong[0]!, note: '' }
  if (strong.length > 1)
    return { title: '', note: `ambiguous Wikipedia articles: ${strong.join(' / ')}` }
  if (yearOnly.length === 1)
    return { title: yearOnly[0]!, note: 'wiki matched by name, position and year' }
  if (yearOnly.length > 1)
    return { title: '', note: `ambiguous Wikipedia articles: ${yearOnly.join(' / ')}` }
  return { title: '', note: 'no Wikipedia article verified' }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
