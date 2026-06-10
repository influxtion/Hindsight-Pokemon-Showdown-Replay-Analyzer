// Entry point: grabs the battle log from the replay page, runs the parser
// and analysis, and injects the side panel.
(function () {
  const NS = window.PSMomentum;
  const PANEL_ID = "psm-panel";
  let lastPath = null;

  function isReplayPath(path) {
    // e.g. /gen9ou-2270001234 or /gen9randombattle-123456-abcdef
    return /^\/[a-z0-9]+-\d+(-[a-z0-9]+)?$/i.test(path);
  }

  async function getLog() {
    const el = document.querySelector("script.battle-log-data");
    if (el && el.textContent.trim()) return el.textContent;
    // Fallback: every replay also serves its raw log at <url>.log
    try {
      const res = await fetch(location.origin + location.pathname + ".log");
      if (res.ok) {
        const text = await res.text();
        if (text.includes("|")) return text;
      }
    } catch (_) {
      /* no log available */
    }
    return null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function section(parent, title) {
    const box = el("div", "psm-section");
    box.appendChild(el("div", "psm-section-title", title));
    parent.appendChild(box);
    return box;
  }

  function verdictText(parsed, insights) {
    if (parsed.winner === "tie") return "The battle ended in a tie.";
    if (!parsed.winner) return "No result recorded; the replay may be incomplete.";
    const w = parsed.players[parsed.winner];
    if (insights.comeback) {
      return w + " came back from more than 20 momentum down to win.";
    }
    if (insights.control[parsed.winner] >= 70) {
      return (
        w + " controlled this game, holding the momentum lead for " +
        insights.control[parsed.winner] + "% of it."
      );
    }
    if (insights.leadChanges >= 3) {
      return (
        "A back-and-forth game with " + insights.leadChanges +
        " lead changes; " + w + " came out on top."
      );
    }
    return w + " won a close one.";
  }

  function describeSwing(parsed, s) {
    let text =
      "Turn " + s.turn + ": " + (s.delta > 0 ? "+" : "") + Math.round(s.delta) +
      " momentum toward " + parsed.players[s.beneficiary];
    const reasons = s.events.map((ev) => ev.text);
    if (reasons.length) text += " (" + reasons.join("; ") + ")";
    return text;
  }

  function buildPanel(parsed, insights) {
    const panel = el("div", "");
    panel.id = PANEL_ID;

    const header = el("div", "psm-header");
    header.appendChild(el("span", "psm-title", "Hindsight"));
    const toggle = el("button", "psm-toggle", "–");
    toggle.addEventListener("click", () => {
      panel.classList.toggle("psm-collapsed");
      toggle.textContent = panel.classList.contains("psm-collapsed") ? "+" : "–";
    });
    header.appendChild(toggle);
    panel.appendChild(header);

    const body = el("div", "psm-body");
    panel.appendChild(body);

    const matchup = el("div", "psm-matchup");
    matchup.appendChild(el("span", "psm-p1", parsed.players.p1));
    matchup.appendChild(el("span", "psm-vs", " vs "));
    matchup.appendChild(el("span", "psm-p2", parsed.players.p2));
    body.appendChild(matchup);
    if (parsed.format) body.appendChild(el("div", "psm-format", parsed.format));

    const canvas = el("canvas", "psm-chart");
    body.appendChild(canvas);
    const legend = el("div", "psm-legend");
    legend.appendChild(el("span", "psm-p1", "Above the line: " + parsed.players.p1 + " ahead"));
    legend.appendChild(el("span", "psm-p2", "Below: " + parsed.players.p2 + " ahead"));
    body.appendChild(legend);
    body.appendChild(
      el("div", "psm-hint", "Hover the chart to see what drove each turn.")
    );

    body.appendChild(el("div", "psm-verdict", verdictText(parsed, insights)));

    // Turning points: the biggest swings of the game.
    if (insights.topSwings.length) {
      const box = section(body, "Turning points");
      const list = el("ul", "psm-list");
      for (const s of insights.topSwings) {
        list.appendChild(el("li", "", describeSwing(parsed, s)));
      }
      box.appendChild(list);
    }

    // Timeline of notable events.
    const moments = [];
    for (const p of parsed.points) {
      for (const ev of p.events) {
        if (ev.type === "faint" || ev.type === "tera" || ev.type === "hazard") {
          moments.push({ turn: p.turn, text: "Turn " + p.turn + ": " + ev.text });
        }
      }
    }
    if (moments.length) {
      const box = section(body, "Key moments");
      const list = el("ul", "psm-list");
      for (const m of moments) list.appendChild(el("li", "", m.text));
      box.appendChild(list);
    }

    // Head-to-head stats.
    const statsBox = section(body, "Match stats");
    const table = el("table", "psm-stats");
    const addRow = (label, v1, v2, cls) => {
      const tr = el("tr", cls);
      tr.appendChild(el("td", "", label));
      tr.appendChild(el("td", "psm-p1", String(v1)));
      tr.appendChild(el("td", "psm-p2", String(v2)));
      table.appendChild(tr);
    };
    const s1 = parsed.stats.p1;
    const s2 = parsed.stats.p2;
    addRow("", parsed.players.p1, parsed.players.p2, "psm-stats-head");
    addRow("KOs", s1.kos, s2.kos);
    addRow("Damage (attacks)", Math.round(s1.damageDealt) + "%", Math.round(s2.damageDealt) + "%");
    addRow(
      "Damage (hazards, status...)",
      Math.round(s1.indirectDamage) + "%",
      Math.round(s2.indirectDamage) + "%"
    );
    addRow("Crits landed", s1.critsLanded, s2.critsLanded);
    addRow("Status inflicted", s1.statusInflicted, s2.statusInflicted);
    addRow("Hazard layers set", s1.hazardsSet, s2.hazardsSet);
    addRow("Switches made", s1.switches, s2.switches);
    if (s1.teras || s2.teras) addRow("Terastallized", s1.teras, s2.teras);
    addRow("Turns in control", insights.control.p1 + "%", insights.control.p2 + "%");
    statsBox.appendChild(table);

    const hits = [s1.biggestHit, s2.biggestHit].filter(Boolean);
    if (hits.length) {
      const best = hits.reduce((a, b) => (b.dmg > a.dmg ? b : a));
      statsBox.appendChild(
        el(
          "div",
          "psm-note",
          "Biggest hit: " + best.attacker + "'s " + best.move + " took " +
            Math.round(best.dmg) + "% off " + best.target + " on turn " + best.turn + "."
        )
      );
    }
    statsBox.appendChild(
      el(
        "div",
        "psm-note",
        "Volatility: " + insights.volatility +
          " momentum per turn on average" +
          (insights.volatility >= 8 ? " - a chaotic one." : ".")
      )
    );

    // Per-Pokemon breakdown for each side.
    for (const side of ["p1", "p2"]) {
      const team = parsed.pokemon[side];
      if (!team.length) continue;
      const box = section(body, parsed.players[side] + "'s team");
      const t = el("table", "psm-stats psm-mons");
      const head = el("tr", "psm-stats-head");
      for (const h of ["", "Dealt", "Taken", "KOs"]) head.appendChild(el("td", "", h));
      t.appendChild(head);
      for (const mon of team) {
        const tr = el("tr", mon.fainted ? "psm-fainted" : "");
        const nameCell = el("td", "", mon.name);
        if (mon.fainted) nameCell.title = "Fainted on turn " + mon.faintTurn;
        tr.appendChild(nameCell);
        tr.appendChild(el("td", "", Math.round(mon.dealt) + "%"));
        tr.appendChild(el("td", "", Math.round(mon.taken) + "%"));
        tr.appendChild(el("td", "", String(mon.kos)));
        t.appendChild(tr);
      }
      box.appendChild(t);
    }

    body.appendChild(
      el(
        "div",
        "psm-footnote",
        "Damage numbers are in % of a Pokemon's max HP, so a full team is 600%."
      )
    );

    return { panel, canvas };
  }

  async function init() {
    try {
      console.log("[Hindsight] init, path =", location.pathname);
      document.getElementById(PANEL_ID)?.remove();
      if (!isReplayPath(location.pathname)) {
        console.log("[Hindsight] not a replay path, skipping");
        return;
      }

      const log = await getLog();
      console.log("[Hindsight] log:", log ? log.length + " chars" : "NOT FOUND");
      if (!log) return;

      const parsed = NS.parseReplay(log);
      console.log("[Hindsight] parsed", parsed.points.length, "points");
      if (parsed.points.length < 2) return;
      const insights = NS.analyze(parsed);

      const { panel, canvas } = buildPanel(parsed, insights);
      document.body.appendChild(panel);
      NS.renderChart(canvas, parsed);
      console.log("[Hindsight] panel rendered");
    } catch (err) {
      console.error("[Hindsight] failed:", err);
    }
  }

  // The replay site can navigate client-side, so watch for URL changes.
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      init();
    }
  }, 1000);
})();
