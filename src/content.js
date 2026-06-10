// Entry point: grabs the battle log from the replay page, runs the parser
// and analysis, and injects the side panel.
(function () {
  const NS = window.PSMomentum;
  const PANEL_ID = "psm-panel";
  let lastPath = null;

  function isReplayPath(path) {
    // Replay ids are dash-joined: format-number (/gen9ou-2270001234),
    // server-format-number (/smogtours-gen5ou-59402), and private replays
    // append a password segment (/gen9ou-123456-abc...pw).
    return /^\/([a-z0-9]+-)+\d+(-[a-z0-9]+)?$/i.test(path);
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

  function section(parent, title, titleClass) {
    const box = el("div", "psm-section");
    box.appendChild(el("div", "psm-section-title" + (titleClass ? " " + titleClass : ""), title));
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

  // A label row with the two players' values, over a single bar split in
  // their colors by share. Reads at a glance instead of as a table row.
  function metricRow(label, n1, n2, d1, d2) {
    const row = el("div", "psm-metric");
    const head = el("div", "psm-metric-head");
    head.appendChild(el("span", "psm-p1", d1 !== undefined ? d1 : String(n1)));
    head.appendChild(el("span", "psm-metric-label", label));
    head.appendChild(el("span", "psm-p2", d2 !== undefined ? d2 : String(n2)));
    row.appendChild(head);
    const bar = el("div", "psm-bar");
    const fill1 = el("div", "psm-bar-fill psm-bar-fill-p1");
    const fill2 = el("div", "psm-bar-fill psm-bar-fill-p2");
    const total = n1 + n2;
    if (total > 0) {
      fill1.style.width = (100 * n1) / total + "%";
      fill2.style.width = (100 * n2) / total + "%";
    }
    bar.appendChild(fill1);
    bar.appendChild(fill2);
    row.appendChild(bar);
    return row;
  }

  // A small number plus a thin bar scaled against the column's max value.
  function miniStat(value, max, fillClass) {
    const cell = el("td", "psm-ministat");
    cell.appendChild(el("span", "", Math.round(value) + "%"));
    const bar = el("div", "psm-minibar");
    const fill = el("div", "psm-minibar-fill " + fillClass);
    fill.style.width = max > 0 ? Math.min(100, (100 * value) / max) + "%" : "0";
    bar.appendChild(fill);
    cell.appendChild(bar);
    return cell;
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

    let verdictClass = "psm-verdict";
    if (parsed.winner === "p1" || parsed.winner === "p2") {
      verdictClass += " psm-verdict-" + parsed.winner;
    }
    body.appendChild(el("div", verdictClass, verdictText(parsed, insights)));

    // Turning points: one card per big swing, led by the swing size in the
    // beneficiary's color.
    if (insights.topSwings.length) {
      const box = section(body, "Turning points");
      for (const s of insights.topSwings) {
        const card = el("div", "psm-swing");
        card.appendChild(
          el(
            "span",
            "psm-swing-delta " + (s.delta > 0 ? "psm-p1" : "psm-p2"),
            (s.delta > 0 ? "+" : "") + Math.round(s.delta)
          )
        );
        const detail = el("div", "psm-swing-detail");
        detail.appendChild(el("span", "psm-chip", "Turn " + s.turn));
        const reasons = s.events.map((ev) => ev.text).join("; ");
        detail.appendChild(
          el(
            "span",
            "psm-swing-text",
            " " + (reasons || "momentum shifted toward " + parsed.players[s.beneficiary])
          )
        );
        card.appendChild(detail);
        box.appendChild(card);
      }
    }

    // Timeline of notable events, color-coded by the player involved.
    const moments = [];
    for (const p of parsed.points) {
      for (const ev of p.events) {
        if (["faint", "tera", "hazard", "weather", "field"].includes(ev.type)) {
          moments.push({ turn: p.turn, side: ev.side, text: ev.text });
        }
      }
    }
    if (moments.length) {
      const box = section(body, "Key moments");
      for (const m of moments) {
        const item = el(
          "div",
          "psm-moment " + (m.side ? "psm-moment-" + m.side : "psm-moment-neutral")
        );
        item.appendChild(el("span", "psm-chip", "Turn " + m.turn));
        item.appendChild(el("span", "", " " + m.text));
        box.appendChild(item);
      }
    }

    // Head-to-head, drawn as share bars instead of a numbers table.
    const statsBox = section(body, "Match stats");
    const s1 = parsed.stats.p1;
    const s2 = parsed.stats.p2;
    statsBox.appendChild(metricRow("KOs", s1.kos, s2.kos));
    statsBox.appendChild(
      metricRow(
        "Damage (attacks)",
        s1.damageDealt,
        s2.damageDealt,
        Math.round(s1.damageDealt) + "%",
        Math.round(s2.damageDealt) + "%"
      )
    );
    statsBox.appendChild(
      metricRow(
        "Damage (hazards, status...)",
        s1.indirectDamage,
        s2.indirectDamage,
        Math.round(s1.indirectDamage) + "%",
        Math.round(s2.indirectDamage) + "%"
      )
    );
    statsBox.appendChild(metricRow("Crits landed", s1.critsLanded, s2.critsLanded));
    statsBox.appendChild(metricRow("Status inflicted", s1.statusInflicted, s2.statusInflicted));
    statsBox.appendChild(metricRow("Hazard layers set", s1.hazardsSet, s2.hazardsSet));
    statsBox.appendChild(metricRow("Switches made", s1.switches, s2.switches));
    if (s1.teras || s2.teras) {
      statsBox.appendChild(metricRow("Terastallized", s1.teras, s2.teras));
    }
    statsBox.appendChild(
      metricRow(
        "Turns in control",
        insights.control.p1,
        insights.control.p2,
        insights.control.p1 + "%",
        insights.control.p2 + "%"
      )
    );

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

    // Per-Pokemon breakdown with damage bars scaled per column.
    const allMons = parsed.pokemon.p1.concat(parsed.pokemon.p2);
    const maxDealt = Math.max(1, ...allMons.map((m) => m.dealt));
    const maxTaken = Math.max(1, ...allMons.map((m) => m.taken));
    for (const side of ["p1", "p2"]) {
      const team = parsed.pokemon[side];
      if (!team.length) continue;
      const box = section(
        body,
        parsed.players[side] + "'s team",
        side === "p1" ? "psm-p1" : "psm-p2"
      );
      const t = el("table", "psm-mons");
      const head = el("tr", "psm-mons-head");
      for (const h of ["", "Dealt", "Taken", "KOs"]) head.appendChild(el("td", "", h));
      t.appendChild(head);
      for (const mon of team) {
        const tr = el("tr", mon.fainted ? "psm-fainted" : "");
        const nameCell = el("td", "psm-mon-name", mon.name);
        if (mon.fainted) nameCell.title = "Fainted on turn " + mon.faintTurn;
        tr.appendChild(nameCell);
        tr.appendChild(miniStat(mon.dealt, maxDealt, "psm-bar-fill-" + side));
        tr.appendChild(miniStat(mon.taken, maxTaken, "psm-minibar-fill-taken"));
        const koCell = el("td", "psm-mon-kos", String(mon.kos));
        if (mon.kos > 0) koCell.classList.add("psm-mon-kos-some");
        tr.appendChild(koCell);
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
