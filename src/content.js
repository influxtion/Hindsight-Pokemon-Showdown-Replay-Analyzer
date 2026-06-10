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
    matchup.appendChild(el("span", "", " vs "));
    matchup.appendChild(el("span", "psm-p2", parsed.players.p2));
    body.appendChild(matchup);

    const canvas = el("canvas", "psm-chart");
    body.appendChild(canvas);
    const legend = el("div", "psm-legend");
    legend.appendChild(el("span", "psm-p1", "Above the line: " + parsed.players.p1 + " ahead"));
    legend.appendChild(el("span", "psm-p2", "Below: " + parsed.players.p2 + " ahead"));
    body.appendChild(legend);

    // Verdict
    const verdict = el("div", "psm-verdict");
    if (parsed.winner === "tie") {
      verdict.textContent = "The battle ended in a tie.";
    } else if (parsed.winner) {
      const w = parsed.players[parsed.winner];
      let text = w + " won";
      if (insights.comeback) text += " — a comeback from 20+ momentum down!";
      else if (insights.control[parsed.winner] >= 70)
        text += ", controlling " + insights.control[parsed.winner] + "% of the game.";
      else text += " after " + insights.leadChanges + " lead change(s).";
      verdict.textContent = text;
    } else {
      verdict.textContent = "No result recorded (replay may be incomplete).";
    }
    body.appendChild(verdict);

    // Key moments
    const moments = [];
    for (const f of parsed.faints) {
      moments.push({
        turn: f.turn,
        text: "Turn " + f.turn + ": " + f.name + " (" + parsed.players[f.side] + ") fainted",
      });
    }
    if (insights.biggestSwing && Math.abs(insights.biggestSwing.delta) >= 10) {
      const s = insights.biggestSwing;
      moments.push({
        turn: s.turn,
        text:
          "Turn " + s.turn + ": biggest swing of the game (" +
          (s.delta > 0 ? "+" : "") + Math.round(s.delta) + " toward " +
          parsed.players[s.beneficiary] + ")",
      });
    }
    moments.sort((a, b) => a.turn - b.turn);
    if (moments.length) {
      body.appendChild(el("div", "psm-section-title", "Key moments"));
      const list = el("ul", "psm-moments");
      for (const m of moments) list.appendChild(el("li", "", m.text));
      body.appendChild(list);
    }

    // Stats table
    body.appendChild(el("div", "psm-section-title", "Match stats"));
    const table = el("table", "psm-stats");
    const addRow = (label, v1, v2, cls) => {
      const tr = el("tr", cls);
      tr.appendChild(el("td", "", label));
      tr.appendChild(el("td", "psm-p1", String(v1)));
      tr.appendChild(el("td", "psm-p2", String(v2)));
      table.appendChild(tr);
    };
    addRow("", parsed.players.p1, parsed.players.p2, "psm-stats-head");
    addRow("KOs", parsed.stats.p1.kos, parsed.stats.p2.kos);
    addRow(
      "Damage dealt",
      Math.round(parsed.stats.p1.damageDealt) + "%",
      Math.round(parsed.stats.p2.damageDealt) + "%"
    );
    addRow("Crits landed", parsed.stats.p1.critsLanded, parsed.stats.p2.critsLanded);
    addRow("Status inflicted", parsed.stats.p1.statusInflicted, parsed.stats.p2.statusInflicted);
    addRow("Turns in control", insights.control.p1 + "%", insights.control.p2 + "%");
    if (parsed.stats.p1.teras || parsed.stats.p2.teras) {
      addRow("Terastallized", parsed.stats.p1.teras, parsed.stats.p2.teras);
    }
    body.appendChild(table);

    return { panel, canvas };
  }

  async function init() {
    document.getElementById(PANEL_ID)?.remove();
    if (!isReplayPath(location.pathname)) return;

    const log = await getLog();
    if (!log) return;

    const parsed = NS.parseReplay(log);
    if (parsed.points.length < 2) return;
    const insights = NS.analyze(parsed);

    const { panel, canvas } = buildPanel(parsed, insights);
    document.body.appendChild(panel);
    NS.renderChart(canvas, parsed);
  }

  // The replay site can navigate client-side, so watch for URL changes.
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      init();
    }
  }, 1000);
})();
