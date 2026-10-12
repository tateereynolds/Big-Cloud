// Pure timing and attention logic, shared with the camera worker and tests.
export const STATES = ['focus', 'distracted', 'unknown'];
export function sessionsInRange(records, range, today) {
  if (range === 'all') return records;
  const days = range === 'today' ? 1 : Number(range);
  if (![1, 7, 30].includes(days)) return [];
  // Subtract calendar days in UTC to keep daylight-saving changes out of the date math.
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days + 1);
  const start = cutoff.toISOString().slice(0, 10);
  return records.filter(s => s.local_day >= start && s.local_day <= today);
}

export function taskTotals(records) {
  const totals = new Map();
  for (const s of records) {
    const entry = totals.get(s.subject) || { subject: s.subject, duration: 0, focused: 0, distracted: 0, unknown: 0, sessions: 0 };
    for (const key of ['duration', 'focused', 'distracted', 'unknown']) entry[key] += s[key];
    entry.sessions++;
    totals.set(s.subject, entry);
  }
  return [...totals.values()].sort((a, b) => b.duration - a.duration);
}
export class StudyClock {
  constructor(seconds, restored = null) {
    this.planned = seconds;
    this.elapsed = 0;
    this.running = false;
    this.lastTick = null;
    this.totals = { focus: 0, distracted: 0, unknown: 0, manual: 0 };
    if (restored) {
      this.planned = restored.planned;
      this.elapsed = restored.elapsed;
      this.totals = { ...restored.totals };
    }
  }
  get remaining() { return Math.max(0, this.planned - this.elapsed); }
  start(now) { if (!this.remaining) return; this.running = true; this.lastTick = now; }
  tick(now, attention = 'unknown', manual = false) {
    if (!this.running) return false;
    const gap = Math.max(0, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const delta = Math.min(gap, this.remaining);
    // Sleeping / background-throttled intervals cannot be reliably observed.
    const state = gap > 3 || !STATES.includes(attention) ? 'unknown' : attention;
    this.totals[state] += delta;
    if (manual && state !== 'unknown') this.totals.manual += delta;
    this.elapsed += delta;
    if (this.remaining <= .00001) {
      this.elapsed = this.planned;
      this.running = false;
      return true;
    }
    return false;
  }
  pause(now, attention, manual) { const ended = this.tick(now, attention, manual); this.running = false; return ended; }
  snapshot() { return { planned: this.planned, elapsed: this.elapsed, totals: { ...this.totals } }; }
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function faceFeatures(points) {
  if (!points || points.length < 478) return null;
  if (distance(points[234], points[454]) < .10) return null;
  const eye = (a, b, upper, lower, iris) => {
    const p = points[a], q = points[b], i = points[iris];
    const width = distance(p, q);
    const dx = (q.x - p.x) / width, dy = (q.y - p.y) / width;
    const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2;
    return { x: ((i.x - cx) * dx + (i.y - cy) * dy) / width,
      y: (-(i.x - cx) * dy + (i.y - cy) * dx) / width,
      open: distance(points[upper], points[lower]) / width, center: { x: cx, y: cy } };
  };
  const l = eye(33, 133, 159, 145, 468), r = eye(362, 263, 386, 374, 473);
  const eyeWidth = distance(l.center, r.center);
  const mx = (l.center.x + r.center.x) / 2, my = (l.center.y + r.center.y) / 2;
  const dx = (r.center.x - l.center.x) / eyeWidth, dy = (r.center.y - l.center.y) / eyeWidth;
  const nose = points[1];
  const yaw = ((nose.x - mx) * dx + (nose.y - my) * dy) / eyeWidth;
  const pitch = (-(nose.x - mx) * dy + (nose.y - my) * dx) / distance(points[10], points[152]);
  const vector = [(l.x + r.x) / 2, (l.y + r.y) / 2, yaw, pitch];
  if (vector.some(x => !Number.isFinite(x))) return null;
  return { vector, eyesOpen: (l.open + r.open) / 2 > .10 };
}

export function profileFromSamples(samples) {
  if (samples.length < 10) throw new Error('Keep your face visible for the whole capture, then try again.');
  const mean = samples[0].map((_, i) => samples.reduce((sum, s) => sum + s[i], 0) / samples.length);
  const deviation = mean.map((m, i) => Math.sqrt(samples.reduce((sum, s) => sum + (s[i] - m) ** 2, 0) / samples.length));
  if (deviation.some((v, i) => v > [ .1, .08, .15, .09 ][i])) {
    throw new Error('Your viewing position moved too much. Settle into one position and try again.');
  }
  return { mean, deviation };
}

export function classifyView(feature, profiles, sensitivity = 1) {
  if (!feature || !feature.eyesOpen || !profiles?.screen) return { state: 'unknown', reason: 'Uncertain view' };
  const base = [.12, .075, .16, .085];
  let best = null;
  for (const [name, profile] of Object.entries(profiles)) {
    if (!['screen', 'notes'].includes(name) || !Array.isArray(profile?.mean) || profile.mean.length !== 4) continue;
    const score = Math.sqrt(feature.vector.reduce((sum, x, i) => {
      const tolerance = Math.max(base[i], (profile.deviation?.[i] || 0) * 3) * sensitivity;
      return sum + ((x - profile.mean[i]) / tolerance) ** 2;
    }, 0) / 4);
    if (!best || score < best.score) best = { name, score };
  }
  if (!best) return { state: 'unknown', reason: 'Calibrate first' };
  return best.score <= 1 ? { state: 'focus', reason: best.name === 'screen' ? 'Screen focus' : 'Notes focus' }
    : { state: 'distracted', reason: 'Looking away (estimate)' };
}
