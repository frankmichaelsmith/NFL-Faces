# 0002 — Answer rule, distractor rule, alumni weighting

**Date:** 2026-09-09 · **Decided by:** Frank

- **Answer:** the team's passing-yards leader for the season. No games threshold. Position tags are ignored.
- **Distractors:** led another team in passing yards the same season; never threw a pass for the rolled team that season (full passer list, not just leaders).
- **Alumni weighting:** each distractor slot independently draws from the alumni pool (QBs who led the rolled team in another season) with probability `ALUMNI_PROB` = 0.3 (Frank lowered it from the proposed 0.6 the same day), else at random. Frank wants a mix, not all-alumni every round.

**Why.** In 41% of combos the same QB led the team the season before and after, so the season wheel would otherwise be decorative. Alumni distractors are available for 64% of combos and make the year matter. It is a static rule, so it does not violate "never ramp difficulty".
