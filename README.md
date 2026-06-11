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
  severity and by the victim: a burn weighs by how physical the Pokemon's
  attacking stats lean, paralysis by its base Speed, while Toxic, sleep,
  freeze, and poison use flat weights (Toxic and freeze worst).
- Stat boosts on your active Pokemon count for you — setup is pressure.
- Screens and Tailwind count for you while they last.
- Each fainted Pokemon costs a little extra beyond its lost HP, because it
  also costs you options.
- Item loss: a Pokemon that has eaten its berry, popped its Air Balloon,
  or had its item knocked off fights a little weaker from then on.
- The active matchup: how hard each active Pokemon can hit the other,
  based on its revealed attacking types (plus assumed STAB and Tera type)
  against the opponent's typing.
- A speed edge, inferred from observed move order rather than base stats:
  when both actives use same-priority moves in a turn, the first mover is
  faster, period - that observation bakes in EVs, natures, and Choice
  Scarf, none of which a replay reveals directly. Until a pairing has
  been observed, the speed component stays at zero. Trick Room flips it.
- Weather, terrain, and Trick Room, credited to the side that set them
  for as long as they last (players set these up because they benefit
  from them, so setter-benefit is the reliable reading).

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
  data/
    typechart.js  type effectiveness chart (hand-written)
    dex.js        species types/Speed + move types (generated, ~90 KB)
  parser.js    battle log -> per-turn momentum snapshots + events
  analysis.js  snapshots -> turning points, lead changes, control %
  chart.js     canvas line chart with hover tooltips
  content.js   page integration: finds the log, builds the panel
  panel.css    panel styling
test/
  run.js       parser smoke test for Node (no browser needed)
tools/
  build-dex.js regenerates src/data/dex.js from Showdown's public JSON
```

When a new generation (or new species) comes out, refresh the bundled data
with `node tools/build-dex.js`.

## Testing the parser without a browser

```
curl -o battle.log https://replay.pokemonshowdown.com/gen9ou-2629425144.log
node test/run.js battle.log
```

Prints the parsed players, momentum points, faints, stats, and insights so
you can iterate on the parser or momentum formula quickly.

## What the panel shows

- The momentum chart, with faint markers and hover tooltips explaining each
  turn (contributing factors plus notable events, each with the momentum
  points it was worth).
- A "Now playing" card that follows the replay as it plays (or as you
  seek): the turn's net momentum change, each action's point swing, and
  which factors moved. A gold cursor tracks the current turn on the chart.
- A one-line verdict on how the game went.
- Turning points: the biggest momentum swings and what caused them.
- Key moments: every KO, Terastallization, and hazard set, in order.
- Head-to-head stats: KOs, direct and indirect damage, crits, status,
  hazard layers, switches, turns in control, biggest single hit, and how
  volatile the game was.
- A luck ledger: every chance event the log can prove - crits, natural
  misses (the move's real accuracy is checked, so a miss against a Fly
  turn doesn't count), full paralysis, flinches, extra sleep/freeze
  turns, confusion self-hits, and secondary-effect procs of every kind:
  status (Scald burns, Body Slam paralysis), stat changes (Shadow Ball
  drops, Meteor Mash boosts), and inflicted confusion (Hurricane) - each
  weighted by the move's listed proc chance, while deliberate effects
  (Confuse Ray, Swords Dance, Nuzzle's guaranteed paralysis) weigh
  nothing. Breaks are not all equal: each one is weighted by its
  improbability (a 1-in-24 crit outweighs a 30% burn, and a guaranteed
  effect like Nuzzle's paralysis weighs zero) times its impact (how much
  that turn actually swung momentum toward the beneficiary). The panel
  shows each player's luck-point total and the biggest breaks first.
  Accuracy works in both directions: every landed hit of an imperfect
  move earns its user a small credit (hitting 10/10 Hydro Pumps is ~11%
  odds and scores accordingly, aggregated into one "Hit 10/10" entry),
  every miss credits the defender, and playing exactly to the odds nets
  to zero. Moves blocked by Protect or that failed never rolled
  accuracy and are excluded. Damage rolls (85-100%) are the one kind of
  luck a replay cannot expose, since exact stats are hidden.
- Per-Pokemon breakdowns for both teams: damage dealt, damage taken, KOs,
  and when each one went down.

## Ideas / roadmap

- Win-condition awareness: weigh how well the Pokemon still in the back
  match up against the opponent's remaining team, not just the actives.
- Support for live battles on play.pokemonshowdown.com.
- Doubles support (the parser currently assumes singles for some stats).
