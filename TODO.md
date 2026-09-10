# TODO — NFL Faces

## Waiting on Frank

- **Leaderboard:** sign-off on L1 + L2 (Neon is connected; live health reports `store: neon`).
- Privacy policy for email collection (legal list).

- Sign-off on Pro Bowl P3 + the 1995–1999 expansion (2026-09-09), then start P4.
- Legal list for Ryan/Gabriel: "NFL" in the name, ESPN headshot reuse, player likeness rights, college logos (ESPN set).
- Brand assets (spec §28): wordmark, icon, share-card template, recorded sounds, placeholder headshot.
- Phone play-test by two other people; Lighthouse on the live URL.

## Leaderboard — later

- Server-issued round tokens if faked scores ever show up (scores are client-reported today).
- Email verification (magic link) if the list fills with typos; a way for a player to change their name.
- Analytics backend (PostHog) so `signup_completed` / `score_posted` / `leaderboard_opened` are actually recorded.

## Pro Bowl P4 — finish

- Pro Bowl rounds in analytics `round_completed`; share copy for the mode; e2e for Pro Bowl Mode.
- Weekly refresh: run `pull:probowl` too, so a new Pro Bowl roster (February) lands on its own.

## Content backlog

- Faces: 27 QBs from 2000–09 have no licensed portrait anywhere reachable (68 combos held back; see build report).
- Pro Bowl: Joe Horn's college (Itawamba Community College) has no logo on ESPN, Commons or Wikipedia; his alma mater card reads as text until one is sourced.
- Pro Bowl: 16 1990s players have no Pro Number round because the 1996–1998 roster pages print no numbers and they wore several numbers in their careers (see build report). A curator can add a `number` to a `probowl_selections.csv` row.
- Pro Bowl: ESPN's college is wrong for ~12 retired players; the Wikipedia infobox overrides it (logged by `pull:probowl`). Review the list once.
- Curator cells: Dwayne Carswell college/logo, Zach Ertz jersey.
