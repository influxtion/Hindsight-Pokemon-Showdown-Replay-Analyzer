// Crash hunt: parse many recent replays across formats and report failures.
// Usage: node test/batch.js [format ...]
const fs = require("fs");
const path = require("path");

global.window = global;
const root = path.join(__dirname, "..");
for (const f of ["data/typechart.js", "data/dex.js", "parser.js", "analysis.js"]) {
  eval(fs.readFileSync(path.join(root, "src", f), "utf8"));
}

const formats = process.argv.slice(2);
if (!formats.length) {
  formats.push(
    "gen9ou", "gen9randombattle", "gen9vgc2026regfbo3", "gen9ubers",
    "gen9doublesou", "gen9monotype", "gen9nationaldex"
  );
}

async function main() {
  let pass = 0;
  let fail = 0;
  for (const format of formats) {
    let list;
    try {
      const res = await fetch(
        "https://replay.pokemonshowdown.com/search.json?format=" + format
      );
      list = await res.json();
    } catch (e) {
      console.log(format + ": search failed (" + e.message + ")");
      continue;
    }
    for (const item of list.slice(0, 5)) {
      try {
        const res = await fetch("https://replay.pokemonshowdown.com/" + item.id + ".log");
        const log = await res.text();
        const parsed = window.PSMomentum.parseReplay(log);
        const insights = window.PSMomentum.analyze(parsed);
        if (parsed.points.length < 2) {
          console.log("SKIP  " + item.id + " (points=" + parsed.points.length + ")");
        } else {
          pass++;
        }
        void insights;
      } catch (e) {
        fail++;
        console.log("FAIL  " + item.id + ": " + e.stack.split("\n").slice(0, 3).join(" | "));
      }
    }
    console.log("done: " + format);
  }
  console.log("\npassed " + pass + ", failed " + fail);
}

main();
