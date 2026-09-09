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
