# 0007 — Pro Bowl Mode

**Date:** 2026-09-09 · **Decided by:** Frank

A second game mode that never shows a photo. Three wheels: **season** (2000 → the last completed season), **player** (a QB/RB/WR/TE named to that season's Pro Bowl, replacements included), and **category**: alma mater (college logo), draft team (generated tile in era colours, or UNDRAFTED), pro number (most recent number worn), pro position (as publicly listed). Three cards, one correct. Same streak, same timer, one player at most once per streak.

- Season means the NFL season; the Pro Bowl for season S is played in January of S+1. 2026 has no Pro Bowlers until its season ends.
- UNDRAFTED is a real value: an answer for undrafted players and a possible wrong card for everyone else.
- Draft-team abbreviations are era-accurate (SD, STL, OAK, HOU for the Oilers…) with that identity's colours; `content/draft_teams.csv` is the hand-kept table. A wrong tile never reads the same as the answer tile.
- Position is allowed to be easy.
- College logos come from ESPN's college logo set for now; on the legal list with the headshots.

**Sources.** Rosters: Wikipedia Pro Bowl pages (two page formats). Attributes: ESPN athlete records first; the player's Wikipedia infobox for jersey/college gaps; the NFL draft page for the draft team (unambiguous full team name). Four names ESPN search could not find were resolved by hand from ESPN team-season leaders and are recorded as manual ids in `probowl_selections.csv`.

**Amendment (Frank, 2026-09-09):** fullbacks are not skill players here. Pro Bowl pages that list fullbacks under running backs (2013–2015) had let four in (Kuhn, Reece, Tolbert, DiMarco); the pull now drops any selection whose ESPN position is FB.

**Amendment (Frank, 2026-09-09):** the category wheel reads **Position** (not "Pro Position") and lands on it far less often than the other three. The roll picks a category by static weight (`PROBOWL_CONFIG.categoryWeights`: alma 1, draft 1, number 1, position 0.15 → about one roll in twenty), then a combo uniformly within that category. This is a fixed rule, not difficulty ramping.

**Amendment (Frank, 2026-09-09):** the Pro Number answer is the number the player wore **in the rolled season**, read from that season's Pro Bowl roster page (Terrell Owens is 81 for 2003, not his last-worn 10). ESPN's last-worn number is only a fallback when the roster page prints none.
