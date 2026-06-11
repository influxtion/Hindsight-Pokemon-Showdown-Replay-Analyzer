// Entry point: grabs the battle log from the replay page, runs the parser
// and analysis, and injects the side panel.
(function () {
  const NS = window.PSMomentum;
  const PANEL_ID = "psm-panel";
  let lastPath = null;

  function isReplayPath(path) {
    // /gen9ou-2270001234, /smogtours-gen5ou-59402, private replays
    // tack on a password segment
    return /^\/([a-z0-9]+-)+\d+(-[a-z0-9]+)?$/i.test(path);
  }

  async function getLog() {
    const el = document.querySelector("script.battle-log-data");
    if (el && el.textContent.trim()) return el.textContent;
    // every replay serves its raw log at <url>.log
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

  // label row over a bar split by share in the player colors
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

  // number plus a thin bar scaled to the column max
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

    // follows the replay as it plays
    const nowCard = el("div", "psm-now");
    const nowHead = el("div", "psm-now-head");
    nowHead.appendChild(el("span", "psm-section-title", "Now playing"));
    const nowChip = el("span", "psm-chip", "");
    nowHead.appendChild(nowChip);
    nowCard.appendChild(nowHead);
    const nowContent = el("div", "psm-now-content");
    nowCard.appendChild(nowContent);
    body.appendChild(nowCard);

    function updateNow(turn) {
      nowContent.textContent = "";
      if (turn === null) {
        nowChip.textContent = "waiting";
        nowContent.appendChild(
          el("div", "psm-hint", "Press play - this card follows the replay turn by turn.")
        );
        return;
      }
      const idx = parsed.points.findIndex((p) => p.turn === turn);
      if (idx < 0) {
        nowChip.textContent = "Turn " + turn;
        return;
      }
      const point = parsed.points[idx];
      const prev = idx > 0 ? parsed.points[idx - 1] : null;
      nowChip.textContent = point.label;

      const net = prev ? point.m - prev.m : point.m;
      const summary = el("div", "psm-now-summary");
      const netSpan = el(
        "span",
        "psm-now-net " + (net > 1 ? "psm-p1" : net < -1 ? "psm-p2" : ""),
        (net > 0 ? "+" : "") + Math.round(net)
      );
      summary.appendChild(netSpan);
      summary.appendChild(
        el("span", "psm-now-total", " this turn, momentum now " + Math.round(point.m))
      );
      nowContent.appendChild(summary);

      for (const ev of point.events) {
        const row = el("div", "psm-action");
        row.appendChild(el("span", "", ev.text));
        if (ev.delta && Math.abs(ev.delta) >= 0.5) {
          row.appendChild(
            el(
              "span",
              "psm-action-delta " + (ev.delta > 0 ? "psm-p1" : "psm-p2"),
              (ev.delta > 0 ? "+" : "") + Math.round(ev.delta)
            )
          );
        }
        nowContent.appendChild(row);
      }

      // factors that moved this turn; catches chip damage and healing
      // that had no headline event
      if (prev) {
        const moved = Object.keys(point.breakdown)
          .map((k) => ({ k, d: point.breakdown[k] - prev.breakdown[k] }))
          .filter((f) => Math.abs(f.d) >= 1)
          .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
          .slice(0, 3)
          .map((f) => f.k + " " + (f.d > 0 ? "+" : "") + Math.round(f.d));
        if (moved.length) {
          nowContent.appendChild(el("div", "psm-now-factors", moved.join("  ·  ")));
        }
      }
    }
    updateNow(null);

    let verdictClass = "psm-verdict";
    if (parsed.winner === "p1" || parsed.winner === "p2") {
      verdictClass += " psm-verdict-" + parsed.winner;
    }
    body.appendChild(el("div", verdictClass, verdictText(parsed, insights)));

    // one card per big swing
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

    // key moments timeline
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

    // luck ledger, biggest breaks first
    const luck1 = insights.luck.p1;
    const luck2 = insights.luck.p2;
    if (luck1.events.length || luck2.events.length) {
      const box = section(body, "Luck");
      box.appendChild(
        metricRow("Luck points", luck1.score, luck2.score, String(luck1.score), String(luck2.score))
      );
      const all = luck1.events
        .map((e) => ({ ...e, side: "p1" }))
        .concat(luck2.events.map((e) => ({ ...e, side: "p2" })))
        .sort((a, b) => b.weight - a.weight);
      const MAX_SHOWN = 6;
      for (const ev of all.slice(0, MAX_SHOWN)) {
        const item = el("div", "psm-moment psm-moment-" + ev.side);
        item.appendChild(el("span", "psm-chip", ev.turn ? "Turn " + ev.turn : "All game"));
        item.appendChild(el("span", "", " " + ev.text));
        box.appendChild(item);
      }
      if (all.length > MAX_SHOWN) {
        box.appendChild(
          el(
            "div",
            "psm-note",
            "Biggest breaks shown; " + (all.length - MAX_SHOWN) + " smaller ones omitted."
          )
        );
      }
      const luckDiff = luck1.score - luck2.score;
      if (Math.abs(luckDiff) >= 2) {
        const lucky = luckDiff > 0 ? "p1" : "p2";
        box.appendChild(
          el(
            "div",
            "psm-note",
            "The dice favored " + parsed.players[lucky] + " in this one."
          )
        );
      }
      box.appendChild(
        el(
          "div",
          "psm-note",
          "Each break counts for how unlikely it was times how much it swung the game."
        )
      );
    }

    // per-Pokemon tables, bars scaled per column
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

    return { panel, canvas, updateNow };
  }

  // watch the battle log for turn headers so the panel follows playback
  let playbackObserver = null;
  function watchPlayback(onTurn) {
    let lastTurn = null;
    let debounce = null;
    const scan = () => {
      let turn = null;
      for (const h of document.querySelectorAll(".battle-log h2")) {
        const m = /^Turn (\d+)/.exec(h.textContent.trim());
        if (m) turn = parseInt(m[1], 10);
      }
      if (turn !== lastTurn) {
        lastTurn = turn;
        onTurn(turn);
      }
    };
    playbackObserver = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(scan, 150);
    });
    playbackObserver.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  let initGen = 0;
  async function init() {
    // a newer init supersedes this one if the URL changes mid-fetch
    const gen = ++initGen;
    try {
      console.log("[Hindsight] init, path =", location.pathname);
      playbackObserver?.disconnect();
      document.getElementById(PANEL_ID)?.remove();
      if (!isReplayPath(location.pathname)) {
        console.log("[Hindsight] not a replay path, skipping");
        return;
      }

      const log = await getLog();
      if (gen !== initGen) return;
      console.log("[Hindsight] log:", log ? log.length + " chars" : "NOT FOUND");
      if (!log) return;

      const parsed = NS.parseReplay(log);
      console.log("[Hindsight] parsed", parsed.points.length, "points");
      if (parsed.points.length < 2) return;
      const insights = NS.analyze(parsed);

      const { panel, canvas, updateNow } = buildPanel(parsed, insights);
      document.body.appendChild(panel);
      const chart = NS.renderChart(canvas, parsed);
      watchPlayback((turn) => {
        updateNow(turn);
        chart.setCursor(turn);
      });
      console.log("[Hindsight] panel rendered");
    } catch (err) {
      console.error("[Hindsight] failed:", err);
    }
  }

  // the replay site navigates client-side
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      init();
    }
  }, 1000);
})();
