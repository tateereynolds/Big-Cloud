import { StudyClock, sessionsInRange, taskTotals } from './focus.js';
import { AttentionCamera } from './camera.js';

const $ = id => document.getElementById(id);
const DEFAULTS = { study: 50, shortBreak: 15, longBreak: 30, longEvery: 4, goal: 180,
  sound: true, phoneTracking: true, sensitivity: 1 };
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
let settings = { ...DEFAULTS, ...read('focus-studio-settings', {}) };
let sessions = [];
let queue = read('focus-studio-outbox', {});
if (!queue || Array.isArray(queue) || typeof queue !== 'object') queue = {};
let mode = 'study', clock = new StudyClock(settings.study * 60), session = null, initialized = false;
let cycle = read('focus-studio-cycle', 0), trackingMode = 'auto', readonly = false;
if (!Number.isInteger(cycle) || cycle < 0) cycle = 0;
let lastLocalSave = 0, lastApiSave = 0, lastJournalRender = 0;
let syncing = null, toastTimer, confirmCallback = null, nextMode = 'shortBreak';
let cameraStarting = false, captureStep = 'screen', audioContext;

const restored = read('focus-studio-current', null);
if (restored && ['study', 'shortBreak', 'longBreak'].includes(restored.mode)
    && Number.isFinite(restored.clock?.planned) && restored.clock.planned > 0 && restored.clock.planned <= 10800
    && Number.isFinite(restored.clock.elapsed) && restored.clock.elapsed >= 0 && restored.clock.elapsed < restored.clock.planned
    && restored.clock.totals && ['focus','distracted','unknown','manual'].every(k => Number.isFinite(restored.clock.totals[k]) && restored.clock.totals[k] >= 0)) {
  const t = restored.clock.totals;
  if (Math.abs(t.focus + t.distracted + t.unknown - restored.clock.elapsed) < .1) {
    mode = restored.mode; clock = new StudyClock(restored.clock.planned, restored.clock);
    session = restored.session;
    if (session) { $('subject').value = session.subject; $('intention').value = session.intention; }
  }
}

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500);
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Could not save.'); error.status = response.status; throw error; }
  return data;
}
function snapshotSession(status = 'active') {
  if (!session) return null;
  return { ...session, subject: $('subject').value.trim() || 'Untitled study block', intention: $('intention').value.trim(),
    duration: clock.elapsed, focused: clock.totals.focus, distracted: clock.totals.distracted,
    unknown: clock.totals.unknown, manual: clock.totals.manual, status };
}
function checkpoint() {
  if (readonly) return;
  const active = clock.elapsed > 0 || session;
  if (!write('focus-studio-current', active ? { mode, clock: clock.snapshot(), session: snapshotSession(), wasRunning: clock.running } : null)) {
    $('saveStatus').textContent = 'Browser storage unavailable · keep Python running';
  }
  write('focus-studio-cycle', cycle);
}
function enqueue(payload) {
  if (!payload || readonly) return;
  queue[payload.id] = payload; write('focus-studio-outbox', queue);
  $('saveStatus').textContent = 'Saving your progress…';
}
async function syncQueue() {
  if (syncing) return syncing;
  syncing = (async () => {
    for (const id of Object.keys(queue)) {
      const payload = queue[id];
      try {
        await request(`/api/sessions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        sessions = sessions.filter(item => item.id !== id); sessions.unshift(payload);
        if (queue[id] === payload) delete queue[id];
        write('focus-studio-outbox', queue);
      } catch (error) {
        if (error.status === 409) {
          if (queue[id] === payload) delete queue[id];
          write('focus-studio-outbox', queue);
          try { sessions = await request('/api/sessions'); } catch { /* Retain our local journal until reconnect. */ }
        } else {
          $('saveStatus').textContent = 'Saved in browser · reconnect Python to sync';
          return false;
        }
      }
    }
    $('saveStatus').textContent = Object.keys(queue).length ? 'Saving your progress…' : 'Saved on this computer';
    return Object.keys(queue).length === 0;
  })();
  try { return await syncing; } finally { syncing = null; renderJournal(); }
}
function allSessions() {
  const records = new Map(sessions.map(item => [item.id, item]));
  for (const item of Object.values(queue)) records.set(item.id, item);
  const current = snapshotSession(); if (current) records.set(current.id, current);
  return [...records.values()].sort((a, b) => b.started_at.localeCompare(a.started_at));
}
function totalsToday() {
  return allSessions().filter(s => s.local_day === localDay()).reduce((total, s) => {
    for (const key of ['focused', 'distracted', 'unknown', 'duration']) total[key] += s[key];
    return total;
  }, { focused: 0, distracted: 0, unknown: 0, duration: 0 });
}
function renderStats() {
  const totals = totalsToday();
  for (const [id, key] of [['focusedStat','focused'], ['distractedStat','distracted'], ['unknownStat','unknown']]) {
    $(id).replaceChildren(document.createTextNode(String(Math.floor(totals[key] / 60))));
    const unit = document.createElement('span'); unit.textContent = ' min'; $(id).append(unit);
  }
  const observed = totals.focused + totals.distracted;
  $('rateStat').textContent = observed ? `${Math.round(100 * totals.focused / observed)}%` : '—';
  $('coverageLabel').textContent = totals.duration ? `${Math.round(100 * observed / totals.duration)}% of study time observed` : 'No observed study time yet';
  const minutes = Math.floor(totals.focused / 60);
  $('goalMinutes').textContent = minutes; $('goalTarget').textContent = settings.goal;
  $('goalProgress').style.width = `${Math.min(100, 100 * minutes / settings.goal)}%`;
  $('goalMessage').textContent = minutes >= settings.goal ? 'You made space for your goal. Take a breath.'
    : minutes > 0 ? `${Math.max(0, settings.goal - minutes)} more focused minutes toward your goal.` : 'Small steps add up. Start with this one.';
}
function renderJournal() {
  const all = allSessions();
  const records = sessionsInRange(all, $('historyFilter').value, localDay());
  renderTaskProgress(records);
  $('taskSuggestions').replaceChildren();
  for (const subject of [...new Set(all.map(s => s.subject))].slice(0, 40)) {
    const option = document.createElement('option'); option.value = subject; $('taskSuggestions').append(option);
  }
  $('emptyHistory').hidden = records.length > 0; $('historyBody').replaceChildren();
  for (const record of records.slice(0, 100)) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const strong = document.createElement('strong'); strong.textContent = record.subject;
    const small = document.createElement('small');
    const when = new Date(record.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    small.textContent = `${when}${record.manual > 0 ? ' · includes manual time' : ''}`;
    name.append(strong, small); name.title = record.intention || record.subject; row.append(name);
    for (const amount of [record.duration, record.focused]) {
      const td = document.createElement('td'); td.textContent = `${(amount / 60).toFixed(1)} min`; row.append(td);
    }
    const attention = document.createElement('td'), bar = document.createElement('div'); bar.className = 'attention-bar';
    for (const key of ['focused','distracted','unknown']) {
      const span = document.createElement('span'); span.style.width = `${record.duration ? 100 * record[key] / record.duration : 0}%`; bar.append(span);
    }
    const observed = record.focused + record.distracted;
    const note = document.createElement('small'); note.textContent = `${observed ? Math.round(100 * record.focused / observed) + '% focus' : 'Unobserved'} · ${record.duration ? Math.round(100 * observed / record.duration) : 0}% coverage`;
    attention.append(bar, note); row.append(attention);
    const status = document.createElement('td'), chip = document.createElement('span'); chip.className = 'session-status';
    chip.textContent = record.id === session?.id ? (clock.running ? 'In progress' : 'Paused') : ({ completed: 'Completed', ended: 'Finished early', active: 'Interrupted' }[record.status] || record.status);
    status.append(chip); row.append(status); $('historyBody').append(row);
  }
}

function renderTaskProgress(records) {
  const totals = taskTotals(records), duration = records.reduce((sum, s) => sum + s.duration, 0);
  $('rangeTotal').textContent = `${(duration / 60).toFixed(1)} min across ${records.length} session${records.length === 1 ? '' : 's'}`;
  $('taskProgress').replaceChildren();
  if (!totals.length) {
    const empty = document.createElement('p'); empty.className = 'small-note'; empty.textContent = 'Your subjects and their study time will appear here.';
    $('taskProgress').append(empty); return;
  }
  for (const item of totals.slice(0, 12)) {
    const row = document.createElement('div'); row.className = 'task-progress-row';
    const subject = document.createElement('span'); subject.className = 'task-progress-name'; subject.textContent = item.subject; subject.title = item.subject;
    const bar = document.createElement('div'); bar.className = 'task-progress-track';
    for (const key of ['focused', 'distracted', 'unknown']) {
      const span = document.createElement('span'); span.style.width = `${100 * item[key] / (totals[0].duration || 1)}%`; bar.append(span);
    }
    const time = document.createElement('span'); time.className = 'task-progress-time'; time.textContent = `${(item.duration / 60).toFixed(1)} min`;
    row.setAttribute('aria-label', `${item.subject}: ${(item.duration / 60).toFixed(1)} study minutes, ${(item.focused / 60).toFixed(1)} focused minutes`);
    row.append(subject, bar, time); $('taskProgress').append(row);
  }
  if (totals.length > 12) {
    const extra = document.createElement('p'); extra.className = 'small-note'; extra.textContent = `Showing the 12 subjects with the most study time, out of ${totals.length}.`;
    $('taskProgress').append(extra);
  }
}
function renderTimer() {
  const seconds = Math.ceil(clock.remaining), minutes = Math.floor(seconds / 60);
  const time = `${String(minutes).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
  $('countdown').textContent = time; $('countdown').setAttribute('aria-label', `${minutes} minutes ${seconds % 60} seconds remaining`);
  document.title = clock.running ? `${time} · ${mode === 'study' ? 'Focus' : 'Break'} · Focus Studio` : 'Focus Studio · A little more present';
  $('ringProgress').style.strokeDashoffset = String(860.797 * (clock.elapsed / clock.planned));
  document.querySelector('.timer-card').classList.toggle('is-break', mode !== 'study');
  $('startPause').replaceChildren(document.createTextNode(readonly ? 'Open in another tab' : clock.running ? 'Pause' : clock.elapsed ? 'Resume' : mode === 'study' ? 'Start focusing' : 'Start my break'));
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#arrow'); arrow.append(use); $('startPause').append(arrow);
  $('startPause').disabled = readonly || !initialized;
  $('timerOverline').textContent = mode !== 'study' ? (mode === 'longBreak' ? 'A LITTLE LONGER TO RESET' : 'ROOM TO RECHARGE') : clock.running ? 'ONE THING AT A TIME' : clock.elapsed ? 'YOUR PLACE IS SAVED' : 'TIME TO SETTLE IN';
  $('timerCaption').textContent = mode !== 'study' ? 'Rest is part of the work.' : clock.running ? 'You only need to be here, now.' : clock.elapsed ? 'Take your time. Resume when ready.' : 'A fresh start, whenever you’re ready.';
  $('endSession').hidden = !session;
  const current = cycle % settings.longEvery;
  $('blockLabel').textContent = `Block ${current + 1} of ${settings.longEvery}`;
  $('cycleDots').replaceChildren();
  for (let i = 0; i < settings.longEvery; i++) {
    const dot = document.createElement('span'); dot.className = i < current ? 'done' : i === current ? 'current' : ''; $('cycleDots').append(dot);
  }
  $('cycleDots').setAttribute('aria-label', `${current} study blocks completed in this cycle`);
  $('nextBreak').textContent = mode === 'study' ? `${current === settings.longEvery - 1 ? settings.longBreak : settings.shortBreak} min ${current === settings.longEvery - 1 ? 'long ' : ''}break comes next` : 'Come back with a little more energy';
  for (const button of document.querySelectorAll('[data-mode]')) {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  $('todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}
function attention() {
  if (document.hidden) return { state: 'unknown', reason: 'Tab hidden' };
  if (trackingMode === 'focus') return { state: 'focus', reason: 'Manual studying' };
  if (trackingMode === 'distracted') return { state: 'distracted', reason: 'Manual distracted' };
  return camera.getAttention();
}
function tick() {
  const now = Date.now(), observed = attention();
  if (clock.tick(now, observed.state, trackingMode !== 'auto')) { completeBlock(); return; }
  if (now - lastLocalSave > 1000) {
    lastLocalSave = now; if (clock.running) checkpoint(); renderTimer(); renderStats();
  }
  if (clock.running && session && now - lastApiSave > 15000) {
    lastApiSave = now; enqueue(snapshotSession()); syncQueue();
  }
  if (now - lastJournalRender > 10000) { lastJournalRender = now; renderJournal(); }
}
function initAudio() {
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => {}); } catch { /* Sound is optional. */ }
}
function chime() {
  if (!settings.sound || !audioContext) return;
  for (const [i, frequency] of [523.25, 659.25, 783.99].entries()) {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const start = audioContext.currentTime + i * .18;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.12, start + .025);
    gain.gain.exponentialRampToValueAtTime(.001, start + .7);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(start); oscillator.stop(start + .75);
  }
}
function toggleTimer() {
  if (readonly || !initialized) return;
  initAudio();
  if (clock.running) {
    const a = attention();
    if (clock.pause(Date.now(), a.state, trackingMode !== 'auto')) { completeBlock(); return; }
    enqueue(snapshotSession()); syncQueue();
  } else {
    if (mode === 'study' && !session) {
      session = { id: crypto.randomUUID(), started_at: new Date().toISOString(), local_day: localDay(),
        subject: $('subject').value.trim() || 'Untitled study block', intention: $('intention').value.trim() };
      enqueue(snapshotSession()); syncQueue();
      if (trackingMode === 'auto' && !camera.active) toast('Camera off: time is unobserved. Choose Manual: studying to count focused time.');
    }
    clock.start(Date.now());
  }
  checkpoint(); renderTimer(); renderJournal();
}
function setMode(value) {
  mode = value; clock = new StudyClock(settings[value] * 60); session = null;
  camera.setBreak(mode !== 'study');
  checkpoint(); renderTimer(); renderJournal();
  if (camera.active) onCameraChange(camera.getAttention());
}
function finishSession(status) {
  const record = snapshotSession(status);
  enqueue(record); session = null; syncQueue();
  write('focus-studio-current', null);
  return record;
}
function completeBlock() {
  chime();
  if (mode === 'study') {
    const record = finishSession('completed'); cycle++; write('focus-studio-cycle', cycle);
    nextMode = cycle % settings.longEvery === 0 ? 'longBreak' : 'shortBreak';
    showTransition(record, nextMode);
  } else {
    nextMode = 'study'; showTransition(null, nextMode);
  }
  setMode(nextMode); renderStats();
}
function showTransition(record, next) {
  $('transitionEyebrow').textContent = record ? 'A MOMENT TO RESET' : 'A FRESH PAGE';
  $('transitionTitle').textContent = record ? 'That’s a block in the books.' : 'Ready for your next small win?';
  $('transitionMessage').textContent = record ? `You showed up for ${(record.duration / 60).toFixed(1)} minutes. Your ${settings[next]}-minute ${next === 'longBreak' ? 'long ' : ''}break is ready.` : 'Your break is complete. Pick one clear intention for the next study block.';
  $('transitionStats').replaceChildren();
  if (record) for (const [label, key] of [['Focused','focused'], ['Distracted','distracted'], ['Unobserved','unknown']]) {
    const div = document.createElement('div'), strong = document.createElement('strong'), small = document.createElement('small');
    strong.textContent = `${(record[key] / 60).toFixed(1)}m`; small.textContent = label; div.append(strong, small); $('transitionStats').append(div);
  }
  $('breakTip').textContent = record ? 'Stand up, get some water, and give your eyes a different view.' : 'Settle back in. One thing at a time is enough.';
  $('startNext').textContent = record ? 'Start my break →' : 'Start my next study block →';
  if (!$('transitionDialog').open) $('transitionDialog').showModal();
}
function confirmAction(title, message, callback) {
  if (readonly) return;
  $('confirmTitle').textContent = title; $('confirmMessage').textContent = message; confirmCallback = callback;
  $('confirmDialog').showModal();
}
function endEarly(next = 'shortBreak') {
  const a = attention();
  if (clock.pause(Date.now(), a.state, trackingMode !== 'auto')) { completeBlock(); return; }
  finishSession('ended'); setMode(next); renderStats(); toast('Your study time is saved.');
}

function onCameraChange(result) {
  const active = camera.active;
  $('cameraView').classList.toggle('active', active); $('cameraEmpty').hidden = active;
  $('cameraControls').hidden = !active; $('liveStatus').hidden = !active;
  $('cameraBadge').textContent = active ? mode !== 'study' ? 'ON BREAK' : 'LOCAL · LIVE' : 'CAMERA OFF';
  $('cameraBadge').classList.toggle('on', active);
  $('liveStatusText').textContent = trackingMode !== 'auto' && mode === 'study' ? trackingMode === 'focus' ? 'Manual studying' : 'Manual distracted' : result.reason;
  $('liveStatus').style.color = result.state === 'distracted' ? '#a47c3b' : result.state === 'focus' ? '#416136' : '#7f8977';
  $('cameraMessage').textContent = trackingMode !== 'auto' && mode === 'study' ? trackingMode === 'focus' ? 'Manual studying selected · active study time counts as focus.' : 'Manual distracted selected · active study time counts as distraction.' : active ? !camera.profiles.screen ? 'Next: calibrate your screen and paper-notes positions.'
    : mode !== 'study' ? 'Attention estimates pause during breaks.' : 'Calibrated estimates · use manual tracking whenever needed.' : result.reason === 'Camera off' ? 'Camera off · choose manual studying to count focus time.' : result.reason;
}
const camera = new AttentionCamera($('video'), $('overlay'), onCameraChange, text => $('phoneModelStatus').textContent = text);
camera.setOptions(settings); camera.setBreak(mode !== 'study');

$('startPause').addEventListener('click', toggleTimer);
$('endSession').addEventListener('click', () => confirmAction('Finish this block?', 'Your study time will be saved. Finishing early does not advance the four-block cycle.', () => endEarly()));
$('resetTimer').addEventListener('click', () => {
  if (session) confirmAction('Restart this block?', 'Your current study time will be saved as a finished-early block. The timer will start fresh.', () => endEarly(mode));
  else { setMode(mode); toast('A fresh timer is ready.'); }
});
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
  if (readonly || mode === button.dataset.mode) return;
  const target = button.dataset.mode;
  if (session) confirmAction('Switch to a different block?', 'Your current study time will be saved before switching.', () => endEarly(target));
  else { if (clock.running) { const a = attention(); clock.pause(Date.now(), a.state, false); } setMode(target); }
});
$('startNext').addEventListener('click', () => { $('transitionDialog').close(); toggleTimer(); });
$('laterNext').addEventListener('click', () => $('transitionDialog').close());
$('confirmAction').addEventListener('click', () => { $('confirmDialog').close(); const action = confirmCallback; confirmCallback = null; action?.(); });
$('confirmCancel').addEventListener('click', () => $('confirmDialog').close());
for (const button of document.querySelectorAll('.close-dialog')) button.addEventListener('click', () => button.closest('dialog').close());
$('historyFilter').addEventListener('change', renderJournal);
for (const id of ['subject','intention']) $(id).addEventListener('input', () => { checkpoint(); if (session) renderJournal(); });
$('trackingMode').addEventListener('change', () => {
  // Credit the preceding interval to the old mode before applying the user's correction.
  tick(); trackingMode = $('trackingMode').value; onCameraChange(camera.getAttention());
  toast(trackingMode === 'auto' ? 'Automatic estimates selected.' : trackingMode === 'focus' ? 'Study time now counts as manual focus.' : 'Study time now counts as manual distracted.');
});
document.addEventListener('keydown', event => {
  if (event.target.closest('input,select,textarea,button,a,[contenteditable]') || document.querySelector('dialog[open]') || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (event.code === 'Space') { event.preventDefault(); toggleTimer(); }
  const key = event.key.toLowerCase();
  if (['f','d','a'].includes(key)) { $('trackingMode').value = { f:'focus', d:'distracted', a:'auto' }[key]; $('trackingMode').dispatchEvent(new Event('change')); }
});
for (const id of ['openHelp','footerHelp']) $(id).addEventListener('click', () => $('helpDialog').showModal());
function openSettings() {
  for (const [name, value] of Object.entries(settings)) {
    const input = $('settingsForm').elements.namedItem(name);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
  }
  $('settingsDialog').showModal();
}
for (const id of ['openSettings','topSettings']) $(id).addEventListener('click', openSettings);
$('resetCycle').addEventListener('click', () => {
  if (readonly) return;
  cycle = 0; write('focus-studio-cycle', cycle); renderTimer();
  toast('Break cycle restarted. Your study journal is unchanged.');
});
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault(); if (readonly) return;
  const values = {};
  for (const name of Object.keys(DEFAULTS)) {
    const input = $('settingsForm').elements.namedItem(name);
    values[name] = input.type === 'checkbox' ? input.checked : Number(input.value);
  }
  const submit = event.submitter; submit.disabled = true;
  try {
    const result = await request('/api/settings', { method: 'PUT', body: JSON.stringify(values) });
    settings = result; write('focus-studio-settings', settings); camera.setOptions(settings);
    if (!clock.elapsed && !clock.running && !session) clock = new StudyClock(settings[mode] * 60);
    $('settingsDialog').close(); renderTimer(); renderStats(); toast('Your study rhythm is saved.');
  } catch (error) { toast(error.message); } finally { submit.disabled = false; }
});
$('enableCamera').addEventListener('click', async () => {
  if (cameraStarting || readonly || !initialized) return;
  cameraStarting = true; $('enableCamera').disabled = true; $('enableCamera').textContent = 'Loading camera models…';
  $('cameraMessage').textContent = 'Allow camera access when your browser asks. Models load on first use.';
  try {
    await camera.start(); onCameraChange(camera.getAttention());
    if (camera.active && mode === 'study') openCalibration();
  } catch (error) { $('cameraMessage').textContent = error.message; toast(error.message); }
  finally { cameraStarting = false; $('enableCamera').disabled = false; $('enableCamera').textContent = 'Enable camera'; }
});
$('disableCamera').addEventListener('click', () => { tick(); camera.stop(); $('phoneModelStatus').textContent = 'Camera off · no image processing is running.'; });
function openCalibration() {
  if (mode !== 'study') { toast('Switch to Focus mode to calibrate your viewing positions.'); return; }
  captureStep = 'screen'; $('screenCheck').textContent = ''; $('notesCheck').textContent = '';
  $('captureCalibration').textContent = 'Capture screen position';
  $('calibrationMessage').textContent = 'We’ll sample each position for 3 seconds.'; $('calibrationMessage').classList.remove('error');
  if (!$('calibrationDialog').open) $('calibrationDialog').showModal();
}
$('calibrateCamera').addEventListener('click', openCalibration);
$('captureCalibration').addEventListener('click', async () => {
  if (captureStep === 'done') { $('calibrationDialog').close(); return; }
  const target = captureStep, button = $('captureCalibration'); button.disabled = true;
  $('calibrationMessage').classList.remove('error');
  $('calibrationMessage').textContent = target === 'screen' ? 'Capturing… keep reading the screen for 3 seconds.' : 'Capturing… look down at your notes for 3 seconds.';
  try {
    await camera.capture(target); $(target + 'Check').textContent = '✓';
    if (target === 'screen') { captureStep = 'notes'; button.textContent = 'Capture notes position'; $('calibrationMessage').textContent = 'Screen captured. Now look at your notes immediately after clicking below.'; }
    else { captureStep = 'done'; button.textContent = 'Ready to focus'; $('calibrationMessage').textContent = 'Both positions saved. Keep the camera and notes in these positions.'; }
    onCameraChange(camera.getAttention());
  } catch (error) { $('calibrationMessage').textContent = error.message; $('calibrationMessage').classList.add('error'); }
  finally { button.disabled = false; }
});
$('exportCsv').addEventListener('click', async event => {
  event.preventDefault(); tick(); enqueue(snapshotSession());
  await syncQueue();
  if (Object.keys(queue).length) { await syncQueue(); }
  if (Object.keys(queue).length) { toast('Reconnect the Python app before exporting unsynced sessions.'); return; }
  window.location.assign('/api/export');
});
document.addEventListener('visibilitychange', () => { tick(); checkpoint(); enqueue(snapshotSession()); syncQueue(); });
window.addEventListener('pagehide', () => { tick(); checkpoint(); enqueue(snapshotSession()); camera.stop(); });
window.addEventListener('pageshow', event => { if (event.persisted && clock.running) { clock.running = false; clock.lastTick = null; checkpoint(); renderTimer(); toast('Your timer is paused. Resume when ready.'); } });

async function initialize() {
  if (navigator.locks) {
    navigator.locks.request('focus-studio-active-tab', { ifAvailable: true }, async lock => {
      if (!lock) {
        readonly = true; toast('Focus Studio is already open in another tab. Use that tab for your timer.'); renderTimer();
        for (const id of ['enableCamera','resetTimer','trackingMode','subject','intention']) $(id).disabled = true;
        return;
      }
      await new Promise(() => {});
    });
  }
  const [remoteSettings, remoteSessions] = await Promise.allSettled([request('/api/settings'), request('/api/sessions')]);
  if (remoteSettings.status === 'fulfilled') {
    settings = remoteSettings.value; write('focus-studio-settings', settings); camera.setOptions(settings);
    if (!restored && !session && !clock.running && !clock.elapsed) clock = new StudyClock(settings[mode] * 60);
  }
  if (remoteSessions.status === 'fulfilled') sessions = remoteSessions.value;
  else $('saveStatus').textContent = 'Python server unavailable · local progress retained';
  if (session) {
    const saved = sessions.find(s => s.id === session.id);
    if (saved && saved.status !== 'active') { session = null; setMode('study'); }
    else {
      if (saved && saved.duration > clock.elapsed) {
        clock.elapsed = Math.min(saved.duration, clock.planned);
        clock.totals = { focus: saved.focused, distracted: saved.distracted, unknown: saved.unknown, manual: saved.manual };
      }
      toast('Your last block is restored and paused. Resume when you’re ready.');
    }
  }
  await syncQueue(); initialized = true; renderTimer(); renderStats(); renderJournal();
}
renderTimer(); renderStats(); renderJournal(); initialize();
setInterval(tick, 250);
setInterval(() => { if (Object.keys(queue).length && !readonly) syncQueue(); }, 20000);
