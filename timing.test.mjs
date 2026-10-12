import test from 'node:test';
import assert from 'node:assert/strict';
import { StudyClock, classifyView, profileFromSamples, sessionsInRange, taskTotals } from '../static/focus.js';

test('pause time is excluded; screen, phone, unknown, manual totals sum to study duration', () => {
  const clock = new StudyClock(60);
  clock.start(0); clock.tick(1000, 'focus'); clock.tick(2000, 'distracted');
  clock.pause(3000, 'focus', true);
  clock.tick(20000, 'focus');
  assert.equal(clock.elapsed, 3);
  clock.start(20000); clock.tick(21000, 'unknown');
  assert.deepEqual(clock.totals, {focus:2,distracted:1,unknown:1,manual:1});
  assert.equal(clock.elapsed, 4);
});
test('computer sleep cannot inflate focused time and completion caps at the planned block', () => {
  const clock = new StudyClock(50);
  clock.start(0); clock.tick(1000, 'focus');
  assert.equal(clock.tick(100000, 'focus', true), true);
  assert.deepEqual(clock.totals, {focus:1,distracted:0,unknown:49,manual:0});
  assert.equal(clock.remaining, 0); assert.equal(clock.running, false);
  assert.equal(clock.tick(200000, 'focus'), false); assert.equal(clock.elapsed, 50);
});
test('restored blocks are paused and preserve attention totals', () => {
  const first = new StudyClock(100); first.start(0); first.tick(1000, 'focus');
  const restored = new StudyClock(100, first.snapshot());
  assert.equal(restored.running, false); restored.tick(999000, 'focus');
  assert.equal(restored.elapsed, 1); restored.start(1000000); restored.tick(1001000, 'distracted');
  assert.equal(restored.totals.focus + restored.totals.distracted + restored.totals.unknown, restored.elapsed);
});
test('both calibrated screen and notes views count as focused; away and missing views do not', () => {
  const profiles = {screen:{mean:[0,0,0,.25],deviation:[0,0,0,0]},notes:{mean:[0,.12,0,.45],deviation:[0,0,0,0]}};
  assert.equal(classifyView({vector:[0,0,0,.25],eyesOpen:true},profiles).reason, 'Screen focus');
  assert.equal(classifyView({vector:[0,.12,0,.45],eyesOpen:true},profiles).reason, 'Notes focus');
  assert.equal(classifyView({vector:[.5,.4,.5,.1],eyesOpen:true},profiles).state, 'distracted');
  assert.equal(classifyView(null,profiles).state, 'unknown');
  assert.equal(classifyView({vector:[0,0,0,.25],eyesOpen:false},profiles).state, 'unknown');
  assert.equal(classifyView({vector:[0,0,0,.25],eyesOpen:true},{}).state, 'unknown');
});
test('calibration requires enough samples and rejects unstable positions', () => {
  assert.throws(() => profileFromSamples([[0,0,0,0]]));
  const samples = Array.from({length:20},() => [0,.1,0,.3]);
  assert.equal(profileFromSamples(samples).mean[1].toFixed(1), '0.1');
  assert.throws(() => profileFromSamples(Array.from({length:20},(_,i) => [i%2,0,0,0])));
});

test('date filters include the whole local day and cross month and daylight-saving boundaries', () => {
  const records = ['2026-02-07', '2026-02-28', '2026-03-01', '2026-03-07', '2026-03-08', '2026-03-09'].map(local_day => ({local_day}));
  assert.deepEqual(sessionsInRange(records, 'today', '2026-03-08').map(s=>s.local_day), ['2026-03-08']);
  assert.deepEqual(sessionsInRange(records, '7', '2026-03-08').map(s=>s.local_day), ['2026-03-07','2026-03-08']);
  assert.deepEqual(sessionsInRange(records, '30', '2026-03-08').map(s=>s.local_day), ['2026-02-07','2026-02-28','2026-03-01','2026-03-07','2026-03-08']);
  assert.equal(sessionsInRange(records, 'all', '2026-03-08').length, 6);
});
test('task summaries keep distraction and unobserved time separate from focused time', () => {
  const totals = taskTotals([
    {subject:'Biology',duration:60,focused:40,distracted:10,unknown:10},
    {subject:'Biology',duration:30,focused:5,distracted:5,unknown:20},
    {subject:'Chemistry',duration:120,focused:0,distracted:0,unknown:120}
  ]);
  assert.equal(totals[0].subject, 'Chemistry');
  assert.deepEqual(totals[1], {subject:'Biology', duration:90, focused:45, distracted:15, unknown:30, sessions:2});
});
