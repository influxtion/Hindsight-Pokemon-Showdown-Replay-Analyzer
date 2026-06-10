// Quick parser smoke test: node test/run.js <path-to-log>
// Download a log with: curl -o battle.log https://replay.pokemonshowdown.com/<id>.log
const fs = require("fs");
const path = require("path");

// In a browser, properties of `window` are also globals; emulate that here.
global.window = global;
const root = path.join(__dirname, "..");
eval(fs.readFileSync(path.join(root, "src", "parser.js"), "utf8"));
eval(fs.readFileSync(path.join(root, "src", "analysis.js"), "utf8"));

const logPath = process.argv[2];
if (!logPath) {
  console.error("usage: node test/run.js <battle.log>");
  process.exit(1);
}

const log = fs.readFileSync(logPath, "utf8");
const parsed = window.PSMomentum.parseReplay(log);
const insights = window.PSMomentum.analyze(parsed);

const round = (o) =>
  JSON.parse(JSON.stringify(o, (k, v) => (typeof v === "number" ? Math.round(v) : v)));

console.log("players: ", JSON.stringify(parsed.players));
console.log("format:  ", parsed.format);
console.log("points:  ", parsed.points.length);
console.log(
  "momentum:",
  parsed.points.map((p) => p.turn + ":" + Math.round(p.m)).join(" ")
);
const mid = parsed.points[Math.floor(parsed.points.length / 2)];
console.log("mid breakdown (turn " + mid.turn + "):", JSON.stringify(round(mid.breakdown)));
console.log("faints:  ", JSON.stringify(parsed.faints));
console.log("stats:   ", JSON.stringify(round(parsed.stats), null, 1));
for (const side of ["p1", "p2"]) {
  console.log(side + " team:");
  for (const mon of parsed.pokemon[side]) {
    console.log(
      "  " + mon.name + "  dealt " + Math.round(mon.dealt) + "%  taken " +
        Math.round(mon.taken) + "%  kos " + mon.kos +
        (mon.fainted ? "  fainted t" + mon.faintTurn : "") +
        (mon.status ? "  status " + mon.status : "")
    );
  }
}
console.log("winner:  ", parsed.winner);
console.log("insights:", JSON.stringify(round(insights), null, 1));
