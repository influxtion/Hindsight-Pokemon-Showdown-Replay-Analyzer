# Hindsight

A Chrome extension that overlays a momentum graph and match analysis on
[Pokemon Showdown replay pages](https://replay.pokemonshowdown.com). Open any
replay and a panel appears with a turn-by-turn momentum chart, key moments
(KOs, the biggest swing of the game), and side-by-side match stats.

## Installing (developer mode)

1. Open `chrome://extensions` in Chrome (or Edge: `edge://extensions`).
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and select this folder.
4. Open any replay, e.g. one from https://replay.pokemonshowdown.com/ — the
   panel shows up in the top right of the page.

No build step. Edit a file, hit the reload button on the extension card, and
refresh the replay page.

## How momentum is measured

Each side gets a per-turn score and momentum is the difference, clamped to
-100..+100 (positive means player 1 is ahead). The score starts from total
remaining team health (unrevealed Pokemon count as healthy) and is adjusted
for the things players actually weigh:

- Entry hazards on your side of the field (Stealth Rock, Spikes, Toxic
  Spikes, Sticky Web) count against you, scaled down as you run out of
  Pokemon to switch in.
- Status conditions on living team members count against you, weighted by
  severity (Toxic and freeze worst, regular poison least).
- Stat boosts on your active Pokemon count for you — setup is pressure.
- Screens and Tailwind count for you while they last.
- Each fainted Pokemon costs a little extra beyond its lost HP, because it
  also costs you options.

Weights live in `PSMomentum.WEIGHTS` at the top of `src/parser.js` if you
want to tune them. Hovering the chart shows which factors are driving the
score on any given turn.

## How it works

Replay pages embed the full battle log in the HTML (a
`script.battle-log-data` tag), and every replay also serves its raw log at
`<replay-url>.log`. The content script grabs that log, parses the Showdown
protocol (`|move|`, `|-damage|`, `|faint|`, ...), and renders the panel.
Nothing leaves the browser and no permissions are needed beyond running on
replay.pokemonshowdown.com.

```
src/
  parser.js    battle log -> per-turn health snapshots + events
  analysis.js  snapshots -> lead changes, biggest swing, control %
  chart.js     canvas line chart with hover tooltips
  content.js   page integration: finds the log, builds the panel
  panel.css    panel styling
test/
  run.js       parser smoke test for Node (no browser needed)
```

## Testing the parser without a browser

```
curl -o battle.log https://replay.pokemonshowdown.com/gen9ou-2629425144.log
node test/run.js battle.log
```

Prints the parsed players, momentum points, faints, stats, and insights so
you can iterate on the parser or momentum formula quickly.

## What the panel shows

- The momentum chart, with faint markers and hover tooltips explaining each
  turn (contributing factors plus notable events).
- A one-line verdict on how the game went.
- Turning points: the biggest momentum swings and what caused them.
- Key moments: every KO, Terastallization, and hazard set, in order.
- Head-to-head stats: KOs, direct and indirect damage, crits, status,
  hazard layers, switches, turns in control, biggest single hit, and how
  volatile the game was.
- Per-Pokemon breakdowns for both teams: damage dealt, damage taken, KOs,
  and when each one went down.

## Ideas / roadmap

- Sync the chart cursor with the replay's current turn as it plays.
- Speed/matchup awareness in the momentum model (who actually threatens
  whom, remaining win conditions).
- Support for live battles on play.pokemonshowdown.com.
- Doubles support (the parser currently assumes singles for some stats).
