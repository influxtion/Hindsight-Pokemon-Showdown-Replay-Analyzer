// Parses a Pokemon Showdown battle log (the |command|arg|arg protocol) into
// per-turn momentum snapshots, per-Pokemon stats, and a list of notable
// events.
//
// The momentum score for a side combines:
//   - total remaining team health (the base, 0..100)
//   - entry hazards on its own field (a tax on every future switch,
//     scaled by how many Pokemon are left to switch in)
//   - status conditions on living team members
//   - stat boosts on its active Pokemon (setup = pressure)
//   - screens / Tailwind (defensive buffer and speed control)
//   - an extra penalty per fainted Pokemon (lost options)
// m = score(p1) - score(p2), clamped to -100..100. Positive = p1 ahead.
window.PSMomentum = window.PSMomentum || {};

PSMomentum.WEIGHTS = {
  hazards: { stealthrock: 6, spikes: 2.5, toxicspikes: 2, stickyweb: 4 },
  field: { reflect: 2.5, lightscreen: 2.5, auroraveil: 4, tailwind: 3 },
  status: { tox: 5, psn: 2.5, brn: 4, par: 3.5, slp: 4.5, frz: 5 },
  boostPerStage: 1.5,
  boostCap: 9,
  faintedExtra: 2,
};

PSMomentum.parseReplay = function (logText) {
  const W = PSMomentum.WEIGHTS;
  const players = { p1: "Player 1", p2: "Player 2" };
  const teamSize = { p1: 6, p2: 6 };
  let format = null;

  // key "p1:Nickname" -> mon record
  const mons = new Map();
  // position ("p1a") -> mon key, for whoever is on the field
  const active = {};
  // side -> { conditionId: layers }
  const sideCond = { p1: {}, p2: {} };

  const newSideStats = () => ({
    kos: 0,
    damageDealt: 0,
    indirectDamage: 0,
    critsLanded: 0,
    statusInflicted: 0,
    hazardsSet: 0,
    switches: 0,
    teras: 0,
    biggestHit: null,
  });
  const stats = { p1: newSideStats(), p2: newSideStats() };

  const points = [];
  const faints = [];
  let currentTurn = 0;
  let turnEvents = [];
  let winner = null;
  let lastMove = null; // { key, side, move }

  const other = (side) => (side === "p1" ? "p2" : "p1");
  const normId = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // "RainDance" -> "Rain Dance"
  const spaceOut = (s) => (s || "").replace(/([a-z])([A-Z])/g, "$1 $2");

  function parseIdent(raw) {
    const m = /^(p[12])([a-c])?:\s*(.*)$/.exec(raw || "");
    if (!m) return null;
    return {
      side: m[1],
      pos: m[1] + (m[2] || "a"),
      name: m[3],
      key: m[1] + ":" + m[3],
    };
  }

  // "84/100 brn" -> { pct: 84, status: "brn" }; "0 fnt" -> { pct: 0, ... }
  function parseHP(raw) {
    if (!raw) return null;
    const s = raw.trim();
    if (s === "0" || s.startsWith("0 fnt")) return { pct: 0, status: null };
    const m = /^(\d+)\/(\d+)(?:\s+(\w+))?/.exec(s);
    if (!m) return null;
    return {
      pct: (100 * parseInt(m[1], 10)) / parseInt(m[2], 10),
      status: m[3] && m[3] !== "fnt" ? m[3] : null,
    };
  }

  function getMon(ident) {
    if (!mons.has(ident.key)) {
      mons.set(ident.key, {
        side: ident.side,
        name: ident.name,
        species: ident.name,
        hp: 100,
        fainted: false,
        status: null,
        boosts: {},
        dealt: 0,
        taken: 0,
        kos: 0,
        switchIns: 0,
        faintTurn: null,
      });
    }
    return mons.get(ident.key);
  }

  function sideMons(side) {
    const out = [];
    for (const [key, mon] of mons) if (key.startsWith(side + ":")) out.push(mon);
    return out;
  }

  function sideScore(side) {
    const team = sideMons(side);
    const size = Math.max(teamSize[side], team.length);
    let hpSum = 0;
    let faintedCount = 0;
    let statusPen = 0;
    for (const mon of team) {
      hpSum += mon.hp;
      if (mon.fainted) faintedCount++;
      else if (mon.status) statusPen += W.status[mon.status] || 3;
    }
    // Pokemon not revealed yet are assumed healthy.
    hpSum += 100 * (size - team.length);
    const hp = hpSum / size;

    // Hazards matter less when there are fewer Pokemon left to switch in.
    const remainFrac = (size - faintedCount) / size;
    let hazardPen = 0;
    let fieldBonus = 0;
    for (const [cond, layers] of Object.entries(sideCond[side])) {
      if (W.hazards[cond]) hazardPen += W.hazards[cond] * layers * remainFrac;
      if (W.field[cond]) fieldBonus += W.field[cond];
    }

    // Net boost stages across this side's active Pokemon.
    let stages = 0;
    for (const pos of Object.keys(active)) {
      if (!pos.startsWith(side)) continue;
      const mon = mons.get(active[pos]);
      if (!mon || mon.fainted) continue;
      for (const v of Object.values(mon.boosts)) stages += v;
    }
    stages = Math.max(-W.boostCap, Math.min(W.boostCap, stages));
    const boostBonus = stages * W.boostPerStage;

    const faintPen = faintedCount * W.faintedExtra;
    return {
      hp,
      hazardPen,
      statusPen,
      boostBonus,
      fieldBonus,
      faintPen,
      total: hp - hazardPen - statusPen + boostBonus + fieldBonus - faintPen,
    };
  }

  function snapshot(turn, label) {
    const s1 = sideScore("p1");
    const s2 = sideScore("p2");
    const m = Math.max(-100, Math.min(100, s1.total - s2.total));
    points.push({
      turn,
      label,
      m,
      p1Pct: s1.hp,
      p2Pct: s2.hp,
      events: turnEvents,
      // Positive components favor p1, negative favor p2.
      breakdown: {
        HP: s1.hp - s2.hp,
        Hazards: s2.hazardPen - s1.hazardPen,
        Status: s2.statusPen - s1.statusPen,
        Boosts: s1.boostBonus - s2.boostBonus,
        Field: s1.fieldBonus - s2.fieldBonus,
        Faints: s2.faintPen - s1.faintPen,
      },
    });
    turnEvents = [];
  }

  function applyDamage(ident, hpRaw, line) {
    const mon = getMon(ident);
    const info = parseHP(hpRaw);
    if (!info) return;
    const delta = mon.hp - info.pct;
    mon.hp = info.pct;
    if (info.pct === 0) mon.fainted = true;
    if (delta <= 0) return;
    mon.taken += delta;

    const fromMatch = /\[from\]\s*([^|[]+)/.exec(line);
    if (fromMatch) {
      const from = normId(fromMatch[1]);
      // Life Orb, recoil, crash damage etc. are self-inflicted; everything
      // else (hazards, status, Leech Seed, weather) counts as indirect
      // damage credited to the opponent.
      if (!from.includes("item") && !from.includes("recoil") && !from.includes("highjumpkick")) {
        stats[other(ident.side)].indirectDamage += delta;
      }
    } else if (lastMove && lastMove.side !== ident.side) {
      const attacker = mons.get(lastMove.key);
      if (attacker) attacker.dealt += delta;
      const atkStats = stats[lastMove.side];
      atkStats.damageDealt += delta;
      if (!atkStats.biggestHit || delta > atkStats.biggestHit.dmg) {
        atkStats.biggestHit = {
          dmg: delta,
          move: lastMove.move,
          attacker: attacker ? attacker.name : "?",
          target: mon.name,
          turn: currentTurn,
        };
      }
      // Heavy hits are momentum events in their own right.
      if (delta >= 35 && attacker) {
        turnEvents.push({
          type: "hit",
          side: lastMove.side,
          text:
            attacker.name + "'s " + lastMove.move + " took " +
            Math.round(delta) + "% off " + mon.name,
        });
      }
    }
  }

  for (const line of logText.split("\n")) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|"); // parts[0] is "" before the leading |
    const cmd = parts[1];

    switch (cmd) {
      case "player":
        if ((parts[2] === "p1" || parts[2] === "p2") && parts[3]) {
          players[parts[2]] = parts[3];
        }
        break;

      case "teamsize":
        if (parts[2] === "p1" || parts[2] === "p2") {
          teamSize[parts[2]] = parseInt(parts[3], 10) || 6;
        }
        break;

      case "tier":
        format = parts[2] || null;
        break;

      case "turn": {
        const n = parseInt(parts[2], 10);
        if (currentTurn > 0) {
          snapshot(currentTurn, "Turn " + currentTurn);
        } else {
          turnEvents = []; // discard lead-switch noise before turn 1
          snapshot(0, "Start");
        }
        currentTurn = n;
        lastMove = null;
        break;
      }

      case "switch":
      case "drag":
      case "replace": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        if (parts[3]) mon.species = parts[3].split(",")[0];
        const info = parseHP(parts[4]);
        if (info) {
          mon.hp = info.pct;
          mon.status = info.status; // also clears (e.g. Natural Cure)
          if (info.pct === 0) mon.fainted = true;
        }
        mon.boosts = {};
        active[ident.pos] = ident.key;
        mon.switchIns++;
        if (cmd === "switch" && currentTurn > 0) stats[ident.side].switches++;
        break;
      }

      case "move": {
        const ident = parseIdent(parts[2]);
        if (ident) lastMove = { key: ident.key, side: ident.side, move: parts[3] };
        break;
      }

      case "-damage": {
        const ident = parseIdent(parts[2]);
        if (ident) applyDamage(ident, parts[3], line);
        break;
      }

      case "-heal":
      case "-sethp": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        const info = parseHP(parts[3]);
        if (info) {
          mon.hp = info.pct;
          if (info.status) mon.status = info.status; // e.g. Rest
        }
        break;
      }

      case "faint": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        mon.hp = 0;
        mon.fainted = true;
        mon.faintTurn = currentTurn;
        stats[other(ident.side)].kos++;
        if (lastMove && lastMove.side !== ident.side) {
          const attacker = mons.get(lastMove.key);
          if (attacker) attacker.kos++;
        }
        faints.push({ turn: currentTurn, side: ident.side, name: mon.name });
        turnEvents.push({
          type: "faint",
          side: ident.side,
          text: mon.name + " (" + players[ident.side] + ") fainted",
        });
        break;
      }

      case "-status": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        mon.status = parts[3] || null;
        // Self-inflicted status (Toxic Orb, Flame Orb, Rest) carries [from].
        if (!line.includes("[from]")) {
          stats[other(ident.side)].statusInflicted++;
          turnEvents.push({
            type: "status",
            side: other(ident.side),
            text: mon.name + " was inflicted with " + (parts[3] || "status"),
          });
        }
        break;
      }

      case "-curestatus": {
        const ident = parseIdent(parts[2]);
        if (ident) getMon(ident).status = null;
        break;
      }

      case "-boost":
      case "-unboost": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        const stat = parts[3];
        const amt = (parseInt(parts[4], 10) || 0) * (cmd === "-boost" ? 1 : -1);
        mon.boosts[stat] = Math.max(-6, Math.min(6, (mon.boosts[stat] || 0) + amt));
        break;
      }

      case "-setboost": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        getMon(ident).boosts[parts[3]] = parseInt(parts[4], 10) || 0;
        break;
      }

      case "-clearboost":
      case "-clearpositiveboost":
      case "-clearnegativeboost": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        if (cmd === "-clearboost") mon.boosts = {};
        else {
          const keepNeg = cmd === "-clearpositiveboost";
          for (const k of Object.keys(mon.boosts)) {
            if (keepNeg ? mon.boosts[k] > 0 : mon.boosts[k] < 0) delete mon.boosts[k];
          }
        }
        break;
      }

      case "-clearallboost":
        for (const key of Object.values(active)) {
          const mon = mons.get(key);
          if (mon) mon.boosts = {};
        }
        break;

      case "-sidestart": {
        const side = (parts[2] || "").slice(0, 2);
        if (side !== "p1" && side !== "p2") break;
        const cond = normId((parts[3] || "").replace(/^move:\s*/, ""));
        const caps = { spikes: 3, toxicspikes: 2 };
        const max = caps[cond] || 1;
        sideCond[side][cond] = Math.min(max, (sideCond[side][cond] || 0) + 1);
        const pretty = spaceOut((parts[3] || "").replace(/^move:\s*/, ""));
        if (W.hazards[cond]) {
          stats[other(side)].hazardsSet++;
          turnEvents.push({
            type: "hazard",
            side: other(side),
            text: pretty + " set on " + players[side] + "'s side",
          });
        } else if (W.field[cond]) {
          turnEvents.push({
            type: "field",
            side,
            text: players[side] + " set up " + pretty,
          });
        }
        break;
      }

      case "-sideend": {
        const side = (parts[2] || "").slice(0, 2);
        if (side !== "p1" && side !== "p2") break;
        delete sideCond[side][normId((parts[3] || "").replace(/^move:\s*/, ""))];
        break;
      }

      case "-weather":
        if (!line.includes("[upkeep]") && parts[2] && parts[2] !== "none") {
          turnEvents.push({ type: "weather", text: spaceOut(parts[2]) + " started" });
        }
        break;

      case "-fieldstart": {
        const pretty = spaceOut((parts[2] || "").replace(/^move:\s*/, ""));
        if (pretty) turnEvents.push({ type: "field", text: pretty + " started" });
        break;
      }

      case "-terastallize": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        stats[ident.side].teras++;
        turnEvents.push({
          type: "tera",
          side: ident.side,
          text: getMon(ident).name + " Terastallized (" + (parts[3] || "?") + ")",
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
          text: "Critical hit on " + getMon(ident).name,
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

  const pokemon = { p1: sideMons("p1"), p2: sideMons("p2") };
  return { players, teamSize, format, points, stats, pokemon, faints, winner };
};
