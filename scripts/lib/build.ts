/**
 * Derive the answerable-combo bundle from validated content.
 *
 * Rules (CLAUDE.md, locked 2026-09-09):
 * - Answer for (season, team, role): the `starter` row if any (live season),
 *   else the highest passing_yards; ties broken by ESPN's listing order.
 * - Distractors: answers of OTHER teams that season who never threw for the
 *   rolled team that season (full passer list), minus the answer.
 * - Alumni: distractors who were the answer for the rolled team in another season.
 * - Answerable iff the answer is `included` (and has a photo when required)
 *   and there are ≥ 2 distractors.
 */
import { createHash } from 'node:crypto'
import type { Bundle, Combo } from '../../src/game/bundle'
import type { Content, PersonRow, StintRow } from './content'

export interface BuildOptions {
  firstSeason: number
  roles: readonly string[]
  /** Exclude people without an approved photo from every pool. Flipped on in M5. */
  requirePhoto: boolean
  /** Text of the source files, hashed into buildHash. */
  sources: string[]
  now?: Date
}

export interface BuildReport {
  seasons: SeasonReport[]
  /** Combos with an answer nobody can be shown for (excluded / no photo). Dropped. */
  droppedCombos: { combo: string; reason: string }[]
  /** Combos with fewer than two distractors. Hard failure. */
  thinCombos: { combo: string; distractors: number }[]
  /** Passing-yards ties for the top spot; ESPN order decided. Worth a curator's eye. */
  ties: { combo: string; names: string[] }[]
  /** People who are an answer somewhere but have no photo source yet. The curator's to-do list. */
  missingPhotos: { espn_id: string; name: string; combos: number; espn_headshot: boolean }[]
  people: number
  answers: number
  hardFailures: string[]
}

export interface SeasonReport {
  season: number
  live: boolean
  teams: number
  answerable: number
  withAlumni: number
}

export function buildBundle(
  content: Content,
  opts: BuildOptions,
): { bundle: Bundle; report: BuildReport } {
  const people = new Map(content.people.map((p) => [p.espn_id, p]))
  const teams = new Map(content.teams.map((t) => [t.team_id, t]))
  const showable = (p: PersonRow | undefined) =>
    !!p && p.included && (!opts.requirePhoto || (p.photo_approved && p.photo_source !== ''))

  // Group stints by (season, team, role).
  const byCombo = new Map<string, StintRow[]>()
  for (const s of content.stints) {
    if (s.season < opts.firstSeason || !opts.roles.includes(s.role)) continue
    const key = `${s.season}:${s.team_id}:${s.role}`
    byCombo.set(key, [...(byCombo.get(key) ?? []), s])
  }

  // Pick the answer for every combo, live or complete.
  interface Picked {
    season: number
    team: string
    role: string
    answer: string
    passers: Set<string>
    live: boolean
  }
  const picked: Picked[] = []
  const ties: BuildReport['ties'] = []
  for (const [key, rows] of byCombo) {
    const [season, team, role] = key.split(':') as [string, string, string]
    const starter = rows.find((r) => r.starter)
    let answer: StintRow
    if (starter) answer = starter
    else {
      const sorted = [...rows].sort(
        (a, b) => (b.passing_yards ?? -1) - (a.passing_yards ?? -1) || a.espn_order - b.espn_order,
      )
      answer = sorted[0]!
      const tied = sorted.filter((r) => r.passing_yards === answer.passing_yards)
      if (tied.length > 1)
        ties.push({
          combo: key,
          names: tied.map((r) => people.get(r.espn_id)?.display_name ?? r.espn_id),
        })
    }
    picked.push({
      season: Number(season),
      team,
      role,
      answer: answer.espn_id,
      passers: new Set(rows.map((r) => r.espn_id)),
      live: rows.some((r) => r.source === 'depthchart'),
    })
  }

  // Index answers: by season+role (candidate distractors) and by team+role (alumni).
  const answersBySeason = new Map<string, Picked[]>()
  const answersByTeam = new Map<string, Set<string>>()
  for (const p of picked) {
    const sk = `${p.season}:${p.role}`
    answersBySeason.set(sk, [...(answersBySeason.get(sk) ?? []), p])
    const tk = `${p.team}:${p.role}`
    answersByTeam.set(tk, new Set([...(answersByTeam.get(tk) ?? []), p.answer]))
  }

  const combos: Combo[] = []
  const dropped: BuildReport['droppedCombos'] = []
  const thin: BuildReport['thinCombos'] = []
  const liveSeasons = new Set<number>()
  for (const p of picked.sort((a, b) => a.season - b.season || a.team.localeCompare(b.team))) {
    const key = `${p.season}:${p.team}:${p.role}`
    const person = people.get(p.answer)
    if (!showable(person)) {
      dropped.push({
        combo: key,
        reason: !person?.included
          ? `answer ${person?.display_name ?? p.answer} is excluded`
          : 'answer has no approved photo',
      })
      continue
    }
    const distractors = (answersBySeason.get(`${p.season}:${p.role}`) ?? [])
      .filter((o) => o.team !== p.team && o.answer !== p.answer && !p.passers.has(o.answer))
      .map((o) => o.answer)
      .filter((id, i, arr) => arr.indexOf(id) === i && showable(people.get(id)))
    if (distractors.length < 2) {
      thin.push({ combo: key, distractors: distractors.length })
      continue
    }
    const alumniSet = answersByTeam.get(`${p.team}:${p.role}`) ?? new Set()
    const alumni = distractors.filter((id) => alumniSet.has(id))
    if (p.live) liveSeasons.add(p.season)
    combos.push({
      season: p.season,
      team: p.team,
      role: p.role,
      answer: p.answer,
      distractors,
      alumni,
    })
  }

  // Bundle people = everyone referenced by a combo.
  const referenced = new Set<string>()
  for (const c of combos) {
    referenced.add(c.answer)
    c.distractors.forEach((d) => referenced.add(d))
  }
  const bundlePeople: Bundle['people'] = {}
  for (const id of [...referenced].sort()) {
    const p = people.get(id)!
    bundlePeople[id] = {
      name: p.display_name,
      photo: p.photo_approved && p.photo_source ? `${id}.jpg` : null,
    }
  }

  // Report.
  const seasonsSeen = [...new Set(picked.map((p) => p.season))].sort((a, b) => a - b)
  const seasons: SeasonReport[] = seasonsSeen.map((season) => ({
    season,
    live: liveSeasons.has(season),
    teams: picked.filter((p) => p.season === season).length,
    answerable: combos.filter((c) => c.season === season).length,
    withAlumni: combos.filter((c) => c.season === season && c.alumni.length > 0).length,
  }))
  const answerCounts = new Map<string, number>()
  for (const p of picked) answerCounts.set(p.answer, (answerCounts.get(p.answer) ?? 0) + 1)
  const missingPhotos = [...answerCounts]
    .map(([id, n]) => ({ id, n, p: people.get(id)! }))
    .filter(({ p }) => p.included && !(p.photo_approved && p.photo_source))
    .map(({ id, n, p }) => ({
      espn_id: id,
      name: p.display_name,
      combos: n,
      espn_headshot: p.espn_headshot,
    }))
    .sort((a, b) => b.combos - a.combos || a.name.localeCompare(b.name))
  const hardFailures = thin.map((t) => `${t.combo} has only ${t.distractors} distractor(s)`)

  const teamsOut = [...teams.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((t) => ({ id: t.team_id, label: t.label }))
  const hash = createHash('sha1')
  for (const s of opts.sources) hash.update(s)
  hash.update(
    JSON.stringify({
      firstSeason: opts.firstSeason,
      roles: opts.roles,
      requirePhoto: opts.requirePhoto,
    }),
  )

  const bundle: Bundle = {
    buildHash: hash.digest('hex').slice(0, 12),
    generatedAt: (opts.now ?? new Date()).toISOString(),
    firstSeason: opts.firstSeason,
    lastSeason: seasonsSeen.at(-1) ?? opts.firstSeason,
    liveSeason: liveSeasons.size ? Math.max(...liveSeasons) : null,
    roles: [...opts.roles],
    teams: teamsOut,
    people: bundlePeople,
    combos,
  }
  return {
    bundle,
    report: {
      seasons,
      droppedCombos: dropped,
      thinCombos: thin,
      ties,
      missingPhotos,
      people: referenced.size,
      answers: answerCounts.size,
      hardFailures,
    },
  }
}

export function renderReport(bundle: Bundle, r: BuildReport): string {
  const lines: string[] = []
  lines.push(`# Build report — ${bundle.buildHash}`, '', `Generated ${bundle.generatedAt}.`, '')
  lines.push(
    `**${bundle.combos.length}** answerable combos across ${r.seasons.length} seasons (${bundle.firstSeason}–${bundle.lastSeason}` +
      (bundle.liveSeason ? `, ${bundle.liveSeason} live from the depth chart` : '') +
      `), ${r.answers} distinct answers, ${r.people} people in the bundle.`,
    '',
  )
  if (r.hardFailures.length) {
    lines.push('## HARD FAILURES', '', ...r.hardFailures.map((f) => `- ${f}`), '')
  }
  lines.push(
    '## Coverage by season',
    '',
    '| Season | Teams | Answerable | With alumni distractor |',
    '|---|---|---|---|',
  )
  for (const s of r.seasons)
    lines.push(
      `| ${s.season}${s.live ? ' (live)' : ''} | ${s.teams} | ${s.answerable} | ${s.withAlumni} |`,
    )
  lines.push('')
  lines.push(`## Missing photos (${r.missingPhotos.length})`, '')
  if (r.missingPhotos.length) {
    lines.push(
      'Answers with no approved photo yet, most combos first. ESPN column = ESPN serves a headshot.',
      '',
    )
    lines.push('| Name | Combos | ESPN | espn_id |', '|---|---|---|---|')
    for (const m of r.missingPhotos)
      lines.push(`| ${m.name} | ${m.combos} | ${m.espn_headshot ? 'yes' : 'no'} | ${m.espn_id} |`)
  } else lines.push('None.')
  lines.push('')
  lines.push(`## Dropped combos (${r.droppedCombos.length})`, '')
  lines.push(
    ...(r.droppedCombos.length
      ? r.droppedCombos.map((d) => `- ${d.combo}: ${d.reason}`)
      : ['None.']),
    '',
  )
  lines.push(`## Passing-yards ties at the top (${r.ties.length})`, '')
  lines.push(
    ...(r.ties.length ? r.ties.map((t) => `- ${t.combo}: ${t.names.join(' / ')}`) : ['None.']),
    '',
  )
  return lines.join('\n')
}
