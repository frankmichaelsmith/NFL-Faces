# CLAUDE.md — NFL FACES working rules

`docs/spec.md` (v1.2, "NFL Streak Game") is the original product spec. This file records the working rules, the decisions Frank locked in the 2026-09-09 design review (they **override the spec wherever they conflict**), and the conventions of this codebase. Read both before doing anything.

## What the game is now (supersedes spec §1, §6, §7, §8)

A fast, endless, mobile-first web game. **Two** slot-machine wheels land on a **season** (2000 → current) and a **team** (32 franchises). Three square headshots appear. The player has **5 seconds** to tap the quarterback who **led that team in passing yards that season**. Correct → streak +1, next round spins immediately. Wrong tap or timeout → streak ends, reveal the answer, offer "New streak".

- Quarterbacks only. No position wheel. No head coaches.
- One roll = one (season, team) combo. Every combo has **exactly one** answer.
- ~830 combos (32 teams × 26 seasons, Texans from 2002), ~190 unique QBs.
- The engine stays **generic**: wheel count, the season range, the team list and the role list are config, so a position wheel or an NBA edition can return later without a rewrite. Do not hard-code "QB" or "2000" into game logic.

## Working rules (non-negotiable)

1. **Build milestone by milestone (spec §26, adapted below) and checkpoint.** After each milestone: stop, summarize what was built and how it was verified, wait for Frank. Never one-shot multiple milestones. Same rhythm as STREAK CITY: work on `main`, commit as you go.
2. **Game logic lives in `src/game/` with no React imports.** Pure, typed, fully unit-tested. The React layer renders state and dispatches events. `npm test` and `npm run simulate` must be green before finishing any task.
3. **The roll is chosen BEFORE the wheels animate.** Never animate first. Every round has exactly one correct face.
4. **Grade only from data.** The answer for a combo comes from the content bundle, which comes from ESPN's structured team-leader data. Never infer, estimate, or hand-wave a result.
5. **Never hotlink images.** Every headshot is downloaded once, cropped, and served from our own hosting. Every person row carries `photo_source`.
6. **Do not ramp difficulty. Ever.** Static rules only (see alumni weighting).
7. **No backend, no database, no auth, no server rendering** in v1. Static bundle plus images.
8. **Ask before deciding.** Anything the spec leaves open, or any scope change, goes to Frank first. Record the answer in `docs/decisions/`.
9. **Secrets** only via gitignored `.env` (see `.env.example`). Never hardcode or commit a key.
10. Keep `TODO.md` current.

## Locked decisions (Frank, 2026-09-09 — override the spec where they conflict)

- **Name: NFL Faces.** "NFL" in the name/domain still needs trademark review by Ryan and Gabriel before launch (spec §28). Not blocking the build.
- **Two wheels, single seasons, QBs only** (replaces spec §6 eras, §6.3 positions, §7 eligibility). Seasons start at **2000**. The "2000–04 Texans" style gaps derive from `teams.csv` active seasons, never hard-coded.
- **Answer rule:** the team's **passing-yards leader** for that season, per ESPN's team-leaders data. No games threshold (the spec's 16-game rule is gone). ESPN's position tag is unreliable (Tebow = TE, Pryor = WR), so "led the team in passing yards" is the definition, not the position field.
- **Current season:** the 2025+ / in-progress season uses **whoever is starting right now** (ESPN depth chart), refreshed weekly. Once a season is complete it freezes to the passing-yards leader.
- **Distractor rule:** both wrong faces must have led **some other team** in passing yards **that same season**, and must **not have thrown a pass for the rolled team that season** (checked against the full passer list, not just leaders). Distinct from each other and the answer.
- **Alumni weighting (Frank, 2026-09-09):** each distractor slot is drawn **independently**: with probability `ALUMNI_PROB` (**0.3**, Frank lowered it from 0.6 on 2026-09-09) from the _alumni pool_ (QBs who led the rolled team in a different season, if any), otherwise at random from the full distractor pool. Frank explicitly wants a **mix** — sometimes two alumni, sometimes one, sometimes none — not alumni on every face every round. This is a static rule, not difficulty ramping.
- **Repeat protection:** a person is the correct answer at most once per streak. Since every combo has one answer, combos whose answer is already used are excluded at roll time (spec §10.2 recommended option). Distractors are not repeat-protected.
- **Correct-face slot:** uniformly random each round (spec §8.2).
- **Photos: one square face crop per person, no era variants** (400×400 JPEG in `public/faces/`, head = 1.5× head-width from the ESPN alpha silhouette; non-ESPN photos need a hand-set `photo_crop` before `photo_approved`) (replaces spec §12 aspect ratio and photo-per-era). The crop is tight to the face so jerseys, logos and colors give nothing away. `photos.csv` is gone; photo fields live on the person row (`espn_id`, `photo_source`, `photo_license`, `photo_approved`).
- **Photo sources, in order: ESPN headshots** (by `espn_id`; ~100% coverage for 2010+), then **Wikimedia Commons** (automated search, license recorded), then **manual** for the remainder (~15 QBs from 2000–09). Frank explicitly accepted using ESPN headshots, which overrides the spec §12 license allow-list; the build no longer hard-fails on license, it only requires `photo_source` to be set. ESPN-image reuse and player likeness rights go on the Ryan/Gabriel legal list alongside the NFL mark.
- **Stint / pool source: ESPN core API** (`sports.core.api.espn.com`), team leaders per season 2000→ and athlete records. nflverse rejected by Frank; Pro Football Reference blocks automated fetches (403) and is out. Head-coach data not needed.
- **Team labels:** nickname only, one fixed label per franchise for all seasons. **Washington reads "Washington"** (Frank, 2026-09-09) — no Redskins/Football Team/Commanders aliases. No other franchise changed nickname since 2000, so there is no alias feature.
- **Hosting: Vercel** (Frank's existing account), not Cloudflare. Headshots start as static assets under `public/faces/` behind `VITE_IMAGE_BASE_URL`; moving them to object storage later is a config change.
- **Analytics:** event layer in `src/analytics/analytics.ts` to the spec §16 shape (`session_started`, `round_completed`, `streak_ended`, `share_clicked`, `mute_toggled`) with a **no-op backend** in production and console in dev. PostHog later = one new backend file chosen in `App.tsx`. No key in v1. Only identity is the anonymous device id.
- **Sound and haptics (spec §15):** off by default, one toggle for both, persisted in `mute`. Sounds are **synthesized with Web Audio** (`src/audio/feedback.ts`) as placeholders — swap the three `synth*` functions for recorded files when Frank delivers them.
- **Workflow:** commit to `main`, checkpoint per milestone (STREAK CITY style). **npm**, not pnpm. React 19 + Vite + TypeScript strict + Tailwind v4 + Vitest. Playwright only from M8.
- **Persistence:** device-local only (spec §13). No sign-in. No leaderboard (spec §14).
- **Share card:** text + PNG, streak + losing roll + URL, no answer face (spec §14 as written).

## Milestones (adapted from spec §26)

| #   | Milestone                 | Done when                                                                                                                                                    |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0  | Scaffold                  | `npm run dev` shows a placeholder; `npm test`, typecheck, lint green; repo on GitHub; Vercel deploy.                                                         |
| M1  | Content pipeline          | `scripts/pull-espn.ts` fills `content/*.csv`; `npm run build:content` emits `public/data/*.json` + build report; invalid CSV fails with line numbers.        |
| M2  | Game core                 | `src/game`: combos, roll selection with repeat protection, distractors with alumni weighting, slot shuffle; `npm run simulate` passes spec §20 criteria 1–4. |
| M3  | Playable loop             | State machine, static wheels, face cards, timer bar, streak counter, game over; spec §20 criteria 5–7.                                                       |
| M4  | Wheels and polish         | Reel animation, sequential stops, feedback states, reduced-motion path.                                                                                      |
| M5  | Photos                    | `scripts/process-photos.ts`: ESPN → Commons → manual list; square crops; preloading + broken-image swap.                                                     |
| M6  | Persistence and share     | Local storage, best streak, share text + PNG, Web Share API.                                                                                                 |
| M7  | Analytics, audio, haptics | Event layer (no-op backend), sounds, mute toggle, vibrate.                                                                                                   |
| M8  | Hardening                 | PWA, accessibility, performance budget, attribution page, e2e smoke.                                                                                         |
| M9  | Launch content            | Manual photo backfill complete; build report shows 100% coverage.                                                                                            |

## Conventions

- **Person key:** `espn_id` (string). `person_id` is kebab `last-first` for readability; both unique.
- **Combo key:** `{season}:{team_id}`, e.g. `2010:PIT`. Team ids are 2–3 uppercase letters.
- **Content is CSV in `/content`**, committed. The bundle in `public/data/` is generated and committed for reproducibility. Never edit the bundle by hand.
- **Full passer list vs pool:** `stints.csv` holds _every_ QB who threw for a team in a season (for distractor exclusion). `pool` membership (who can be an answer) is derived by rank at build time, never stored by hand.
- **Provider samples** live in `/samples/espn_*.json`; the pull script is built and tested against observed shapes, never assumed ones.
- **Timer:** `performance.now()`, starts on the frame the photos are painted; a tap after 0 is a timeout.
- **Broken image:** faces are chosen and preloaded at spin start; a failed load swaps in another face from the same pool. Only reroll the combo if the failure lands before wheel 1 stops.
- Timestamps UTC ISO 8601. Seasons are integers (the year the regular season starts).
- **Reproducible runs:** `?seed=123` in the URL seeds the game's rng (debugging, e2e). Production play stays random.
- **Live-season refresh:** `.github/workflows/refresh-live-season.yml` re-pulls ESPN every Tuesday, processes new faces, rebuilds, tests, and commits to `main`; Vercel deploys. It needs no secrets.
- **Gates before finishing any task:** `npm run typecheck && npm run lint && npm test && npm run simulate`; after UI work also `npm run build && npm run size && npm run e2e`.

## Phase status

- [x] Design review and decisions (2026-09-09)
- [x] M0 — Scaffold (signed off 2026-09-09)
- [x] M1 — Content pipeline (signed off 2026-09-09)
- [x] M2 — Game core (signed off 2026-09-09)
- [x] M3 — Playable loop (signed off 2026-09-09)
- [x] M4 — Wheels and polish (signed off 2026-09-09)
- [x] M5 — Photos (signed off 2026-09-09; 37 QBs from 2000–09 still need manual photos → M9)
- [x] M6 — Persistence and share (signed off 2026-09-09)
- [x] M7 — Analytics, audio, haptics (signed off 2026-09-09)
- [x] M8 — Hardening (built 2026-09-09; awaiting Frank checkpoint)
- [ ] M9 — Launch content
