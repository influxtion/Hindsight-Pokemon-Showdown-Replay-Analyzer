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

Each turn gets a score: player 1's total remaining team health percentage
minus player 2's. Unrevealed Pokemon count as healthy. The score ranges from
-100 to +100, where positive means player 1 is ahead and zero is dead even.

This is a deliberately simple first pass. It ignores things a player would
weigh — hazards on the field, status, stat boosts, win conditions still in the
back — so the obvious next step is enriching the formula in
`src/analysis.js` / `src/parser.js`.

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

## Ideas / roadmap

- Sync the chart cursor with the replay's current turn as it plays.
- Smarter momentum model: entry hazards, status, boosts, remaining win
  conditions.
- Per-Pokemon breakdowns (damage dealt/taken, turns on field).
- Support for live battles on play.pokemonshowdown.com.
- Doubles support (the parser currently assumes singles for some stats).
