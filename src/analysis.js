// Turns parsed replay data into headline insights for the panel.
window.PSMomentum = window.PSMomentum || {};

PSMomentum.analyze = function (parsed) {
  const pts = parsed.points;
  // Momentum within this band counts as "even" so tiny chip damage
  // doesn't register as a lead change.
  const EVEN_BAND = 3;

  let p1Ahead = 0;
  let p2Ahead = 0;
  let leadChanges = 0;
  let prevSign = 0;
  let momentumSum = 0;
  for (const p of pts) {
    momentumSum += p.m;
    const sign = p.m > EVEN_BAND ? 1 : p.m < -EVEN_BAND ? -1 : 0;
    if (sign === 1) p1Ahead++;
    else if (sign === -1) p2Ahead++;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) leadChanges++;
      prevSign = sign;
    }
  }

  // Per-turn swings. Each point carries the events of its own turn, so the
  // swing into pts[i] was caused by pts[i]'s events.
  const swings = [];
  let deltaSum = 0;
  for (let i = 1; i < pts.length; i++) {
    const delta = pts[i].m - pts[i - 1].m;
    deltaSum += Math.abs(delta);
    swings.push({
      turn: pts[i].turn,
      delta,
      beneficiary: delta > 0 ? "p1" : "p2",
      events: pts[i].events,
    });
  }
  const topSwings = swings
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
    .filter((s) => Math.abs(s.delta) >= 8)
    .sort((a, b) => a.turn - b.turn);
  const biggestSwing = swings.length
    ? swings.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a))
    : null;

  // Weighted luck: each break counts for its improbability (a crit is
  // rarer than a Scald burn) times its impact (how much that turn actually
  // swung toward the beneficiary - a crit into a KO matters, a crit on a
  // wall that shrugged it off does not).
  const swingByTurn = {};
  for (const s of swings) swingByTurn[s.turn] = s.delta;
  const luck = {};
  for (const side of ["p1", "p2"]) {
    const sign = side === "p1" ? 1 : -1;
    const events = parsed.stats[side].luckEvents.map((ev) => {
      // Game-long aggregates (accuracy streaks) carry their own weight.
      if (ev.flat) return { turn: null, text: ev.text, weight: ev.p };
      const toward = (swingByTurn[ev.turn] || 0) * sign;
      const impact = Math.max(0.25, Math.min(2, toward / 10));
      return { turn: ev.turn, text: ev.text, weight: ev.p * impact };
    });
    events.sort((a, b) => b.weight - a.weight);
    luck[side] = {
      score: Math.round(10 * events.reduce((sum, ev) => sum + ev.weight, 0)) / 10,
      events,
    };
  }

  // A comeback: the winner was behind by 20+ momentum at some point.
  let comeback = false;
  if (parsed.winner === "p1" || parsed.winner === "p2") {
    const sign = parsed.winner === "p1" ? 1 : -1;
    comeback = pts.some((p) => p.m * sign < -20);
  }

  const total = Math.max(1, pts.length);
  return {
    leadChanges,
    biggestSwing,
    topSwings,
    luck,
    comeback,
    control: {
      p1: Math.round((100 * p1Ahead) / total),
      p2: Math.round((100 * p2Ahead) / total),
    },
    // Average size of a turn-to-turn momentum change: how chaotic the
    // game was.
    volatility: swings.length ? Math.round((10 * deltaSum) / swings.length) / 10 : 0,
    avgMomentum: Math.round(momentumSum / total),
    finalMargin: pts.length ? Math.round(pts[pts.length - 1].m) : 0,
  };
};
