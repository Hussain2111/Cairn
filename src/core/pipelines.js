// Applications and outreach: what needs action and why.

import { todayISO, diffDays } from './dates.js';

export const TERMINAL_APPLICATION_STATUSES = ['rejected'];

export function isTerminal(application) {
  return TERMINAL_APPLICATION_STATUSES.includes(application?.status);
}

/**
 * An item needs action when its next action is due or overdue, or when nothing
 * has moved on it for `idleDays`. Rejected applications drop out entirely --
 * there is no action left to take.
 */
export function applicationActions(app, { today = todayISO(), idleDays = 14 } = {}) {
  const reasons = [];
  if (isTerminal(app)) return reasons;
  if (app.nextActionDate) {
    const delta = diffDays(today, app.nextActionDate);
    if (delta !== null && delta <= 0) {
      reasons.push({ kind: 'due', date: app.nextActionDate, overdueBy: -delta });
    }
  }
  const since = app.lastMovedAt || app.dateApplied;
  const idle = since ? diffDays(since, today) : null;
  if (idle !== null && idle >= idleDays && app.status !== 'offer') {
    reasons.push({ kind: 'idle', days: idle, since });
  }
  return reasons;
}

export function outreachActions(item, { today = todayISO(), idleDays = 14 } = {}) {
  const reasons = [];
  if (item.followUpDate && !item.replied) {
    const delta = diffDays(today, item.followUpDate);
    if (delta !== null && delta <= 0) {
      reasons.push({ kind: 'due', date: item.followUpDate, overdueBy: -delta });
    }
  }
  if (!item.replied) {
    const since = item.lastMovedAt || item.dateContacted;
    const idle = since ? diffDays(since, today) : null;
    if (idle !== null && idle >= idleDays) reasons.push({ kind: 'idle', days: idle, since });
  }
  return reasons;
}

export function needsAction(state, { today = todayISO(), idleDays } = {}) {
  const limit = idleDays ?? state?.settings?.pipelineIdleDays ?? 14;
  const applications = (state?.applications ?? [])
    .map((app) => ({ item: app, kind: 'application', reasons: applicationActions(app, { today, idleDays: limit }) }))
    .filter((entry) => entry.reasons.length);
  const outreach = (state?.outreach ?? [])
    .map((item) => ({ item, kind: 'outreach', reasons: outreachActions(item, { today, idleDays: limit }) }))
    .filter((entry) => entry.reasons.length);
  const rank = (entry) => {
    const due = entry.reasons.find((r) => r.kind === 'due');
    return due ? -1000 - (due.overdueBy ?? 0) : -(entry.reasons[0]?.days ?? 0);
  };
  const all = [...applications, ...outreach].sort((a, b) => rank(a) - rank(b));
  return { applications, outreach, all, count: all.length };
}

export function describeReason(reason) {
  if (reason.kind === 'due') {
    if (reason.overdueBy > 0) return `${reason.overdueBy}d overdue`;
    return 'due today';
  }
  return `no movement in ${reason.days}d`;
}

export function applicationsByStatus(state, statuses) {
  const grouped = Object.fromEntries(statuses.map((s) => [s, []]));
  for (const app of state?.applications ?? []) {
    if (!grouped[app.status]) grouped[app.status] = [];
    grouped[app.status].push(app);
  }
  return grouped;
}

export function pipelineStats(state, { from, to } = {}) {
  const inRange = (iso) => (!from && !to) || (iso && (!from || iso >= from) && (!to || iso <= to));
  const applications = (state?.applications ?? []).filter((a) => inRange(a.dateApplied));
  const outreach = (state?.outreach ?? []).filter((o) => inRange(o.dateContacted));
  return {
    applicationsSent: applications.length,
    outreachSent: outreach.length,
    replies: outreach.filter((o) => o.replied).length,
    interviews: applications.filter((a) => ['interview', 'offer'].includes(a.status)).length,
    rejections: applications.filter((a) => a.status === 'rejected').length,
    applications,
    outreach,
  };
}
