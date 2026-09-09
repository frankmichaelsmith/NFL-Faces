/**
 * Simulate N rounds against the real bundle and check spec §20 criteria 1–4.
 *
 *   npm run simulate -- [--rounds 10000] [--seed 1] [--accuracy 0.85]
 *
 * A simulated player answers correctly with probability `accuracy`; a miss
 * ends the streak and clears repeat protection, so the run exercises many
 * streaks of realistic length. One extra run plays a perfect streak until the
 * bundle is exhausted, to confirm exhaustion is handled and to report the cap.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Bundle, Combo } from '../src/game/bundle'
import { GAME_CONFIG } from '../src/game/config'
import { mulberry32 } from '../src/game/rng'
import { nextRound } from '../src/game/select'
import { nextProBowlRound } from '../src/game/probowl'

const ROOT = path.resolve(import.meta.dirname, '..')

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

async function main() {
  const rounds = arg('rounds', 10000)
  const seed = arg('seed', 1)
  const accuracy = arg('accuracy', 0.85)
  const bundle = JSON.parse(
    await readFile(path.join(ROOT, 'public/data/bundle.json'), 'utf8'),
  ) as Bundle
  const opts = { alumniProb: GAME_CONFIG.alumniProb }
  const rng = mulberry32(seed)
  const failures: string[] = []
  const fail = (msg: string) => failures.length < 20 && failures.push(msg)

  // Index: which person is an answer in which season (for criterion 2).
  const answerSeasons = new Map<string, Set<number>>()
  const comboKey = (c: Combo) => `${c.season}:${c.team}`
  for (const c of bundle.combos)
    answerSeasons.set(c.answer, (answerSeasons.get(c.answer) ?? new Set()).add(c.season))

  const slotCounts = [0, 0, 0]
  const alumniHist = [0, 0, 0]
  const comboSeen = new Map<string, number>()
  let streaks = 0
  let longest = 0
  let used = new Set<string>()
  let streak = 0
  for (let i = 0; i < rounds; i++) {
    const r = nextRound(bundle, used, rng, opts)
    if (!r) {
      fail(`round ${i}: no combo available after ${streak} correct answers`)
      break
    }
    const c = r.combo
    // 1. answerable, exactly one correct face
    if (r.faces.filter((f) => f === c.answer).length !== 1) fail(`${comboKey(c)}: answer count ≠ 1`)
    if (new Set(r.faces).size !== 3) fail(`${comboKey(c)}: duplicate faces ${r.faces.join(',')}`)
    if (r.faces[r.answerSlot] !== c.answer)
      fail(`${comboKey(c)}: answerSlot points at a distractor`)
    for (const f of r.faces) if (!bundle.people[f]) fail(`${comboKey(c)}: unknown person ${f}`)
    // 2. distractors share the season (are some team's answer that season) and do not qualify for the combo
    for (const f of r.faces) {
      if (f === c.answer) continue
      if (!c.distractors.includes(f)) fail(`${comboKey(c)}: ${f} is not in the distractor pool`)
      if (!answerSeasons.get(f)?.has(c.season))
        fail(`${comboKey(c)}: ${f} was nobody's answer in ${c.season}`)
    }
    // 3. repeat protection
    if (used.has(c.answer)) fail(`${comboKey(c)}: ${c.answer} already answered this streak`)
    // 4. slot distribution
    slotCounts[r.answerSlot] = (slotCounts[r.answerSlot] ?? 0) + 1
    alumniHist[r.alumniCount] = (alumniHist[r.alumniCount] ?? 0) + 1
    comboSeen.set(comboKey(c), (comboSeen.get(comboKey(c)) ?? 0) + 1)

    if (rng() < accuracy) {
      used.add(c.answer)
      streak++
      longest = Math.max(longest, streak)
    } else {
      streaks++
      used = new Set()
      streak = 0
    }
  }
  const slotShare = slotCounts.map((n) => n / rounds)
  for (const [i, s] of slotShare.entries())
    if (s < 0.3 || s > 0.37) fail(`slot ${i} share ${(s * 100).toFixed(1)}% outside 30–37%`)

  // Perfect streak until exhaustion.
  const perfectRng = mulberry32(seed + 1)
  const perfectUsed = new Set<string>()
  let cap = 0
  for (;;) {
    const r = nextRound(bundle, perfectUsed, perfectRng, opts)
    if (!r) break
    perfectUsed.add(r.combo.answer)
    cap++
    if (cap > bundle.combos.length) {
      fail('perfect streak did not terminate')
      break
    }
  }
  const distinctAnswers = new Set(bundle.combos.map((c) => c.answer)).size
  if (cap !== distinctAnswers)
    fail(`perfect streak cap ${cap} ≠ distinct answers ${distinctAnswers}`)

  // ---- Pro Bowl Mode -------------------------------------------------------------------
  const pb = bundle.probowl
  let pbSummary = ''
  if (pb) {
    const pbRng = mulberry32(seed + 7)
    const slots = [0, 0, 0]
    const byCat: Record<string, number> = {}
    let pbUsed = new Set<string>()
    let pbStreak = 0
    let pbLongest = 0
    for (let i = 0; i < rounds; i++) {
      const r = nextProBowlRound(pb, pbUsed, pbRng)
      if (!r) {
        fail(`probowl round ${i}: no combo after ${pbStreak} correct`)
        break
      }
      const c = r.combo
      const key = `${c.season} ${pb.players[c.player]?.name} ${c.category}`
      if (!pb.players[c.player]) fail(`${key}: unknown player`)
      if (r.options.filter((o) => o === c.answer).length !== 1) fail(`${key}: answer count ≠ 1`)
      if (new Set(r.options).size !== 3) fail(`${key}: duplicate options`)
      if (r.options[r.answerSlot] !== c.answer) fail(`${key}: answerSlot points at a wrong card`)
      for (const o of r.options)
        if (o !== c.answer && !c.distractors.includes(o)) fail(`${key}: ${o} not in pool`)
      if (pbUsed.has(c.player)) fail(`${key}: player already rolled this streak`)
      if (!pb.rosters[String(c.season)]?.includes(c.player))
        fail(`${key}: player not on that season's roster`)
      // the answer really is the player's attribute
      const p = pb.players[c.player]!
      const truth =
        c.category === 'alma'
          ? p.college
          : c.category === 'draft'
            ? p.draft
            : c.category === 'number'
              ? String(pb.numbers[String(c.season)]?.[c.player])
              : p.pos
      if (truth !== c.answer) fail(`${key}: answer ${c.answer} ≠ player attribute ${truth}`)
      slots[r.answerSlot] = (slots[r.answerSlot] ?? 0) + 1
      byCat[c.category] = (byCat[c.category] ?? 0) + 1
      if (pbRng() < accuracy) {
        pbUsed.add(c.player)
        pbStreak++
        pbLongest = Math.max(pbLongest, pbStreak)
      } else {
        pbUsed = new Set()
        pbStreak = 0
      }
    }
    const share = slots.map((n) => n / rounds)
    for (const [i, s] of share.entries())
      if (s < 0.3 || s > 0.37)
        fail(`probowl slot ${i} share ${(s * 100).toFixed(1)}% outside 30–37%`)
    // Position is weighted down (Frank, 2026-09-09): ~5% of rolls, never more than a tenth.
    const posShare = (byCat['position'] ?? 0) / rounds
    if (posShare < 0.02 || posShare > 0.1)
      fail(`probowl position share ${(posShare * 100).toFixed(1)}% outside 2–10%`)
    // perfect play cap = distinct players
    const perfect = new Set<string>()
    const perfectRng = mulberry32(seed + 8)
    let cap = 0
    for (;;) {
      const r = nextProBowlRound(pb, perfect, perfectRng)
      if (!r) break
      perfect.add(r.combo.player)
      if (++cap > pb.combos.length) {
        fail('probowl perfect streak did not terminate')
        break
      }
    }
    if (cap !== Object.keys(pb.players).length)
      fail(`probowl perfect cap ${cap} ≠ players ${Object.keys(pb.players).length}`)
    pbSummary =
      `probowl: ${pb.combos.length} combos, longest ${pbLongest}, perfect-play cap ${cap} (= players), ` +
      `slots ${share.map((s) => (s * 100).toFixed(1) + '%').join(' / ')}, categories ${Object.entries(
        byCat,
      )
        .map(([k, v]) => `${k} ${((100 * v) / rounds).toFixed(0)}%`)
        .join(', ')}`
  }

  const pct = (n: number) => `${((100 * n) / rounds).toFixed(1)}%`
  console.log(
    `simulate: ${rounds} rounds, seed ${seed}, accuracy ${accuracy}, bundle ${bundle.buildHash}`,
  )
  console.log(
    `  streaks ended: ${streaks}, longest: ${longest}, perfect-play cap: ${cap} (= distinct answers)`,
  )
  console.log(
    `  answer slot share: ${slotShare.map((s) => (s * 100).toFixed(1) + '%').join(' / ')}`,
  )
  console.log(
    `  alumni faces per round: 0 → ${pct(alumniHist[0]!)}, 1 → ${pct(alumniHist[1]!)}, 2 → ${pct(alumniHist[2]!)} (alumniProb ${opts.alumniProb})`,
  )
  console.log(`  distinct combos rolled: ${comboSeen.size} of ${bundle.combos.length}`)
  if (pbSummary) console.log(`  ${pbSummary}`)
  if (failures.length) {
    console.error(`FAILED (${failures.length} shown):`)
    for (const f of failures) console.error('  ' + f)
    process.exit(1)
  }
  console.log('  all §20 criteria 1–4 hold')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
