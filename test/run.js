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

console.log("players: ", JSON.stringify(parsed.players));
console.log("teamSize:", JSON.stringify(parsed.teamSize));
console.log("points:  ", parsed.points.length);
console.log(
  "first 3: ",
  JSON.stringify(parsed.points.slice(0, 3).map((p) => ({ t: p.turn, m: Math.round(p.m) })))
);
console.log(
  "last 3:  ",
  JSON.stringify(parsed.points.slice(-3).map((p) => ({ t: p.turn, m: Math.round(p.m) })))
);
console.log("faints:  ", JSON.stringify(parsed.faints));
console.log("stats:   ", JSON.stringify(parsed.stats));
console.log("winner:  ", parsed.winner);
console.log("insights:", JSON.stringify(insights, null, 2));
