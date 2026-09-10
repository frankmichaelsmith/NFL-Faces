# 0009 — NBA mode

**Date:** 2026-09-10 · **Decided by:** Frank

A second sport inside the same app, chosen with a slider on the home screen (NFL | NBA). Same game: season → player → category, three cards, 6 seconds, one streak.

**Choices (Frank, 2026-09-10):**

- **Pool:** per season since 1995, the **top 40 by points per game plus the top 5 by rebounds and top 5 by assists** who are not already in, from ESPN's league leaders (ESPN's own games-played qualifiers apply). Not All-Star based. Extras can be added by hand later, as for the NFL.
- **Season label:** the year the season **ends** (2016 = 2015–16).
- **Categories:** Alma Mater, Draft Team, Jersey Number, **Birthplace** (flag tile; Frank renamed it from Country on 2026-09-10 — Kyrie Irving reads Australia on purpose) — Birthplace replaces Position.
- **Leaderboard:** one sign-in, **a separate daily board per sport**.

**Data.** `scripts/pull-nba.ts` → `content/nba_selections.csv` + `content/nba_players.csv` (Pro Bowl columns plus `country`, `country_name`, `country_source`). Draft teams: `content/nba_draft_teams.csv`, a hand table of era identities (Sonics, Vancouver, Bullets, original Hornets…) matched by the draft-season team name ESPN returns. Countries: `content/nba_countries.csv` maps ESPN and Wikipedia spellings and demonyms to a flag code; the flag images come from the MIT-licensed flag-icons set (`npm run nba:assets` → `public/flags/{code}.png`). Birthplace order of truth: a curator's manual value, ESPN's birthplace, then the Wikipedia infobox birth_place. The pull lists players whose ESPN citizenship differs from their birthplace, for information only.

**Jersey numbers.** Season-accurate, from the roster tables on Wikipedia's team-season pages ("2003–04 Los Angeles Lakers season": Kobe 8), read for every franchise and season by `pull:nba`. A player listed with two numbers in one season (traded) gets no number round that season; a player missing from every roster table falls back to the one-number-career rule. ESPN's own records only carry the current number.

**No college.** 60 of 358 players never played college basketball (international, high school). They answer Alma Mater with a **NONE** tile (Frank, 2026-09-10), which is a wrong card for everyone else — the UNDRAFTED pattern.

**Milestones:** **N1 data** (this) · **N2 engine + config** (mode `nba`, weights, generic pool key) · **N3 screens** (sport slider, flag cards, per-sport board and daily stats, share copy) · **N4 finish** (e2e, legal list: the NBA mark).
