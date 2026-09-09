# NFL Streak Game — Product & Technical Specification

**Version:** 1.2
**Owner:** Frank Michael Smith, Rhino Studios
**Audience:** Sam (implementation)
**Status:** Ready for build. Items marked **[assumption]** are proposed defaults, not confirmed decisions; everything else is decided.

---

## Table of contents

1. Overview
2. Goals and non-goals
3. Definitions
4. Game rules
5. Round loop and timing
6. Wheels
7. Eligibility rules
8. Face selection algorithm
9. Data model
10. Precomputation and validity
11. UI and interaction
12. Photos
13. Persistence and accounts
14. Sharing
15. Audio and haptics
16. Analytics
17. Content pipeline and admin tooling
18. Edge cases and failure handling
19. Performance, platform, and accessibility
20. Acceptance criteria
21. Open questions

**Part II — Build setup**

22. Technology stack
23. Repository layout and CLAUDE.md
24. Content input formats
25. Seed data plan
26. Milestones
27. Environments, deployment, and configuration
28. Assets and brand
29. Definition of ready

---

## 1. Overview

A fast, endless, mobile-first web game. Each round, three slot-machine-style wheels land on an **era**, a **team**, and a **position**. Three headshots appear beneath the wheels. The player has **5 seconds** to tap the one person who matches all three filters. A correct tap starts the next round automatically. The score is the number of consecutive correct answers — the **streak**. A wrong tap or a timeout ends the streak.

**Example round:** wheels land on _2010–14 · Steelers · QB_. The faces shown are Ben Roethlisberger, Matthew Stafford, and Joe Flacco. Roethlisberger is the only correct answer.

The core loop is roughly 8 seconds per round: ~3 seconds of wheel animation, up to 5 seconds of decision time.

---

## 2. Goals and non-goals

### Goals

- A one-thumb, sub-10-second loop that is instantly understood without instructions.
- Rounds that are always fair: exactly one correct answer, distractors that are plausible but verifiably wrong.
- A shareable end state that drives organic acquisition.
- A data model that can grow (more eras, more positions) without a rewrite.

### Non-goals for v1

- Difficulty ramping of any kind.
- Daily challenges, limited attempts, or shared seeds.
- Global leaderboards.
- Native apps. This is a web app.

---

## 3. Definitions

| Term                 | Meaning                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| **Roll**             | One (era, team, position) triple produced by the wheels.                        |
| **Era**              | A five-year season window (e.g. 2010–14).                                       |
| **Combo**            | Synonym for roll when discussing the data, e.g. "the 2005–09 Bengals RB combo". |
| **Person**           | A player or head coach in the database.                                         |
| **Stint**            | One person's association with one team for one season, with a games count.      |
| **Answer**           | The person who correctly matches the roll in a given round.                     |
| **Distractor**       | One of the two incorrect faces shown in a round.                                |
| **Streak**           | Consecutive correct rounds since the last miss or game start.                   |
| **Answerable combo** | A roll that has at least one valid answer and at least two valid distractors.   |

---

## 4. Game rules

| Rule              | Decision                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Objective         | Longest streak of consecutive correct answers.                                                    |
| Mode              | Endless. No daily cap, no lives, no cooldowns.                                                    |
| Streak ends on    | A wrong tap, **or** the 5-second timer expiring with no tap.                                      |
| After a miss      | Reveal the correct face and name, show the final streak, offer "New streak".                      |
| Difficulty        | Flat. Timer length, distractor selection, and obscurity never change with streak length.          |
| Randomness        | Every roll is random, for every player, every time. There is no daily seed and no fixed sequence. |
| Repeat protection | A person may not be the **correct answer** more than once within a single streak.                 |
| Input             | First tap is final. No undo, no changing the selection.                                           |
| Obscurity         | Some rolls will produce lesser-known answers. This is acceptable and intended.                    |

---

## 5. Round loop and timing

### State machine

```
IDLE ──(tap Start)──▶ SPINNING ──(all wheels landed)──▶ REVEAL
                                                            │
                                            photos shown, timer starts
                                                            │
                                                            ▼
                                                       AWAITING_TAP
                                       ┌──────────────┬─────┴───────────┐
                              tap correct       tap wrong          timer hits 0
                                    │                │                    │
                                    ▼                ▼                    ▼
                               CORRECT          MISS(wrong)          MISS(timeout)
                                    │                └────────┬───────────┘
                             streak += 1                      ▼
                                    │                      GAME_OVER
                                    ▼                         │
                               SPINNING ◀─────(tap New streak)─┘
```

### Timing budget per round

| Phase                          | Duration                  | Notes                                                                      |
| ------------------------------ | ------------------------- | -------------------------------------------------------------------------- |
| Wheel 1 (era) spin + land      | ~1.0 s                    | Starts immediately on round start.                                         |
| Wheel 2 (team) spin + land     | ~1.0 s                    | Starts when wheel 1 lands.                                                 |
| Wheel 3 (position) spin + land | ~1.0 s                    | Starts when wheel 2 lands.                                                 |
| Photo reveal                   | ≤ 150 ms **[assumption]** | Photos are preloaded during the spin; reveal is a fade or pop, not a load. |
| Decision timer                 | 5.0 s exactly             | Starts the moment photos are fully visible. Bar drains linearly.           |
| Correct feedback               | ~300 ms **[assumption]**  | Green highlight on the chosen card, streak counter ticks up.               |
| Transition to next round       | 0 ms                      | Next spin begins immediately after feedback. No tap required.              |

Wheels stop **sequentially, left to right**, never simultaneously. The roll is chosen _before_ the animation starts (see §10); the animation is purely presentational.

### Timer precision

- Use a monotonic clock (`performance.now()`), not `setTimeout` alone, so a background tab or a dropped frame cannot give the player extra time.
- Timer starts on the frame the photos are painted, not when the request to show them is issued.
- A tap arriving after the timer reaches 0 is treated as a timeout, not a late answer.

---

## 6. Wheels

### 6.1 Era wheel

| Label   | Seasons                      |
| ------- | ---------------------------- |
| 1990–94 | 1990, 1991, 1992, 1993, 1994 |
| 1995–99 | 1995–1999                    |
| 2000–04 | 2000–2004                    |
| 2005–09 | 2005–2009                    |
| 2010–14 | 2010–2014                    |
| 2015–19 | 2015–2019                    |
| 2020–24 | 2020–2024                    |
| 2025+   | 2025 onward, open-ended      |

- "2025+" grows automatically as seasons are added to the stint table.
- **Contingency:** if 1990s headshots are not available at acceptable quality and coverage, the wheel starts at 2000–04. The era list must be configuration, not code, so this is a one-line change.

### 6.2 Team wheel

- All **32 franchises active today**, including those that have relocated. Each franchise is one continuous identity across its full history.
- Labels are **nickname only**: "Rams" (not "LA Rams" / "St. Louis Rams"), "Raiders", "Chargers", "Titans" (covers the Oilers years), "Commanders" (covers Redskins and Washington Football Team years).
- The **Browns** are one franchise. Seasons 1990–95 and 1999–present belong to the same team; 1996–98 do not exist.

### 6.3 Position wheel

`QB`, `RB`, `WR`, `TE`, `HC` (head coach). No other positions in v1.

### 6.4 Expansion gaps (never rolled)

| Team     | Missing seasons | Effect on eras                                                                       |
| -------- | --------------- | ------------------------------------------------------------------------------------ |
| Panthers | before 1995     | 1990–94 never rolled                                                                 |
| Jaguars  | before 1995     | 1990–94 never rolled                                                                 |
| Browns   | 1996–1998       | 1995–99 still rollable (1995 and 1999 exist) but heavily thinned by the 16-game rule |
| Texans   | before 2002     | 1990–94 and 1995–99 never rolled; 2000–04 contains only 2002–04                      |

These gaps are derived from `team.active_seasons`, not hard-coded.

### 6.5 Why the wheels are not truly independent

If each wheel were an independent random draw, the game would produce unanswerable rolls (1990–94 Texans QB). Instead, the game picks a random **answerable combo** from a precomputed set (see §10), then animates each wheel landing on that combo's values. The player experience is indistinguishable from independent wheels, but every roll is guaranteed to be fair.

**[assumption]** Selection is uniform across answerable combos, not across teams or eras. This means eras with more teams active (2005+) appear slightly more often than 1990–94. If Frank prefers uniform-by-era, that is a one-line weighting change.

---

## 7. Eligibility rules

### 7.1 Answer eligibility

A person is a valid **answer** for combo _(era, team, position)_ if **all** of the following hold:

1. The person is in the curated database (see §7.4).
2. The person has stints with `team` at `position` in seasons within `era`.
3. The sum of `games` across those stints is **≥ 16**.
4. A photo exists for that person tagged for that era.
5. The person has not already been the correct answer in the current streak.

For head coaches, `games` means games as head coach of that team in that season.

### 7.2 Games are counted within the window

The 16-game threshold is evaluated **per era window**, not across the whole time a person spent with the team.

> Example: a running back with 10 games for the Bills in 2014 and 40 games in 2015–17 qualifies as a 2015–19 Bills RB, but **not** as a 2010–14 Bills RB.

### 7.3 Multi-team and multi-role people

- Store **every** stint. A person can be the answer for many combos. Joe Flacco qualifies for Ravens across multiple eras and for later teams where he reached 16 games.
- A person who was a player in one era and a head coach in another (Doug Pederson) is modeled with two roles and two era-appropriate photos. The QB role and the HC role are evaluated independently.
- A player who changed positions (rare) has the position recorded per season in the stint table; eligibility follows the season-level position.

### 7.4 Curation

The database is deliberately curated, not scraped wholesale.

- Backups and fringe players are excluded at data-entry time, even if they technically reach 16 games in a window.
- The bar is "a serious fan could recognize this face", not "famous".
- Curation decisions live in a single `included` flag on `person` so they can be reversed without deleting data.

---

## 8. Face selection algorithm

Input: the rolled combo _(era, team, position)_ and the set of person IDs already used as answers in this streak (`used`).

```
answers      = precomputed.answers[era][team][position]  minus used
distractors  = precomputed.distractors[era][team][position]

if |answers| == 0:                      # cannot happen if §10 is correct, but guard anyway
    reroll a different answerable combo

answer       = random_choice(answers)
d1, d2       = random_sample(distractors, 2)   # distinct, and neither equals answer
slots        = shuffle([answer, d1, d2])       # correct face in a random slot
show(slots)
```

### 8.1 Distractor rules (decided)

Both distractors must:

- Be the **same position** as the roll.
- Be from the **same era window** as the roll (i.e. qualify at that position for _some_ team in that era).
- Be from a **different team** — specifically, they must **not qualify as an answer** for the rolled combo. This is checked against the person's full stint list, not a "primary team" field.
- Be distinct from each other and from the answer.

**[assumption]** Distractors are _not_ subject to repeat protection. A person can appear as a wrong face in multiple rounds of one streak; only correct answers are protected.

### 8.2 Correct face placement

The correct face occupies a uniformly random slot (left / center / right) each round. Do not alternate or pattern the placement.

### 8.3 Same roll, different faces

A roll defines two pools, not a fixed trio. The same roll on another day, or later in the same session, draws fresh from both pools and will usually show different faces. This is intended and should be preserved — do not cache a "canonical" set of three faces per combo.

---

## 9. Data model

### `team`

| Field          | Type       | Notes                                                          |
| -------------- | ---------- | -------------------------------------------------------------- |
| id             | string     | e.g. `PIT`                                                     |
| label          | string     | Nickname only, e.g. "Steelers"                                 |
| active_seasons | int ranges | e.g. Browns: `[1946–1995, 1999–]`. Drives expansion-gap logic. |

### `era`

| Field      | Type        | Notes                                                     |
| ---------- | ----------- | --------------------------------------------------------- |
| id         | string      | e.g. `E2010`                                              |
| label      | string      | "2010–14", "2025+"                                        |
| start_year | int         |                                                           |
| end_year   | int or null | null = open-ended                                         |
| enabled    | bool        | Allows disabling 1990–94 / 1995–99 without deleting data. |

### `person`

| Field        | Type   | Notes                                                     |
| ------------ | ------ | --------------------------------------------------------- |
| id           | string |                                                           |
| display_name | string | Shown on reveal after a miss.                             |
| included     | bool   | Curation flag. `false` removes the person from all pools. |
| notes        | string | Free text for curators (why included/excluded).           |

### `stint`

One row per (person, team, season, role). The source of truth for eligibility.

| Field     | Type | Notes                                                                   |
| --------- | ---- | ----------------------------------------------------------------------- |
| person_id | fk   |                                                                         |
| team_id   | fk   | Franchise id, never era-specific.                                       |
| season    | int  |                                                                         |
| position  | enum | QB / RB / WR / TE / HC                                                  |
| games     | int  | Games played (players) or games coached (HC) for that team that season. |

### `photo`

| Field       | Type   | Notes                                                         |
| ----------- | ------ | ------------------------------------------------------------- |
| id          | string |                                                               |
| person_id   | fk     |                                                               |
| era_id      | fk     | Which window this photo represents the person in.             |
| asset_path  | string | Normalized, cropped copy hosted by Rhino. Never hotlinked.    |
| source_url  | string | Where it came from.                                           |
| license     | string | e.g. `CC BY-SA 4.0`, `public domain`. Required, not optional. |
| attribution | string | Author credit if the license requires it.                     |
| approved    | bool   | Curator sign-off on crop quality and face-only framing.       |

### Derived: `answerable_combo` (see §10)

| Field                     | Notes              |
| ------------------------- | ------------------ |
| era_id, team_id, position | composite key      |
| answer_ids                | list of person ids |
| distractor_ids            | list of person ids |

---

## 10. Precomputation and validity

Eligibility is never computed at request time. A build step regenerates the answerable-combo table whenever stints, photos, or curation flags change.

### 10.1 Derivation

For every (era, team, position) where `team` has at least one active season inside `era`:

- **answers** = persons where `included = true`, `SUM(games) ≥ 16` over stints with matching team, position, and season within the era, and an `approved` photo exists for that era.
- **distractors** = persons where `included = true`, an `approved` photo exists for that era, at least one _qualifying_ (≥ 16 games) stint exists at that position in that era for some team ≠ `team`, and the person is **not** in `answers` for this combo.
- The combo is **answerable** iff `|answers| ≥ 1` and `|distractors| ≥ 2`.

### 10.2 Repeat protection interaction

The game must also handle the case where all answers for a combo have been used in the current streak. Two options; pick one:

- **[assumption, recommended]** When choosing a roll, exclude combos whose entire `answers` list is a subset of `used`. This keeps every roll answerable and never wastes a spin.
- Alternative: allow the roll and fall back to a reroll if no answer remains. Simpler, but produces a visible double-spin.

### 10.3 Build output

- Emit a static JSON bundle (`combos.json`, `people.json`, `photos.json`) the client can load once. At v1 scale (≈ 1,000 combos, a few thousand people) this is well under 1 MB and avoids a backend round-trip per round.
- Include a build hash so the client can cache aggressively and invalidate on content updates.
- Emit a build report: number of answerable combos per era, combos with only one answer, persons with no approved photo, persons with stints but `included = false`. This is the curator's to-do list.

---

## 11. UI and interaction

### 11.1 Layout (portrait, mobile-first)

```
┌──────────────────────────────┐
│   Streak: 12         [mute]  │
├──────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐  │
│  │2010– │ │Steel-│ │  QB  │  │   ← three wheels, equal width
│  │  14  │ │ ers  │ │      │  │
│  └──────┘ └──────┘ └──────┘  │
├──────────────────────────────┤
│  ████████████░░░░░░░░░░░░░░  │   ← 5 s timer bar
├──────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐  │
│  │ face │ │ face │ │ face │  │   ← headshot cards, full-card tap targets
│  └──────┘ └──────┘ └──────┘  │
└──────────────────────────────┘
```

- Wheels: rendered as vertical reels with motion blur while spinning and a hard mechanical stop. Each wheel lands with a tick.
- Faces: identical aspect ratio (**[assumption]** 3:4), identical crop, no names, no logos.
- Timer bar: full width, drains left-to-right or right-to-left consistently; **[assumption]** shifts to a warning color at 1.0 s remaining.
- Streak counter: always visible, animates on increment.
- Landscape / desktop: same three-column structure, centered, max width ~720 px **[assumption]**.

### 11.2 Screens

| Screen    | Contents                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start     | Title, one-line explanation ("Tap the face that matches all three"), best streak (if any), Start button, mute toggle.                               |
| Play      | As diagrammed above.                                                                                                                                |
| Game over | Correct face highlighted with name, the losing roll ("2005–09 · Bengals · RB"), final streak, best streak, **Share** button, **New streak** button. |

### 11.3 Feedback states

| Event     | Visual                                                                                      |
| --------- | ------------------------------------------------------------------------------------------- |
| Correct   | Chosen card highlights (green), streak increments, ~300 ms, then next spin.                 |
| Wrong tap | Chosen card highlights red, correct card highlights green, name appears under correct card. |
| Timeout   | Timer bar flashes, correct card highlights green, name appears.                             |

### 11.4 Input handling

- The entire card is the tap target; minimum 44 pt touch height.
- Register on `pointerdown`, not `click`, to shave latency.
- Ignore taps during SPINNING and GAME_OVER states except on the explicit buttons.
- Debounce: after the first tap in AWAITING_TAP, ignore all further taps until the next round.

---

## 12. Photos

### Requirements

- Face visible, **no helmet**. Sunglasses and hats acceptable **[assumption]** if the face is clearly identifiable.
- One approved photo per (person, era) is the target. Minimum: one photo per person, with era-specific photos wherever appearance changed substantially or the role changed (Pederson as QB vs. as HC).
- No visible team logos or jersey text in the final crop where avoidable. If a jersey must remain, crop tight enough that the team is not readable.
- Normalized output: same aspect ratio, same face framing, same resolution (**[assumption]** 600×800 source, served at 2× for the card size).

### Sourcing and licensing

- "Publicly available" is not the same as "licensed for commercial use." Team sites, Getty, and AP images are not usable without a license.
- Wikimedia Commons is the primary source. Coverage is strong for notable 2000s+ players and coaches and thin for the 1990s — this is the reason the 1990s eras are conditional.
- Every photo row must carry `source_url`, `license`, and `attribution`. Ship an attribution page listing all CC-licensed images with author credit.
- Never hotlink. Download, crop, and host normalized copies.

---

## 13. Persistence and accounts

**Decision: device-local for v1, no sign-in.**

- Store in local storage: `best_streak`, `total_rounds`, `total_streaks`, `mute`, `first_played_at`, and an anonymous `device_id` (UUID generated on first load).
- No login wall anywhere. A sign-in gate on an 8-second game will kill retention.
- If Rhino already has an auth system (e.g. from GeoSports), it can be added later as an **optional** "Save your streak across devices" prompt shown only after a strong run, never before play.
- Best streak is compared and updated at game over. Ties do not overwrite `best_streak_roll`.

---

## 14. Sharing

**Decision: share card yes, global leaderboard no.**

Rationale: rolls are random per player, so a global leaderboard would measure volume of attempts rather than skill and would invite disputes. Sharing, by contrast, is the primary acquisition channel.

### Share card contents

- Streak number, large.
- The roll that ended it, e.g. "Died on 2005–09 · Bengals · RB".
- Game name and URL.
- **[assumption]** Do **not** include the correct answer's face or name — it keeps the card spoiler-free and avoids redistributing licensed images.

### Formats

- **Text** (clipboard / native share sheet): e.g.
  `NFL Streak 🏈 12 in a row. Died on 2005–09 Bengals RB. [url]`
- **Image**: rendered client-side to a PNG at 1080×1080 **[assumption]** for Instagram/TikTok stories, plus 1200×630 for link previews.
- Use the Web Share API where available; fall back to copy-to-clipboard and a download button.

### Future (not v1)

- Friends comparison via shared link (see each other's best streak). Skill-neutral enough to be fair without a shared seed.

---

## 15. Audio and haptics

**Decision: minimal, default-off on mobile web, user-toggleable.**

| Event           | Sound                 | Haptic                    |
| --------------- | --------------------- | ------------------------- |
| Each wheel stop | Short mechanical tick | Single light pulse        |
| Correct         | Short rising chime    | None **[assumption]**     |
| Wrong / timeout | Low thud              | One longer buzz (~150 ms) |

- Default off because mobile browsers block autoplay until a user gesture and behavior is inconsistent across iOS/Android.
- Mute toggle on the start screen and persistently in the play screen header.
- Preload all three sounds on the first user gesture (the Start tap).
- Haptics via `navigator.vibrate` where supported; silently no-op elsewhere.

---

## 16. Analytics

**Decision: PostHog, event-per-round plus session events.** Rhino already uses PostHog, so no new vendor.

### Events

**`round_completed`** — one per round

| Property                  | Type                            | Notes                                     |
| ------------------------- | ------------------------------- | ----------------------------------------- |
| era_id, team_id, position | string                          | The roll.                                 |
| answer_id                 | string                          | Correct person.                           |
| distractor_ids            | [string]                        | The two wrong faces.                      |
| answer_slot               | 0/1/2                           | Where the correct face sat.               |
| tapped_slot               | 0/1/2 or null                   | null on timeout.                          |
| outcome                   | `correct` / `wrong` / `timeout` |                                           |
| time_to_tap_ms            | int or null                     | From photo reveal to tap.                 |
| streak_position           | int                             | 1-indexed round number within the streak. |
| build_hash                | string                          | Content bundle version.                   |

**`streak_ended`** — one per game over

| Property      | Notes               |
| ------------- | ------------------- |
| streak_length |                     |
| end_reason    | `wrong` / `timeout` |
| is_new_best   | bool                |

**`session_started`**, **`share_clicked`** (with `format`), **`mute_toggled`**.

### Questions this answers

- Which combos are unfair (abnormally high miss rate)?
- Which distractors are too easy (never tapped) or too hard (tapped more than the answer)?
- Is 5 seconds right? (distribution of `time_to_tap_ms`)
- Where do players quit, and how many streaks per session?
- Does share rate correlate with streak length?

### Privacy

- Anonymous `device_id` only. No PII in v1. If accounts are added later, identify the PostHog user at sign-in.

---

## 17. Content pipeline and admin tooling

### Data entry

- Stints can be bulk-imported from a stats source (Frank's existing RapidAPI feeds may cover games-played by season; verify before building against it).
- Curation (`included`, `notes`) and photo approval are manual and should live in a simple admin table — a spreadsheet synced to the build step is acceptable for v1; a lightweight internal page is better.

### Build step

Run on every content change. Outputs the static bundle (§10.3) and the build report.

### Build report checks (fail the build on the first two)

1. Any combo in the answerable set with fewer than two distractors.
2. Any photo referenced without `license` set.
3. Persons with qualifying stints but no approved photo (warning).
4. Combos with exactly one answer (informational — these are the "always Flacco" combos).
5. Count of answerable combos per era and per position.

---

## 18. Edge cases and failure handling

| Situation                                               | Handling                                                                                                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All answers for a rolled combo already used this streak | Prevented at roll selection (§10.2).                                                                                                                                                |
| Photo fails to load                                     | Preload all three during the spin; if any fails to load before the wheels land, silently reroll the round before reveal. Never show a broken image.                                 |
| Tab backgrounded mid-timer                              | Timer keeps running on the monotonic clock; on return, if time is up, treat as timeout.                                                                                             |
| Player taps during spin                                 | Ignored.                                                                                                                                                                            |
| Two taps in quick succession                            | Only the first registers.                                                                                                                                                           |
| Offline after initial load                              | Game continues from the cached bundle and cached images; analytics queue locally and flush on reconnect.                                                                            |
| Bundle version changes mid-session                      | Finish the current streak on the old bundle; load the new one on the next "New streak".                                                                                             |
| Very long streak exhausts most combos                   | Not a v1 concern; at ~1,000 combos with several answers each, a streak would need to be in the hundreds. If it happens, the roll selection simply keeps excluding exhausted combos. |
| Person has stints but `included = false`                | Excluded from both answer and distractor pools.                                                                                                                                     |

---

## 19. Performance, platform, and accessibility

### Performance targets **[assumption]**

- First playable ≤ 2 s on 4G.
- Wheel animation at 60 fps on a mid-range Android device.
- Photo preloading complete before wheel 3 lands in ≥ 95% of rounds.
- Content bundle ≤ 1 MB gzipped; images lazy-fetched and cached via a service worker.

### Platform

- Mobile Safari (iOS 16+) and Chrome on Android are the primary targets. Desktop Chrome/Safari/Firefox secondary.
- Portrait-first; landscape and desktop use the same layout, centered.
- Installable as a PWA **[assumption]** — cheap to add and improves return rate.

### Accessibility

- `prefers-reduced-motion`: replace reel spin with a quick crossfade; keep the sequential stop cadence.
- All buttons keyboard-operable; face cards focusable with keys 1/2/3 mapped to slots **[assumption]**.
- Color-blind-safe correct/wrong states: pair color with iconography (check / cross), not color alone.
- Timer bar has an `aria-live` countdown announcement at 3 s and 1 s **[assumption]**.

---

## 20. Acceptance criteria

The build is done when all of the following are true:

1. Every roll produced in 10,000 simulated rounds is answerable and shows exactly one correct face.
2. Both distractors in every simulated round share the roll's position and era and do not qualify for the rolled combo.
3. No person appears as the correct answer twice within any simulated streak.
4. The correct face's slot is uniformly distributed across 10,000 rounds (no slot outside 30–37%).
5. Wheels land sequentially left → right in ~1 s each; the timer starts only after all three photos are painted.
6. A tap at 5.01 s is a timeout; a tap at 4.99 s is scored.
7. Wrong tap and timeout both reveal the correct face and name and offer "New streak".
8. Best streak persists across page reloads on the same device.
9. Share produces both a text string and a PNG with streak, losing roll, and URL.
10. Every served photo has `license`, `source_url`, and `approved = true`.
11. `round_completed` fires with all listed properties on every round outcome.
12. Sound and haptics are off by default and toggleable; the toggle persists.

---

## 21. Open questions

Non-blocking, but worth a decision before launch:

1. **Era weighting** — uniform across answerable combos (default) or uniform across eras? (§6.5)
2. **Distractor repeat protection** — none (default) or also protect distractors within a streak? (§8.1)
3. **Share card design** — include a branded Rhino Studios / FMS treatment? Any tie-in to the GeoSports share style?
4. **1990s go/no-go** — decide after a photo-coverage audit of 1990–99 qualifying persons on Wikimedia.
5. **Stats source** — confirm whether the existing RapidAPI feed provides games-played by season for 1990+ and head-coach game counts, or whether stints are entered manually.

---

# Part II — Build setup

Everything in Part II is a recommendation intended to let Sam start a Claude Code project without further decisions. Each choice is reversible; the reasoning is stated so it can be overridden deliberately.

---

## 22. Technology stack

Guiding principle: the game is a static bundle plus images. There is no server logic in v1, so the stack should be as thin as the requirements allow.

| Layer           | Choice                                                                                            | Rationale                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript (strict)                                                                               | Eligibility logic and the data model benefit from types; Claude Code produces markedly better code with a type checker in the loop.                                 |
| Framework       | React 18 with Vite                                                                                | No server rendering needed. Vite builds fast, produces a small bundle, and keeps the project readable for a single developer. Next.js is more than this game needs. |
| Styling         | Tailwind CSS                                                                                      | Fast iteration on a small UI; utility classes keep the wheel/card layout in one place. No component library.                                                        |
| Animation       | CSS transforms + `requestAnimationFrame`                                                          | Reels are transform-based for 60 fps; no animation library required. Framer Motion is acceptable if Sam prefers it, but not necessary.                              |
| State           | React state + a small reducer for the round state machine (§5)                                    | The state machine is the whole game; a reducer makes the transitions explicit and testable. No Redux/Zustand.                                                       |
| Data            | Static JSON bundle generated at build time (§10.3)                                                | No database, no API.                                                                                                                                                |
| Build script    | Node + TypeScript (`scripts/build-content.ts`)                                                    | Reads CSVs, validates, emits JSON and the build report.                                                                                                             |
| Tests           | Vitest + React Testing Library; Playwright for one end-to-end smoke test                          | Vitest matches Vite; the acceptance criteria in §20 map directly to unit tests over the selection logic.                                                            |
| Linting         | ESLint + Prettier, defaults                                                                       | Keep configuration minimal.                                                                                                                                         |
| Analytics       | `posthog-js`                                                                                      | Existing Rhino vendor.                                                                                                                                              |
| Images          | Sharp (in the build script) for crop/normalize; served from Cloudflare R2 behind Cloudflare's CDN | R2 has no egress fees, which matters for an image-heavy game with viral share spikes.                                                                               |
| Hosting         | Cloudflare Pages                                                                                  | Static hosting, global CDN, free tier is more than sufficient, pairs with R2. Vercel is an equally good alternative if Rhino already uses it.                       |
| PWA             | `vite-plugin-pwa`                                                                                 | Adds installability and the service-worker caching in §19 with minimal code.                                                                                        |
| Package manager | pnpm                                                                                              | Faster, stricter; any is fine.                                                                                                                                      |

**Explicitly not used in v1:** a backend, a database, authentication, server-side rendering, a CMS.

---

## 23. Repository layout and CLAUDE.md

### 23.1 Layout

```
nfl-streak/
├── CLAUDE.md                  # Claude Code project brief (below)
├── README.md                  # Setup and commands for humans
├── docs/
│   ├── spec.md                # This document
│   └── decisions/             # One short file per notable decision (ADR style)
├── content/                   # Curated source data, committed to git
│   ├── teams.csv
│   ├── eras.csv
│   ├── people.csv
│   ├── stints.csv
│   └── photos.csv
├── raw-photos/                # Downloaded originals, gitignored (large); manifest in photos.csv
├── scripts/
│   ├── build-content.ts       # CSV → public/data/*.json + build report
│   ├── process-photos.ts      # raw-photos → normalized crops → R2 upload
│   └── simulate.ts            # Runs N rounds against the bundle to verify §20 criteria
├── public/
│   ├── data/                  # Generated JSON bundle (committed for reproducibility)
│   └── sounds/
├── src/
│   ├── game/                  # Pure logic, no React: roll selection, face selection, timer
│   ├── state/                 # Round state machine reducer
│   ├── components/            # Wheel, ReelStrip, FaceCard, TimerBar, StreakCounter, screens
│   ├── analytics/
│   ├── share/                 # Text + PNG card rendering
│   └── storage/               # Local persistence
├── tests/
└── e2e/
```

Rule: everything under `src/game/` is framework-free and fully unit-tested. The React layer only renders state and dispatches events. This is what makes the acceptance criteria in §20 verifiable by `pnpm test` rather than by hand.

### 23.2 CLAUDE.md (draft)

```markdown
# NFL Streak — Claude Code brief

## What this is

A mobile-first web game. Three slot-machine wheels pick (era, team, position);
the player taps the one of three headshots that matches, within 5 seconds.
Score is the streak. Full spec: docs/spec.md — read it before changing game logic.

## Stack

TypeScript (strict), React 18, Vite, Tailwind, Vitest, Playwright, pnpm.
Static site; no backend. Content is CSV in /content, compiled to JSON by
`pnpm build:content`. Images live in Cloudflare R2.

## Commands

pnpm dev # local dev server
pnpm build:content # CSV → public/data/*.json + build report (run after any content change)
pnpm simulate # 10k-round simulation; must pass before merging game-logic changes
pnpm test # unit tests
pnpm e2e # Playwright smoke test
pnpm build # production build

## Non-negotiable rules

- Game logic lives in src/game and has no React imports. Keep it pure and tested.
- The roll is chosen BEFORE the wheels animate. Never animate first.
- Every round has exactly one correct face; distractors share position + era and must not
  qualify for the rolled combo. See spec §8.
- The 5 s timer starts when photos are painted and uses performance.now().
- Do not add auth, a database, or a server. v1 is static.
- Do not hotlink images or add photos without license + source in content/photos.csv.
- Do not ramp difficulty. Ever.

## Working style

- Work milestone by milestone (spec §26). Open one PR per milestone.
- Before finishing a task: run `pnpm test` and `pnpm simulate`; both must be green.
- Prefer small, boring solutions. No new dependencies without a one-line justification
  in the PR description.
- When the spec is ambiguous, ask rather than guess; record the answer in docs/decisions/.
```

---

## 24. Content input formats

All files are UTF-8 CSV with a header row, committed under `/content`. The build script validates every file and fails with line-numbered errors. IDs are stable strings, never auto-incremented numbers, so rows can be edited in a spreadsheet safely.

### `teams.csv`

| Column          | Type   | Example     | Rules                                                                             |
| --------------- | ------ | ----------- | --------------------------------------------------------------------------------- |
| team_id         | string | `PIT`       | 2–3 uppercase letters, unique.                                                    |
| label           | string | `Steelers`  | Nickname only.                                                                    |
| active_from     | int    | `1933`      | First season.                                                                     |
| inactive_ranges | string | `1996-1998` | Optional. Semicolon-separated `YYYY-YYYY` ranges. Only the Browns use this in v1. |

### `eras.csv`

| Column     | Type   | Example   | Rules                                                         |
| ---------- | ------ | --------- | ------------------------------------------------------------- |
| era_id     | string | `E2010`   | Unique.                                                       |
| label      | string | `2010–14` | Shown on the wheel.                                           |
| start_year | int    | `2010`    |                                                               |
| end_year   | int    | `2014`    | Empty for open-ended.                                         |
| enabled    | bool   | `true`    | `false` removes the era from the wheel without deleting rows. |

### `people.csv`

| Column       | Type   | Example              | Rules                                                                                 |
| ------------ | ------ | -------------------- | ------------------------------------------------------------------------------------- |
| person_id    | string | `roethlisberger-ben` | Kebab-case `last-first`, unique. Append a disambiguator if needed (`smith-steve-wr`). |
| display_name | string | `Ben Roethlisberger` |                                                                                       |
| included     | bool   | `true`               | Curation flag.                                                                        |
| notes        | string |                      | Free text; why included/excluded.                                                     |

### `stints.csv`

| Column    | Type | Example              | Rules                                       |
| --------- | ---- | -------------------- | ------------------------------------------- |
| person_id | fk   | `roethlisberger-ben` | Must exist in people.csv.                   |
| team_id   | fk   | `PIT`                | Must exist in teams.csv.                    |
| season    | int  | `2013`               | Must fall inside the team's active seasons. |
| position  | enum | `QB`                 | One of QB, RB, WR, TE, HC.                  |
| games     | int  | `16`                 | 0–17 for players; 0–17 for HC.              |

One row per person-team-season-position. A player traded mid-season has two rows for that season.

### `photos.csv`

| Column      | Type   | Example                             | Rules                                                                                                                                                  |
| ----------- | ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| photo_id    | string | `roethlisberger-ben-E2010`          | Convention: `person_id-era_id`.                                                                                                                        |
| person_id   | fk     |                                     |                                                                                                                                                        |
| era_id      | fk     |                                     |                                                                                                                                                        |
| source_url  | url    | `https://commons.wikimedia.org/...` | Required.                                                                                                                                              |
| license     | string | `CC BY-SA 2.0`                      | Required. Must match an allow-list in the build script (`public domain`, `CC0`, `CC BY *`, `CC BY-SA *`). Non-commercial and ND licenses are rejected. |
| attribution | string | `Photo by Jane Doe`                 | Required for CC BY licenses.                                                                                                                           |
| raw_file    | string | `roethlisberger-ben-E2010.jpg`      | Filename in `/raw-photos`.                                                                                                                             |
| crop        | string | `0.32,0.10,0.68,0.58`               | Optional normalized face box `x1,y1,x2,y2` used by process-photos.ts. Empty = auto-detect.                                                             |
| approved    | bool   | `true`                              | Curator sign-off.                                                                                                                                      |

### Validation rules enforced by `build:content`

- Referential integrity across all foreign keys.
- No stint season outside the team's active seasons.
- No duplicate (person, team, season, position).
- Every `approved` photo has a license on the allow-list and a raw file that exists.
- Every answerable combo has ≥ 2 distractors (hard fail).
- Report, not fail: persons with qualifying stints but no approved photo; combos with exactly one answer; era/position coverage counts.

---

## 25. Seed data plan

Build and test against **one fully populated era first**, then widen.

| Phase  | Scope                                                                | Purpose                                                                                                                               |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Seed 0 | 3 teams × 5 positions × 1 era, placeholder faces                     | Unblocks all engineering work on day one. Placeholder faces are generated solid-color cards with initials.                            |
| Seed 1 | Era **2015–19**, all 32 teams, all 5 positions, real licensed photos | First end-to-end playable build. Chosen because it has the best Wikimedia coverage and the most recognizable names.                   |
| Seed 2 | 2020–24 and 2025+                                                    | Recent eras; highest recognition, easiest sourcing.                                                                                   |
| Seed 3 | 2010–14, 2005–09, 2000–04                                            | Working backward; sourcing effort rises each step.                                                                                    |
| Seed 4 | 1995–99, 1990–94                                                     | Go/no-go after a coverage audit: if fewer than ~70 % of qualifying persons have a licensable photo, leave the era disabled at launch. |

**Stint sourcing.** Games-played by season is public and stable; confirm whether the existing RapidAPI feed exposes it back to 1990 (and head-coach game counts, which most player feeds omit). If not, Pro-Football-Reference-style data entered manually for the curated pool is realistic: the curated set is a few hundred people per era, not every roster.

**Photo sourcing workflow.** Search Wikimedia Commons by name → confirm license on the allow-list → record `source_url`, `license`, `attribution` → download to `/raw-photos` → set a face crop if auto-detect is poor → mark `approved` after visual review. Budget roughly 3–5 minutes per photo; Seed 1 is on the order of 300–400 photos.

---

## 26. Milestones

Each milestone is one PR, ends in a green `pnpm test` + `pnpm simulate`, and is independently demoable.

| #   | Milestone                 | Deliverable                                                                                                          | Done when                                                         |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| M0  | Scaffold                  | Repo, CLAUDE.md, Vite/React/TS/Tailwind, CI running tests, Cloudflare Pages preview deploys                          | `pnpm dev` shows a placeholder; every PR gets a preview URL.      |
| M1  | Content pipeline          | CSV schemas, `build:content`, validation, build report, Seed 0 data                                                  | Bundle emitted; invalid CSV fails with a useful message.          |
| M2  | Game core                 | `src/game`: answerable-combo set, roll selection with repeat protection, face selection, slot shuffle; `simulate.ts` | §20 criteria 1–4 pass in simulation.                              |
| M3  | Playable loop             | State machine, static (non-animated) wheels, face cards, timer bar, streak counter, game-over screen                 | Full loop playable with placeholder faces; §20 criteria 5–7 pass. |
| M4  | Wheels and polish         | Reel animation, sequential stops, feedback states, reduced-motion path                                               | Feels like a slot machine; 60 fps on a mid-range Android.         |
| M5  | Photos                    | `process-photos.ts`, R2 upload, preloading during spin, broken-image reroll                                          | Seed 1 playable with real faces.                                  |
| M6  | Persistence and share     | Local storage, best streak, share text + PNG, Web Share API                                                          | §20 criteria 8–9 pass.                                            |
| M7  | Analytics, audio, haptics | PostHog events, sound files, mute toggle, `navigator.vibrate`                                                        | §20 criteria 11–12 pass.                                          |
| M8  | Hardening                 | PWA, accessibility pass, performance budget, attribution page, e2e smoke test                                        | All §19 targets met; Lighthouse ≥ 90 on mobile.                   |
| M9  | Launch content            | Seeds 2–3 loaded; Seed 4 go/no-go                                                                                    | Build report shows target coverage.                               |

Suggested order of attack for Claude Code: M0 → M1 → M2 → M3 in one focused stretch (these are mostly pure logic and are where Claude Code is strongest), then M4 with a human reviewing feel on a real phone.

---

## 27. Environments, deployment, and configuration

### Environments

| Env        | Purpose                                     | URL pattern                     |
| ---------- | ------------------------------------------- | ------------------------------- |
| Local      | `pnpm dev`                                  | localhost                       |
| Preview    | Every PR, auto-deployed by Cloudflare Pages | `<branch>.nfl-streak.pages.dev` |
| Production | `main` branch                               | final domain                    |

### Configuration (`.env.example`)

```
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_IMAGE_BASE_URL=https://images.<domain>/
VITE_BUILD_HASH=            # injected by CI from git SHA
R2_ACCOUNT_ID=              # build scripts only, never shipped to the client
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=nfl-streak-images
```

### CI (GitHub Actions)

1. Install, typecheck, lint.
2. `pnpm build:content` — fails on validation errors.
3. `pnpm test` and `pnpm simulate`.
4. `pnpm build`; Cloudflare Pages deploys the output.
5. On `main` only: `process-photos` for any new approved photos, upload to R2.

### Release process

- Squash-merge per milestone.
- Content-only changes (new CSV rows, new photos) follow the same path; the build report is posted as a PR comment so curators can see coverage change.

---

## 28. Assets and brand

### Name

"NFL Streak" is a working title only. **Using "NFL" in the product name, logo, or domain should be reviewed with Ryan and Gabriel before launch**; the league polices its marks actively. Recommended direction: a name that signals football without the mark — e.g. _Gridiron Streak_, _Face Value_, _Roster Roulette_, _Snap Streak_ — with "NFL" used only descriptively in copy if counsel clears it. Reserve domain and social handles at the same time as the name decision.

### Visual direction

- **Tone:** broadcast-scoreboard, not casino. The slot-machine mechanic is the motion language; the palette and type should read as sports, not gambling, especially given Rhino's fantasy-sports positioning.
- **Palette:** one deep neutral background (near-black navy), one high-contrast accent for the streak counter and correct state, a distinct warning color for the timer's final second, and a neutral for cards. Avoid any single NFL team's colors as the brand accent.
- **Type:** a condensed, heavy display face for the streak number and wheel labels (a sports-numeral feel), paired with a clean grotesque for body copy. Two families maximum.
- **Wheels:** brushed-metal reel strips with a subtle vignette; labels large enough to read mid-blur on a 375 pt wide screen.
- **Face cards:** uniform 3:4, slight rounding, no drop shadows on the photos themselves (they vary in quality; shadows make that variance more visible). A thin border that changes color on correct/wrong.

### Deliverables needed from Frank / a designer before M4

| Asset                 | Format                                         | Notes                                                             |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Logo / wordmark       | SVG                                            | Light-on-dark and dark-on-light.                                  |
| App icon              | 512×512 PNG + maskable variant                 | For PWA and share previews.                                       |
| Share card template   | Figma or PNG mockups at 1080×1080 and 1200×630 | Streak, losing roll, URL, wordmark.                               |
| Three sounds          | WAV or OGG, < 100 ms tick, < 400 ms chime/thud | Placeholder sounds are acceptable until M7; licensed or original. |
| Placeholder headshot  | 600×800 PNG                                    | Neutral silhouette for dev and for broken-image fallback.         |
| Color and type tokens | Tailwind config or a short doc                 | Lets Claude Code apply the brand consistently.                    |

---

## 29. Definition of ready

Claude Code can start M0 today. Before **M5** (real photos) the following must exist:

- [ ] Stack confirmed (or the defaults in §22 accepted).
- [ ] Product name decided, domain reserved, trademark question sent to Ryan/Gabriel.
- [ ] Seed 1 stints entered in `stints.csv` (2015–19, all teams, all positions).
- [ ] Seed 1 photos sourced, licensed, and approved in `photos.csv`.
- [ ] Cloudflare account with Pages + R2 bucket created; credentials in CI secrets.
- [ ] PostHog project created; key in `.env`.
- [ ] Brand tokens and placeholder headshot delivered.

Before **launch**:

- [ ] Seeds 2–3 loaded; Seed 4 go/no-go decided.
- [ ] Attribution page live.
- [ ] Share card design final.
- [ ] Sounds final.
- [ ] Manual play-test on iOS Safari and Android Chrome by at least two people who did not build it.

---

## Change log

| Version | Date       | Changes                                                                                                                                                                      |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-09-08 | Initial spec from design conversation.                                                                                                                                       |
| 1.1     | 2026-09-08 | Resolved §13–16 (persistence, sharing, audio, analytics). Added state machine, timing budget, precomputation, edge cases, acceptance criteria, admin tooling, accessibility. |
| 1.2     | 2026-09-09 | Added Part II — Build setup: stack, repo layout and CLAUDE.md, CSV input formats, seed data plan, milestones, environments and CI, assets and brand, definition of ready.    |
