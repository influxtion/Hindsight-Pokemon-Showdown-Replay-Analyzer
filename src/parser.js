// Parses a Showdown battle log (|command|arg|arg protocol) into per-turn
// momentum snapshots, per-Pokemon stats, and notable events.
// m = score(p1) - score(p2), clamped to -100..100. Positive = p1 ahead.
// See README for the scoring model.
window.PSMomentum = window.PSMomentum || {};

PSMomentum.WEIGHTS = {
  hazards: { stealthrock: 6, spikes: 2.5, toxicspikes: 2, stickyweb: 4 },
  field: { reflect: 2.5, lightscreen: 2.5, auroraveil: 4, tailwind: 3 },
  status: { tox: 5, psn: 2.5, brn: 4, par: 3.5, slp: 4.5, frz: 5 },
  boostPerStage: 1.5,
  boostCap: 9,
  faintedExtra: 2,
  threatPerStep: 1.5, // per doubling of type effectiveness
  speedEdge: 2.5, // needs an observed move-order fact
  weatherBonus: 2.5, // credited to the setter while active
  terrainBonus: 2.5,
  itemLost: 1.5, // living mon that used or lost its item
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
    luckEvents: [], // chance events that favored this side
  });
  const stats = { p1: newSideStats(), p2: newSideStats() };

  const points = [];
  const faints = [];
  let currentTurn = 0;
  let turnEvents = [];
  let winner = null;
  let lastMove = null; // { key, side, move }
  // hits/misses per inaccurate move; landed hits count as luck for the user
  const accUsage = { p1: {}, p2: {} }; // side -> move -> {hits, misses, acc}
  let pendingAcc = null; // { side, move }, unresolved accuracy roll

  function resolvePendingAcc(hit) {
    if (!pendingAcc) return;
    const entry = accUsage[pendingAcc.side][pendingAcc.move];
    if (entry) {
      if (hit) entry.hits++;
      else entry.misses++;
    }
    pendingAcc = null;
  }
  // Speed facts observed from move order: "fasterKey>slowerKey" entries.
  const fasterThan = new Map();
  let lastTurnMove = null; // { key, side, prio, turn }
  let weather = null; // { id, side } - side is whoever set it
  const fieldEffects = {}; // condition id -> { side }, terrains + Trick Room

  const other = (side) => (side === "p1" ? "p2" : "p1");

  // p = how unlikely the break was (0..1); guaranteed effects don't count
  function addLuck(side, text, p) {
    if (p <= 0) return;
    stats[side].luckEvents.push({ turn: currentTurn, text, p });
  }

  // 1 - secondary chance: Scald burn -> 0.7, Nuzzle para -> 0
  function procImprobability(moveName) {
    const data = PSMomentum.MOVES && PSMomentum.MOVES[normId(moveName)];
    if (data && typeof data.sc === "number") return 1 - data.sc / 100;
    return 0.7;
  }
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
        key: ident.key,
        side: ident.side,
        name: ident.name,
        species: ident.name,
        hp: 100,
        fainted: false,
        status: null,
        boosts: {},
        tera: null,
        moveTypes: {},
        itemless: false,
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
    let itemPen = 0;
    for (const mon of team) {
      hpSum += mon.hp;
      if (mon.fainted) faintedCount++;
      else {
        if (mon.status) statusPen += statusWeight(mon);
        if (mon.itemless) itemPen += W.itemLost;
      }
    }
    // unrevealed mons count as healthy
    hpSum += 100 * (size - team.length);
    const hp = hpSum / size;

    // hazards matter less with fewer switch-ins left
    const remainFrac = (size - faintedCount) / size;
    let hazardPen = 0;
    let fieldBonus = 0;
    for (const [cond, layers] of Object.entries(sideCond[side])) {
      if (W.hazards[cond]) hazardPen += W.hazards[cond] * layers * remainFrac;
      if (W.field[cond]) fieldBonus += W.field[cond];
    }
    if (weather && weather.side === side) fieldBonus += W.weatherBonus;
    for (const eff of Object.values(fieldEffects)) {
      if (eff.side === side) fieldBonus += W.terrainBonus;
    }

    // net boost stages on this side's actives
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
      itemPen,
      boostBonus,
      fieldBonus,
      faintPen,
      total:
        hp - hazardPen - statusPen - itemPen + boostBonus + fieldBonus - faintPen,
    };
  }

  function dexEntry(mon) {
    return (PSMomentum.DEX && PSMomentum.DEX[normId(mon.species)]) || null;
  }

  // brn scales with the victim's physical lean, par with its base Speed
  function statusWeight(mon) {
    const entry = dexEntry(mon);
    if (entry) {
      if (mon.status === "brn" && typeof entry.at === "number" && typeof entry.sa === "number") {
        return 2 + 4 * (entry.at / Math.max(1, entry.at + entry.sa));
      }
      if (mon.status === "par" && typeof entry.s === "number") {
        return 2 + 3 * Math.max(0, Math.min(1, (entry.s - 50) / 60));
      }
    }
    const base = W.status[mon.status];
    return base !== undefined ? base : 3;
  }

  // current typing; Tera overrides, except Stellar
  function typesOf(mon) {
    if (mon.tera && mon.tera !== "Stellar") return [mon.tera];
    const entry = dexEntry(mon);
    return entry ? entry.t : [];
  }

  function effectiveness(atkType, defTypes) {
    const row = PSMomentum.TYPECHART && PSMomentum.TYPECHART[atkType];
    if (!row) return 1;
    let mult = 1;
    for (const t of defTypes) mult *= row[t] !== undefined ? row[t] : 1;
    return mult;
  }

  // best effectiveness among revealed attack types + assumed STAB
  function threat(attacker, defender) {
    const defTypes = typesOf(defender);
    if (!defTypes.length) return 1;
    const atkTypes = new Set(Object.keys(attacker.moveTypes));
    const entry = dexEntry(attacker);
    if (entry) for (const t of entry.t) atkTypes.add(t);
    if (attacker.tera && attacker.tera !== "Stellar") atkTypes.add(attacker.tera);
    if (!atkTypes.size) return 1;
    let best = 0;
    for (const t of atkTypes) best = Math.max(best, effectiveness(t, defTypes));
    return best;
  }

  function activeMon(side) {
    for (const pos of Object.keys(active)) {
      if (!pos.startsWith(side)) continue;
      const mon = mons.get(active[pos]);
      if (mon && !mon.fainted) return mon;
    }
    return null;
  }

  function computeMomentum() {
    const s1 = sideScore("p1");
    const s2 = sideScore("p2");

    let threatDiff = 0;
    let speedDiff = 0;
    const a1 = activeMon("p1");
    const a2 = activeMon("p2");
    if (a1 && a2) {
      // log2 of the multiplier: 4x = +2 steps, immune = -3
      const steps = (x) => Math.log2(Math.max(x, 0.125));
      threatDiff = W.threatPerStep * (steps(threat(a1, a2)) - steps(threat(a2, a1)));
      if (fasterThan.has(a1.key + ">" + a2.key)) speedDiff = W.speedEdge;
      else if (fasterThan.has(a2.key + ">" + a1.key)) speedDiff = -W.speedEdge;
      // slower mon acts first under Trick Room
      if (fieldEffects.trickroom) speedDiff = -speedDiff;
    }

    return {
      m: Math.max(-100, Math.min(100, s1.total - s2.total + threatDiff + speedDiff)),
      p1Pct: s1.hp,
      p2Pct: s2.hp,
      // positive favors p1
      breakdown: {
        HP: s1.hp - s2.hp,
        Hazards: s2.hazardPen - s1.hazardPen,
        Status: s2.statusPen - s1.statusPen,
        Boosts: s1.boostBonus - s2.boostBonus,
        Field: s1.fieldBonus - s2.fieldBonus,
        Faints: s2.faintPen - s1.faintPen,
        Items: s2.itemPen - s1.itemPen,
        Matchup: threatDiff,
        Speed: speedDiff,
      },
    };
  }

  function snapshot(turn, label) {
    const state = computeMomentum();
    points.push({
      turn,
      label,
      m: state.m,
      p1Pct: state.p1Pct,
      p2Pct: state.p2Pct,
      events: turnEvents,
      breakdown: state.breakdown,
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
      // hazards/status/leech count as the opponent's indirect damage;
      // Life Orb, recoil and crash damage are self-inflicted
      if (!from.includes("item") && !from.includes("recoil") && !from.includes("highjumpkick")) {
        stats[other(ident.side)].indirectDamage += delta;
      }
      if (from === "confusion") {
        addLuck(other(ident.side), mon.name + " hurt itself in confusion", 0.67); // 33% self-hit
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
      if (delta >= 35 && attacker) {
        // disambiguate mirror species
        const sameName = attacker.name === mon.name;
        const atkName = sameName
          ? attacker.name + " (" + players[lastMove.side] + ")"
          : attacker.name;
        const defName = sameName
          ? mon.name + " (" + players[ident.side] + ")"
          : mon.name;
        turnEvents.push({
          type: "hit",
          side: lastMove.side,
          text:
            atkName + "'s " + lastMove.move + " took " +
            Math.round(delta) + "% off " + defName,
        });
      }
    }
  }

  let lineM = 0; // momentum before the current line, for per-action deltas
  for (const line of logText.split("\n")) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|"); // parts[0] is "" before the leading |
    const cmd = parts[1];
    const eventsBefore = turnEvents.length;

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
        resolvePendingAcc(true);
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
        if (!ident) break;
        resolvePendingAcc(true); // previous roll didn't miss
        lastMove = { key: ident.key, side: ident.side, move: parts[3] };
        const data = PSMomentum.MOVES && PSMomentum.MOVES[normId(parts[3])];
        if (data && data.c) getMon(ident).moveTypes[data.t] = true;
        if (data && data.a) {
          const book = accUsage[ident.side];
          if (!book[parts[3]]) book[parts[3]] = { hits: 0, misses: 0, acc: data.a };
          pendingAcc = { side: ident.side, move: parts[3] };
        }
        // first of two same-priority moves in a turn is the faster mon
        const prio = (data && data.p) || 0;
        if (
          lastTurnMove &&
          lastTurnMove.turn === currentTurn &&
          lastTurnMove.side !== ident.side &&
          lastTurnMove.prio === prio &&
          !fieldEffects.trickroom
        ) {
          fasterThan.set(lastTurnMove.key + ">" + ident.key, true);
          fasterThan.delete(ident.key + ">" + lastTurnMove.key);
        }
        lastTurnMove = { key: ident.key, side: ident.side, prio, turn: currentTurn };
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
        // self-inflicted status (Toxic Orb, Rest) carries [from]
        if (!line.includes("[from]")) {
          stats[other(ident.side)].statusInflicted++;
          // proc from a damaging move = luck; a status move is intent
          const data =
            lastMove && PSMomentum.MOVES && PSMomentum.MOVES[normId(lastMove.move)];
          if (data && data.c && lastMove.side !== ident.side) {
            addLuck(
              lastMove.side,
              mon.name + " got " + (parts[3] || "statused") + " by " + lastMove.move,
              procImprobability(lastMove.move)
            );
          }
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

      case "-enditem": {
        // berry eaten, Knock Off, balloon popped: fights itemless now
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        mon.itemless = true;
        // removal by a move is worth surfacing; eating your berry isn't
        if (/\[from\] move:/.test(line)) {
          turnEvents.push({
            type: "item",
            side: other(ident.side),
            text: mon.name + " lost its " + (parts[3] || "item"),
          });
        }
        break;
      }

      case "-item": {
        // Trick/Magician/Frisk: the holder demonstrably has an item
        const ident = parseIdent(parts[2]);
        if (ident) getMon(ident).itemless = false;
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
        // secondary stat changes (Shadow Ball drop, Meteor Mash boost) are
        // luck; status moves and 100% riders aren't
        if (!line.includes("[from]") && lastMove) {
          const md = PSMomentum.MOVES && PSMomentum.MOVES[normId(lastMove.move)];
          if (md && md.c && typeof md.sc === "number") {
            const statNames = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
            const pretty = statNames[stat] || stat;
            if (cmd === "-unboost" && lastMove.side !== ident.side) {
              addLuck(
                lastMove.side,
                mon.name + "'s " + pretty + " dropped by " + lastMove.move,
                1 - md.sc / 100
              );
            } else if (cmd === "-boost" && lastMove.key === ident.key) {
              addLuck(
                ident.side,
                mon.name + "'s " + pretty + " rose from " + lastMove.move,
                1 - md.sc / 100
              );
            }
          }
        }
        break;
      }

      case "-start": {
        // confusion from a damaging move (Hurricane) is a proc;
        // Confuse Ray is intent, [fatigue] is Outrage's own doing
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        if (
          normId(parts[3]) === "confusion" &&
          !line.includes("[fatigue]") &&
          lastMove &&
          lastMove.side !== ident.side
        ) {
          const md = PSMomentum.MOVES && PSMomentum.MOVES[normId(lastMove.move)];
          if (md && md.c) {
            addLuck(
              lastMove.side,
              getMon(ident).name + " was confused by " + lastMove.move,
              procImprobability(lastMove.move)
            );
          }
        }
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

      case "-weather": {
        if (!parts[2] || parts[2] === "none") {
          weather = null;
          break;
        }
        if (line.includes("[upkeep]")) break;
        // setter = the [of] mon (ability weather) or whoever just moved
        const of = /\[of\]\s*(p[12])/.exec(line);
        weather = {
          id: normId(parts[2]),
          side: of ? of[1] : lastMove ? lastMove.side : null,
        };
        turnEvents.push({ type: "weather", text: spaceOut(parts[2]) + " started" });
        break;
      }

      case "-fieldstart": {
        const cond = normId((parts[2] || "").replace(/^move:\s*/, ""));
        if (!cond) break;
        const of = /\[of\]\s*(p[12])/.exec(line);
        const side = of ? of[1] : lastMove ? lastMove.side : null;
        // terrains replace each other
        if (cond.endsWith("terrain")) {
          for (const k of Object.keys(fieldEffects)) {
            if (k.endsWith("terrain")) delete fieldEffects[k];
          }
        }
        fieldEffects[cond] = { side };
        const pretty = spaceOut((parts[2] || "").replace(/^move:\s*/, ""));
        turnEvents.push({ type: "field", text: pretty + " started" });
        break;
      }

      case "-fieldend":
        delete fieldEffects[normId((parts[2] || "").replace(/^move:\s*/, ""))];
        break;

      case "-terastallize": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const mon = getMon(ident);
        mon.tera = parts[3] || null;
        stats[ident.side].teras++;
        turnEvents.push({
          type: "tera",
          side: ident.side,
          text: mon.name + " Terastallized (" + (parts[3] || "?") + ")",
        });
        break;
      }

      case "-crit": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        stats[other(ident.side)].critsLanded++;
        addLuck(other(ident.side), "Critical hit on " + getMon(ident).name, 0.96); // 1/24 base rate
        turnEvents.push({
          type: "crit",
          side: other(ident.side),
          text: "Critical hit on " + getMon(ident).name,
        });
        break;
      }

      case "-miss": {
        // only natural misses (acc < 100) are luck; Fly turns and evasion aren't
        const src = parseIdent(parts[2]);
        if (!src || !lastMove) break;
        resolvePendingAcc(false);
        const data = PSMomentum.MOVES && PSMomentum.MOVES[normId(lastMove.move)];
        if (data && data.a) {
          addLuck(
            other(src.side),
            lastMove.move + " missed (" + data.a + "% accurate)",
            data.a / 100
          );
        }
        break;
      }

      case "cant": {
        const ident = parseIdent(parts[2]);
        if (!ident) break;
        const reason = normId(parts[3]);
        const name = getMon(ident).name;
        if (reason === "par") {
          addLuck(other(ident.side), name + " was fully paralyzed", 0.75);
        } else if (reason === "flinch") {
          // weight by the move's flinch chance; Fake Out's 100% weighs zero
          const p = lastMove ? procImprobability(lastMove.move) : 0.7;
          addLuck(other(ident.side), name + " flinched", p);
        } else if (reason === "slp") {
          addLuck(other(ident.side), name + " stayed asleep", 0.5);
        } else if (reason === "frz") {
          addLuck(other(ident.side), name + " stayed frozen", 0.2);
        }
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

      case "-fail":
        // never connected, no accuracy roll
        pendingAcc = null;
        break;

      case "-activate":
        // blocked by Protect etc, no accuracy roll
        if (/protect|detect|king's shield|spiky shield|baneful bunker/i.test(parts[3] || "")) {
          pendingAcc = null;
        }
        break;
    }

    // give each event this line's momentum change; skip turn boundaries
    // since snapshot() just flushed the event list
    if (cmd !== "turn" && turnEvents.length > eventsBefore) {
      const mNow = computeMomentum().m;
      const added = turnEvents.length - eventsBefore;
      for (let i = eventsBefore; i < turnEvents.length; i++) {
        turnEvents[i].delta = (mNow - lineM) / added;
      }
      lineM = mNow;
    } else if (cmd !== "turn") {
      lineM = computeMomentum().m;
    }
  }
  resolvePendingAcc(true);

  // each landed hit of an inaccurate move is worth its miss chance;
  // misses already credited the defender, so playing to the odds nets zero
  for (const side of ["p1", "p2"]) {
    for (const [move, u] of Object.entries(accUsage[side])) {
      const weight = u.hits * (1 - u.acc / 100);
      if (weight < 0.4) continue; // a single landed Hydro Pump is not a story
      let text =
        "Hit " + u.hits + "/" + (u.hits + u.misses) + " " + move +
        " (" + u.acc + "% accurate";
      if (!u.misses && u.hits >= 3) {
        text += ", ~" + Math.max(1, Math.round(100 * Math.pow(u.acc / 100, u.hits))) + "% odds";
      }
      text += ")";
      stats[side].luckEvents.push({ turn: null, text, p: weight, flat: true });
    }
  }

  // final state
  if (currentTurn > 0) {
    snapshot(currentTurn, "Turn " + currentTurn);
    snapshot(currentTurn + 1, "End");
  }

  const pokemon = { p1: sideMons("p1"), p2: sideMons("p2") };
  return { players, teamSize, format, points, stats, pokemon, faints, winner };
};
