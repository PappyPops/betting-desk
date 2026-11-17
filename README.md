# Betting Desk

One free site for the betting tools: Line Life, Matrix, Tease Me, Eye in the Sky, with The Juice, In the Paint, Redzone, Slant and Cap'n Cash being rebuilt.

- **Site:** plain HTML/JS on GitHub Pages (this repo, no build step).
- **Data:** a free Supabase project ("Betting Desk"). `supabase/functions/sync` pulls ESPN's public scoreboards (DraftKings lines, scores, TV) every 5 minutes and logs every line change; `supabase/functions/hist` loads nflverse's open NFL game history once a day. Schedules are in `supabase/cron.sql`.
- **Cost:** $0. Supabase free tier (pauses only after 7 days with no activity; the 5-minute sync keeps it awake) and GitHub Pages.

Information only, not a sportsbook. 21+. 1-800-GAMBLER.
