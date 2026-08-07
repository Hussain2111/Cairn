import test from 'node:test';
import assert from 'node:assert/strict';

import { needsAction, applicationActions, outreachActions, pipelineStats } from '../../src/core/pipelines.js';
import { makeApplication, makeOutreach } from '../../src/core/schema.js';

const TODAY = '2026-08-07';

const app = (patch) => makeApplication({ company: 'Acme', role: 'Engineer', ...patch });
const contact = (patch) => makeOutreach({ name: 'Sam', company: 'Acme', ...patch });

test('a next action due today or overdue needs action', () => {
  assert.equal(applicationActions(app({ nextActionDate: TODAY, lastMovedAt: TODAY }), { today: TODAY }).length, 1);
  const overdue = applicationActions(app({ nextActionDate: '2026-08-01', lastMovedAt: TODAY }), { today: TODAY });
  assert.equal(overdue[0].kind, 'due');
  assert.equal(overdue[0].overdueBy, 6);
  assert.deepEqual(applicationActions(app({ nextActionDate: '2026-08-20', lastMovedAt: TODAY }), { today: TODAY }), []);
});

test('no movement for the idle window needs action', () => {
  const stale = applicationActions(app({ lastMovedAt: '2026-07-20', nextActionDate: null }), { today: TODAY, idleDays: 14 });
  assert.equal(stale[0].kind, 'idle');
  assert.equal(stale[0].days, 18);
  assert.deepEqual(applicationActions(app({ lastMovedAt: '2026-08-01' }), { today: TODAY, idleDays: 14 }), []);
});

test('the idle clock falls back to the application date', () => {
  const a = app({ dateApplied: '2026-07-01' });
  delete a.lastMovedAt;
  assert.equal(applicationActions(a, { today: TODAY, idleDays: 14 })[0].kind, 'idle');
});

test('rejected applications drop out entirely', () => {
  const rejected = app({ status: 'rejected', nextActionDate: '2026-07-01', lastMovedAt: '2026-01-01' });
  assert.deepEqual(applicationActions(rejected, { today: TODAY }), []);
});

test('an offer is never flagged as merely idle, but its next action still counts', () => {
  assert.deepEqual(applicationActions(app({ status: 'offer', lastMovedAt: '2026-01-01' }), { today: TODAY }), []);
  const withAction = app({ status: 'offer', lastMovedAt: '2026-01-01', nextActionDate: TODAY });
  assert.equal(applicationActions(withAction, { today: TODAY }).length, 1);
});

test('outreach that has replied stops asking for follow-up', () => {
  const replied = contact({ replied: true, followUpDate: '2026-07-01', lastMovedAt: '2026-01-01' });
  assert.deepEqual(outreachActions(replied, { today: TODAY }), []);
  const silent = contact({ replied: false, followUpDate: '2026-08-06', lastMovedAt: TODAY });
  assert.equal(outreachActions(silent, { today: TODAY })[0].kind, 'due');
});

test('needs action merges both lists, due items ahead of merely idle ones', () => {
  const state = {
    settings: { pipelineIdleDays: 14 },
    applications: [
      app({ id: 'idle', company: 'Idle Co', lastMovedAt: '2026-06-01' }),
      app({ id: 'due', company: 'Due Co', nextActionDate: '2026-08-01', lastMovedAt: TODAY }),
      app({ id: 'fine', company: 'Fine Co', lastMovedAt: TODAY }),
    ],
    outreach: [contact({ id: 'followup', followUpDate: TODAY, lastMovedAt: TODAY })],
  };
  const result = needsAction(state, { today: TODAY });
  assert.equal(result.count, 3);
  assert.equal(result.all[0].item.id, 'due', 'most overdue first');
  assert.equal(result.all[1].item.id, 'followup');
  assert.equal(result.all[2].item.id, 'idle');
  assert.equal(result.applications.length, 2);
  assert.equal(result.outreach.length, 1);
});

test('an item can need action for two reasons at once', () => {
  const reasons = applicationActions(app({ nextActionDate: '2026-08-01', lastMovedAt: '2026-06-01' }), { today: TODAY, idleDays: 14 });
  assert.deepEqual(reasons.map((r) => r.kind), ['due', 'idle']);
});

test('pipeline stats count only what falls inside the range', () => {
  const state = {
    applications: [
      app({ dateApplied: '2026-08-04', status: 'interview' }),
      app({ dateApplied: '2026-08-06', status: 'rejected' }),
      app({ dateApplied: '2026-07-01', status: 'applied' }),
    ],
    outreach: [contact({ dateContacted: '2026-08-05', replied: true }), contact({ dateContacted: '2026-06-01' })],
  };
  const stats = pipelineStats(state, { from: '2026-08-03', to: '2026-08-09' });
  assert.equal(stats.applicationsSent, 2);
  assert.equal(stats.interviews, 1);
  assert.equal(stats.rejections, 1);
  assert.equal(stats.outreachSent, 1);
  assert.equal(stats.replies, 1);
});
