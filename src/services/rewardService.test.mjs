/**
 * Pure-logic tests for computeCampaignState (the daily-streak engine).
 * No test framework is configured, so this is a self-contained script.
 * Run from the backend folder:  node src/services/rewardService.test.mjs
 *
 * Streak rule: complete at least one eligible DELIVERED order on
 * `required_streak_days` (Y) different Asia/Kolkata calendar days within an
 * X-day (`duration_days`) window anchored to the first order's IST day.
 */
import { computeCampaignState } from './rewardService.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ok  - ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL- ${name}`);
  }
}

// Build an order delivered at a specific IST wall-clock time.
let seq = 0;
function ist(dateTime) {
  seq += 1;
  return { id: `o${String(seq).padStart(3, '0')}`, delivered_at: new Date(`${dateTime}+05:30`).toISOString() };
}
const nowIst = (dateTime) => new Date(`${dateTime}+05:30`);

// Campaign: order on 5 different days within a 7-day window.
const C = { duration_days: 7, required_streak_days: 5, starts_at: '2026-01-01T00:00:00+05:30', ends_at: null };

// A: no orders -> idle
{
  const { completed, current } = computeCampaignState(C, [], nowIst('2026-01-01T12:00:00'));
  check('A: no orders -> no completed cycle', completed.length === 0);
  check('A: no orders -> idle 0/5', current.status === 'idle' && current.completed === 0);
}

// B: three orders on the SAME IST day -> counts as ONE streak day
{
  const orders = [ist('2026-01-01T09:00:00'), ist('2026-01-01T13:00:00'), ist('2026-01-01T20:00:00')];
  const { completed, current } = computeCampaignState(C, orders, nowIst('2026-01-02T10:00:00'));
  check('B: same-day multiple orders -> 1 streak day', current.completed === 1);
  check('B: same-day -> in_progress, no completion', current.status === 'in_progress' && completed.length === 0);
}

// C: orders on 3 different days -> 3/5 in progress
{
  const orders = [ist('2026-01-01T10:00:00'), ist('2026-01-02T10:00:00'), ist('2026-01-03T10:00:00')];
  const { current } = computeCampaignState(C, orders, nowIst('2026-01-03T12:00:00'));
  check('C: three distinct days -> 3/5', current.status === 'in_progress' && current.completed === 3);
}

// D: midnight boundary — 23:30 IST and 00:30 IST next day are DIFFERENT days
{
  const orders = [ist('2026-01-01T23:30:00'), ist('2026-01-02T00:30:00')];
  const { current } = computeCampaignState(C, orders, nowIst('2026-01-02T09:00:00'));
  check('D: IST midnight boundary -> 2 distinct days', current.completed === 2);
}

// D2: two orders straddling UTC midnight but SAME IST day count once.
// 2026-01-01 05:00 IST  == 2025-12-31 23:30 UTC ; 2026-01-01 23:00 IST same IST day.
{
  const orders = [ist('2026-01-01T05:00:00'), ist('2026-01-01T23:00:00')];
  const { current } = computeCampaignState(C, orders, nowIst('2026-01-02T09:00:00'));
  check('D2: same IST day across UTC boundary -> 1 day', current.completed === 1);
}

// E: 5 distinct days within the 7-day window (1,2,4,6,7) -> completed cycle
{
  const orders = [
    ist('2026-01-01T10:00:00'),
    ist('2026-01-02T10:00:00'),
    ist('2026-01-04T10:00:00'),
    ist('2026-01-06T10:00:00'),
    ist('2026-01-07T10:00:00'),
  ];
  const { completed, current } = computeCampaignState(C, orders, nowIst('2026-01-08T10:00:00'));
  check('E: 5 distinct days in window -> 1 completed cycle', completed.length === 1);
  check('E: completed cycle index 1', completed[0]?.cycle_index === 1);
  check('E: after completion -> idle (fresh streak)', current.status === 'idle');
}

// F: only 2 distinct days, window elapsed -> expired, no completion
{
  const orders = [ist('2026-01-01T10:00:00'), ist('2026-01-02T10:00:00')];
  const { completed, current } = computeCampaignState(C, orders, nowIst('2026-01-20T10:00:00'));
  check('F: window elapsed under target -> expired', current.status === 'expired' && current.completed === 2);
  check('F: expired -> no completed cycle', completed.length === 0);
}

// G: repeatable — complete one cycle (days 1-5), then a fresh cycle starts
//    from a later order (day 12) and reaches 5 again (days 12-16).
{
  const orders = [
    ist('2026-01-01T10:00:00'), ist('2026-01-02T10:00:00'), ist('2026-01-03T10:00:00'),
    ist('2026-01-04T10:00:00'), ist('2026-01-05T10:00:00'),
    ist('2026-01-12T10:00:00'), ist('2026-01-13T10:00:00'), ist('2026-01-14T10:00:00'),
    ist('2026-01-15T10:00:00'), ist('2026-01-16T10:00:00'),
  ];
  const { completed } = computeCampaignState(C, orders, nowIst('2026-01-20T10:00:00'));
  check('G: repeatable -> 2 completed cycles', completed.length === 2);
  check('G: cycle indices 1 and 2', completed[0]?.cycle_index === 1 && completed[1]?.cycle_index === 2);
}

// H: idempotency/stability — the first completed cycle does not change when
//    more orders are appended later.
{
  const base = [
    ist('2026-01-01T10:00:00'), ist('2026-01-02T10:00:00'), ist('2026-01-03T10:00:00'),
    ist('2026-01-04T10:00:00'), ist('2026-01-05T10:00:00'),
  ];
  const a = computeCampaignState(C, base, nowIst('2026-01-20T10:00:00'));
  const more = [...base, ist('2026-01-12T10:00:00'), ist('2026-01-13T10:00:00')];
  const b = computeCampaignState(C, more, nowIst('2026-01-20T10:00:00'));
  check('H: first completed cycle stable as orders append',
    JSON.stringify(a.completed[0]) === JSON.stringify(b.completed[0]));
}

// I: campaign start bound — orders before starts_at are ignored.
{
  const bounded = { ...C, starts_at: '2026-01-10T00:00:00+05:30' };
  const orders = [ist('2026-01-01T10:00:00'), ist('2026-01-02T10:00:00')];
  const { current } = computeCampaignState(bounded, orders, nowIst('2026-01-03T10:00:00'));
  check('I: orders before starts_at ignored', current.status === 'idle' && current.completed === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
