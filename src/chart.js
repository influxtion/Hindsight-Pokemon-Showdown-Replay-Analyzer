// Canvas line chart of the momentum score per turn. Blue area = player 1
// ahead, red area = player 2 ahead. Hover shows the turn's events.
window.PSMomentum = window.PSMomentum || {};

PSMomentum.renderChart = function (canvas, parsed) {
  const P1_COLOR = "#3b6ea5";
  const P2_COLOR = "#b8443e";
  const PAD = { left: 34, right: 12, top: 12, bottom: 24 };
  const points = parsed.points;
  let hoverIndex = -1;
  let cursorTurn = null; // the turn the replay is currently showing

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);
    if (points.length < 2) {
      ctx.fillStyle = "#888";
      ctx.font = "12px sans-serif";
      ctx.fillText("Not enough turns to chart.", PAD.left, ch / 2);
      return;
    }

    const plotW = cw - PAD.left - PAD.right;
    const plotH = ch - PAD.top - PAD.bottom;
    const minTurn = points[0].turn;
    const maxTurn = points[points.length - 1].turn;
    let maxAbs = 20;
    for (const p of points) maxAbs = Math.max(maxAbs, Math.abs(p.m));
    maxAbs = Math.ceil(maxAbs / 10) * 10;

    const x = (turn) =>
      PAD.left + ((turn - minTurn) / Math.max(1, maxTurn - minTurn)) * plotW;
    const y = (m) => PAD.top + plotH / 2 - (m / maxAbs) * (plotH / 2);

    // Gridlines and y labels
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs]) {
      ctx.strokeStyle = v === 0 ? "#999" : "#e3e3e3";
      ctx.beginPath();
      ctx.moveTo(PAD.left, y(v));
      ctx.lineTo(cw - PAD.right, y(v));
      ctx.stroke();
      ctx.fillStyle = "#888";
      ctx.fillText(String(v), PAD.left - 4, y(v));
    }

    // X-axis turn labels (about 6 ticks)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const step = Math.max(1, Math.ceil((maxTurn - minTurn) / 6));
    for (let t = minTurn; t <= maxTurn; t += step) {
      ctx.fillStyle = "#888";
      ctx.fillText(String(t), x(t), PAD.top + plotH + 6);
    }

    // Build the momentum line path once, reuse for both clipped fills.
    const linePath = () => {
      ctx.beginPath();
      points.forEach((p, i) =>
        i === 0 ? ctx.moveTo(x(p.turn), y(p.m)) : ctx.lineTo(x(p.turn), y(p.m))
      );
    };
    const fillPath = () => {
      linePath();
      ctx.lineTo(x(maxTurn), y(0));
      ctx.lineTo(x(minTurn), y(0));
      ctx.closePath();
    };

    // Fill above zero in P1's color, below in P2's.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, PAD.top, plotW, y(0) - PAD.top);
    ctx.clip();
    fillPath();
    ctx.fillStyle = P1_COLOR + "33";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.left, y(0), plotW, PAD.top + plotH - y(0));
    ctx.clip();
    fillPath();
    ctx.fillStyle = P2_COLOR + "33";
    ctx.fill();
    ctx.restore();

    linePath();
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Faint markers
    for (const p of points) {
      for (const ev of p.events) {
        if (ev.type === "faint") {
          ctx.beginPath();
          ctx.arc(x(p.turn), y(p.m), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = ev.side === "p1" ? P1_COLOR : P2_COLOR;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Playback cursor: where the replay currently is.
    if (cursorTurn !== null && cursorTurn >= minTurn && cursorTurn <= maxTurn) {
      ctx.strokeStyle = "#c9b687";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(cursorTurn), PAD.top);
      ctx.lineTo(x(cursorTurn), PAD.top + plotH);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Hover guide + tooltip
    if (hoverIndex >= 0 && hoverIndex < points.length) {
      const p = points[hoverIndex];
      ctx.strokeStyle = "#aaa";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x(p.turn), PAD.top);
      ctx.lineTo(x(p.turn), PAD.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const lines = [
        p.label + "  (momentum " + (p.m > 0 ? "+" : "") + Math.round(p.m) + ")",
      ];
      // What is driving the score right now, biggest factors first.
      if (p.breakdown) {
        const factors = Object.entries(p.breakdown)
          .filter(([, v]) => Math.abs(v) >= 1.5)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 3)
          .map(([k, v]) => k + " " + (v > 0 ? "+" : "") + Math.round(v));
        if (factors.length) lines.push(factors.join(", "));
      }
      for (const ev of p.events) {
        let suffix = "";
        if (ev.delta && Math.abs(ev.delta) >= 0.5) {
          suffix = " (" + (ev.delta > 0 ? "+" : "") + Math.round(ev.delta) + ")";
        }
        lines.push("- " + ev.text + suffix);
      }
      ctx.font = "11px sans-serif";
      let boxW = 0;
      for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width);
      boxW += 12;
      const boxH = lines.length * 14 + 8;
      let bx = x(p.turn) + 8;
      if (bx + boxW > cw - PAD.right) bx = x(p.turn) - boxW - 8;
      const by = PAD.top + 4;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = "#ccc";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.fillStyle = "#333";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 5 + i * 14));
    }
  }

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const plotW = canvas.clientWidth - PAD.left - PAD.right;
    const minTurn = points[0].turn;
    const maxTurn = points[points.length - 1].turn;
    const turn =
      minTurn + ((mx - PAD.left) / Math.max(1, plotW)) * (maxTurn - minTurn);
    let best = -1;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.turn - turn);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best !== hoverIndex) {
      hoverIndex = best;
      draw();
    }
  });
  canvas.addEventListener("mouseleave", () => {
    hoverIndex = -1;
    draw();
  });
  new ResizeObserver(draw).observe(canvas);

  draw();

  return {
    setCursor(turn) {
      if (turn !== cursorTurn) {
        cursorTurn = turn;
        draw();
      }
    },
  };
};
