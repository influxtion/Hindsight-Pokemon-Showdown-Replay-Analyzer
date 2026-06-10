// Parses a Pokemon Showdown battle log (the |command|arg|arg protocol) into
// per-turn team-health snapshots plus a list of notable events.
//
// Output shape:
// {
//   players: { p1: "Name", p2: "Name" },
//   teamSize: { p1: 6, p2: 6 },
//   points:  [ { turn, label, p1Pct, p2Pct, m, events: [event] } ],
//   stats:   { p1: sideStats, p2: sideStats },
//   faints:  [ { turn, side, name } ],
//   winner:  "p1" | "p2" | "tie" | null
// }
// `m` is the momentum score: p1 team health % minus p2 team health %, so it
// ranges -100..100 with positive meaning player 1 is ahead.
window.PSMomentum = window.PSMomentum || {};

PSMomentum.parseReplay = function (logText) {
  const players = { p1: "Player 1", p2: "Player 2" };
  const previewCount = { p1: 0, p2: 0 };
  const teamSize = { p1: 6, p2: 6 };
  // key "p1:Nickname" -> { hp: 0..100, fainted: bool }
  const mons = new Map();
  const points = [];
  const faints = [];
  const newSideStats = () => ({
    kos: 0,
    damageDealt: 0,
    critsLanded: 0,
    statusInflicted: 0,
    teras: 0,
  });
  const stats = { p1: newSideStats(), p2: newSideStats() };

  let currentTurn = 0;
  let turnEvents = [];
  let winner = null;

  function parseIdent(raw) {
    // "p1a: Garchomp" -> { side: "p1", name: "Garchomp", key: "p1:Garchomp" }
    const m = /^(p[12])[a-c]?:\s*(.*)$/.exec(raw || "");
    if (!m) return null;
    return { side: m[1], name: m[2], key: m[1] + ":" + m[2] };
  }

  function parseHP(raw) {
    // "78/100", "45/100 tox", "0 fnt" -> percentage 0..100, or null
    if (!raw) return null;
    const s = raw.trim();
    if (s === "0" || s.startsWith("0 fnt")) return 0;
    const m = /^(\d+)\/(\d+)/.exec(s);
    if (m) return (100 * parseInt(m[1], 10)) / parseInt(m[2], 10);
    return null;
  }

  function getMon(ident) {
    if (!mons.has(ident.key)) mons.set(ident.key, { hp: 100, fainted: false });
    return mons.get(ident.key);
  }

  function teamPct(side) {
    let sum = 0;
    let seen = 0;
    for (const [key, mon] of mons) {
      if (key.startsWith(side + ":")) {
        sum += mon.hp;
        seen++;
      }
    }
    const size = Math.max(teamSize[side], seen);
    // Pokemon not revealed yet are assumed healthy.
    sum += 100 * (size - seen);
    return sum / size;
  }

  function snapshot(turn, label) {
    const p1Pct = teamPct("p1");
    const p2Pct = teamPct("p2");
    points.push({
      turn,
      label,
      p1Pct,
      p2Pct,
      m: p1Pct - p2Pct,
      events: turnEvents,
    });
    turnEvents = [];
  }

  function setHP(ident, hpRaw, attributeDamage) {
    const mon = getMon(ident);
    const hp = parseHP(hpRaw);
    if (hp === null) return;
    const delta = mon.hp - hp;
    mon.hp = hp;
    if (hp === 0) mon.fainted = true;
    if (attributeDamage && delta > 0) {
      const attacker = ident.side === "p1" ? "p2" : "p1";
      stats[attacker].damageDealt += delta;
    }
  }

  const other = (side) => (side === "p1" ? "p2" : "p1");

  for (const line of logText.split("\n")) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|"); // parts[0] is "" before the leading |
    const cmd = parts[1];

    switch (cmd) {
      case "player":
        if (parts[2] === "p1" || parts[2] === "p2") {
          if (parts[3]) players[parts[2]] = parts[3];
        }
        break;

      case "poke":
        if (parts[2] === "p1" || parts[2] === "p2") previewCount[parts[2]]++;
        break;

      case "teamsize":
        if (parts[2] === "p1" || parts[2] === "p2") {
          teamSize[parts[2]] = parseInt(parts[3], 10) || 6;
        }
        break;

      case "turn": {
        // Snapshot the state at the start of each turn.
        const n = parseInt(parts[2], 10);
        if (currentTurn > 0) {
          snapshot(currentTurn, "Turn " + currentTurn);
        } else {
          turnEvents = []; // discard lead-switch noise before turn 1
          snapshot(0, "Start");
        }
        currentTurn = n;
        break;
      }

      case "switch":
      case "drag":
      case "replace": {
        const ident = parseIdent(parts[2]);
        if (ident) setHP(ident, parts[4], false);
        break;
      }

      case "-damage": {
        const ident = parseIdent(parts[2]);
        if (ident) setHP(ident, parts[3], true);
        break;
      }

      case "-heal":
      case "-sethp": {
        const ident = parseIdent(parts[2]);
        if (ident) setHP(ident, parts[3], false);
        break;
      }

      case "faint": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        mon.hp = 0;
        mon.fainted = true;
        stats[other(ident.side)].kos++;
        faints.push({ turn: currentTurn, side: ident.side, name: ident.name });
        turnEvents.push({
          type: "faint",
          side: ident.side,
          text: ident.name + " (" + players[ident.side] + ") fainted",
        });
        break;
      }

      case "-crit": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        stats[other(ident.side)].critsLanded++;
        turnEvents.push({
          type: "crit",
          side: other(ident.side),
          text: "Critical hit on " + ident.name,
        });
        break;
      }

      case "-status": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        // Self-inflicted status (Toxic Orb, Flame Orb, rest) carries a [from] tag.
        if (!line.includes("[from]")) {
          stats[other(ident.side)].statusInflicted++;
          turnEvents.push({
            type: "status",
            side: other(ident.side),
            text: ident.name + " was inflicted with " + (parts[3] || "status"),
          });
        }
        break;
      }

      case "-terastallize": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        stats[ident.side].teras++;
        turnEvents.push({
          type: "tera",
          side: ident.side,
          text: ident.name + " Terastallized (" + (parts[3] || "?") + ")",
        });
        break;
      }

      case "win": {
        const name = (parts[2] || "").trim();
        if (name === players.p1) winner = "p1";
        else if (name === players.p2) winner = "p2";
        break;
      }

      case "tie":
        winner = "tie";
        break;
    }
  }

  // Capture the post-battle state as a final point.
  if (currentTurn > 0) {
    snapshot(currentTurn, "Turn " + currentTurn);
    snapshot(currentTurn + 1, "End");
  }

  if (previewCount.p1 > 0) teamSize.p1 = Math.max(teamSize.p1, previewCount.p1);
  if (previewCount.p2 > 0) teamSize.p2 = Math.max(teamSize.p2, previewCount.p2);

  return { players, teamSize, points, stats, faints, winner };
};
