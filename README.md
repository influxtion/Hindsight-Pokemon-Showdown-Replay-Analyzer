# Hindsight

Chrome extension that overlays a momentum graph and match analysis on
[Pokemon Showdown replays](https://replay.pokemonshowdown.com). Open a
replay and a panel shows up with a turn-by-turn momentum chart, turning
points, a luck ledger, head-to-head stats, and per-Pokemon breakdowns.
It follows the replay as it plays.

## Install (developer mode)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on Developer mode.
3. Click "Load unpacked" and pick this folder.
4. Open any replay. The panel appears top right.

No build step. Edit a file, reload the extension, refresh the page.

## The momentum score

Each side gets a score per turn; momentum is the difference, clamped to
-100..+100. Positive means player 1 is ahead. The base is remaining team
HP (unrevealed Pokemon count as healthy), adjusted for:

- Hazards on your side of the field, scaled down as you run out of
  Pokemon to switch in.
- Status on living team members. Burn scales with how physical the
  victim's attack stats lean, paralysis with its base Speed. Toxic,
  sleep, freeze and poison are flat.
- Stat boosts on the active Pokemon.
- Screens and Tailwind.
- Weather, terrain and Trick Room, credited to whoever set them.
- Item loss. A Pokemon that ate its berry or got knocked off fights a
  little weaker from then on.
- A small extra penalty per fainted Pokemon.
- The active matchup: best type effectiveness of each active's revealed
  attack types (plus assumed STAB and Tera) against the other's typing.
- A speed edge, but only once move order has shown who is actually
  faster. That observation bakes in EVs and Choice Scarf, which the log
  never reveals. Trick Room flips it.

Weights live in `PSMomentum.WEIGHTS` at the top of `src/parser.js`.
Hover the chart to see which factors drive any given turn.

## Luck

Every chance event the log can prove goes in a ledger: crits, natural
misses, full paralysis, flinches, sleep and freeze turns, confusion
self-hits, and secondary procs of all kinds (Scald burns, Shadow Ball
drops, Hurricane confusion). Each break is weighted by how unlikely it
was times how much it actually swung the game. Guaranteed effects like
Nuzzle's paralysis weigh zero.

Accuracy cuts both ways: every landed hit of an inaccurate move earns
its user a small credit, every miss credits the defender, so playing
exactly to the odds nets out to zero. Hitting 10/10 Hydro Pumps does
not. Moves blocked by Protect never rolled accuracy and don't count.

Damage rolls are the one kind of luck a replay can't expose, since
exact stats are hidden.

## The panel

- Momentum chart with faint markers, hover tooltips, and a cursor that
  tracks the replay's current turn.
- A "Now playing" card: the current turn's net swing, each action's
  point value, and which factors moved.
- Verdict, turning points, and a key-moment timeline.
- Head-to-head stats drawn as share bars.
- The luck ledger, biggest breaks first.
- Per-Pokemon damage dealt/taken and KOs for both teams.

## Layout

```
src/
  data/
    typechart.js  type chart (hand-written)
    dex.js        species + move data (generated)
  parser.js    log -> momentum snapshots, stats, events
  analysis.js  snapshots -> turning points, luck weighting, control %
  chart.js     canvas chart
  content.js   page integration
  panel.css
test/
  run.js       parse one log: node test/run.js battle.log [--breakdown]
  batch.js     crash-hunt recent replays: node test/batch.js [formats]
tools/
  build-dex.js regenerate src/data/dex.js from Showdown's data
```

Get any replay's raw log by appending `.log` to its URL.

## Roadmap

- Win-condition awareness: score the Pokemon in the back against the
  opponent's remaining team, not just the actives.
- Live battles on play.pokemonshowdown.com.
- Better doubles support.
