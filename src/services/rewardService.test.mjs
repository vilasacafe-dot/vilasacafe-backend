/**
 * Pure-logic tests for computeCampaignState (the rolling-window reward engine).
 * No test framework is configured in this project, so this is a self-contained
 * script. Run from the backend folder:  node src/services/rewardService.test.mjs
 */
import { computeCampaignState } from './rewardService.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1); // fixed anchor for determinism

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

const campaign = {
  required_orders: 3,
  duration_days: 7,
  starts_at: new Date(T0 - 100 * DAY).toISOString(),
  ends_at: null,
};

const atDays = (days) =>
  days.map((d, i) => ({ id: `o${String(i).padStart(2, '0')}_${d}`, delivered_at: new Date(T0 + d * DAY).toISOString() }));
const now = (d) => new Date(T0 + d * DAY);

// A: no orders -> idle, nothing completed
{
  const { completed, current } = computeCampaignState(campaign, atDays([]), now(0));
  check('A: no orders -> no completed cycle', completed.length === 0);
  check('A: no orders -> idle, 0 progress', current.status === 'idle' && current.completed === 0);
}

// B: partial progress within an open window -> in_progress
{
  const { completed, current } = computeCampaignState(campaign, atDays([0, 1]), now(2));
  check('B: partial -> no completed cycle', completed.length === 0);
  check('B: partial -> in_progress 2/3', current.status === 'in_progress' && current.completed === 2);
}

// C: exactly reaching the goal inside the window -> one completed cycle
{
  const { completed, current } = computeCampaignState(campaign, atDays([0, 1, 2]), now(3));
  check('C: goal met -> 1 completed cycle', completed.length === 1);
  check('C: completed window anchored correctly', completed[0].window_start === new Date(T0).toISOString());
  check('C: completed window end = +7d', completed[0].window_end === new Date(T0 + 7 * DAY).toISOString());
  check('C: after completion -> idle (new streak)', current.status === 'idle' && current.completed === 0);
}

// D: window lapses with partial progress, later order starts a fresh streak
{
  const { completed, current } = computeCampaignState(campaign, atDays([0, 1, 10]), now(11));
  check('D: lapsed window -> no completed cycle', completed.length === 0);
  check('D: new anchor after lapse -> in_progress 1/3', current.status === 'in_progress' && current.completed === 1);
}

// D2: window lapsed, no later order -> expired state surfaced
{
  const { completed, current } = computeCampaignState(campaign, atDays([0, 1]), now(20));
  check('D2: expired window surfaced', completed.length === 0 && current.status === 'expired');
}

// E: repeatable — six quick orders yield two completed cycles
{
  const { completed, current } = computeCampaignState(campaign, atDays([0, 1, 2, 3, 4, 5]), now(6));
  check('E: repeat -> 2 completed cycles', completed.length === 2);
  check('E: cycle indices 1 and 2', completed[0].cycle_index === 1 && completed[1].cycle_index === 2);
  check('E: after 2 cycles -> idle', current.status === 'idle');
}

// F: idempotency/stability — an earlier completed cycle never changes when
// more orders are appended later (time only moves forward).
{
  const a = computeCampaignState(campaign, atDays([0, 1, 2, 3, 4]), now(12));
  const b = computeCampaignState(campaign, atDays([0, 1, 2, 3, 4, 5, 6]), now(12));
  check('F: first completed cycle is stable as orders append',
    JSON.stringify(a.completed[0]) === JSON.stringify(b.completed[0]));
}

// G: campaign date bounds exclude out-of-range deliveries
{
  const bounded = { ...campaign, starts_at: new Date(T0 + 5 * DAY).toISOString(), ends_at: new Date(T0 + 20 * DAY).toISOString() };
  const { current } = computeCampaignState(bounded, atDays([0, 1, 2]), now(6));
  check('G: orders before starts_at are ignored', current.status === 'idle' && current.completed === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
