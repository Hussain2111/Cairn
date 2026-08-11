// The GRE.
//
// Five pages: the day's blocks in order, the problem log, the retrieval queue
// that block A draws from, the audit that says whether any of it is working,
// and the schedule that defines the rest.
//
// The two numbers this view exists to produce are on the audit page: whether
// concept gaps fall over time, and whether a portable move written for one
// problem fires on a later, unseen one. Everything else feeds them.

import { el, tag, empty, confirm, meter, toast, select, input, openDialog } from '../ui.js';
import { pageHead, statTile, editRecord } from './shared.js';
import {
  blocks,
  blockByCode,
  phases,
  phaseById,
  days,
  dayByNumber,
  currentDay,
  currentPhase,
  isCheckpoint,
  blocksForDay,
  blocksNotYetDue,
  dayMinutes,
  dayProgress,
  toggleBlock,
  gateStatus,
  daysRemaining,
  everyDayBlockStreak,
  entries,
  entryById,
  isLoggable,
  retrievalQueue,
  recordRetrieval,
  retrievalRevealed,
  initialRetrieval,
  causeByPhase,
  portableHits,
  portableHitsByPhase,
  priorEntries,
  greSummary,
  seedBlocks,
} from '../../core/gre.js';
import { makeGreEntry, makeGreAttempt, GRE_CAUSES } from '../../core/schema.js';
import { formatDate, formatLongDate, formatDuration, relativeDay, todayISO } from '../../core/dates.js';
import { openScheduleImport } from './gre-schedule.js';

const TABS = [
  ['', 'Today'],
  ['log', 'Problem log'],
  ['retrieval', 'Retrieval'],
  ['audit', 'Audit'],
  ['schedule', 'Schedule'],
];

export function title(ctx) {
  const tab = ctx.route.params[0] ?? '';
  const label = TABS.find(([slug]) => slug === tab)?.[1];
  return label && label !== 'Today' ? `GRE — ${label}` : 'GRE';
}

export function render(ctx) {
  const tab = ctx.route.params[0] ?? '';
  const summary = greSummary(ctx.state, { today: ctx.today });

  const body =
    tab === 'log' ? renderLog(ctx)
      : tab === 'retrieval' ? renderRetrieval(ctx)
        : tab === 'audit' ? renderAudit(ctx)
          : tab === 'schedule' ? renderSchedule(ctx)
            : renderToday(ctx, summary);

  return el('div', [
    pageHead('GRE', {
      sub: summary.daysLeft !== null
        ? `${summary.daysLeft} day${summary.daysLeft === 1 ? '' : 's'} left in the window`
        : 'A fixed daily programme with an end date.',
      actions: [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Log a problem',
          onclick: () => editEntry(ctx, null),
        }),
        summary.dueToday
          ? el('a.btn', { href: '#/gre/retrieval', text: `Retrieval (${summary.dueToday})` })
          : null,
      ].filter(Boolean),
    }),
    el('nav.tabs', { 'aria-label': 'GRE sections' }, TABS.map(([slug, label]) =>
      el('a.tab' + (slug === tab ? '.tab--on' : ''), {
        href: slug ? `#/gre/${slug}` : '#/gre',
        text: label,
        'aria-current': slug === tab ? 'page' : null,
      }))),
    body,
  ]);
}

function section(heading, meta, children) {
  return el('section.section', [
    el('div.section__head', [
      el('h2.section__title', { text: heading }),
      el('div.section__rule'),
      meta ? el('span.section__meta', { text: meta }) : null,
    ]),
    el('div.stack', children),
  ]);
}

// --- today ------------------------------------------------------------------

function renderToday(ctx, summary) {
  if (!days(ctx.state).length) {
    return empty(
      'No schedule yet',
      'The programme is a fixed daily shape with an end date, so it lives in your data rather than in the app: which days exist, which phase each belongs to, which blocks run when, and each day\'s assigned topics. Paste it in and the day view builds itself.',
      el('button.btn.btn--primary', { type: 'button', text: 'Set up the schedule', onclick: () => openScheduleImport(ctx) }),
    );
  }

  const day = summary.day;
  if (!day) return el('p.muted', { text: 'The schedule has no dated days yet.' });

  const list = blocksForDay(ctx.state, day);
  const notYet = blocksNotYetDue(ctx.state, day);
  const progress = dayProgress(ctx.state, day);
  const phase = phaseById(ctx.state, day.phaseId);
  const gate = phase ? gateStatus(ctx.state, phase, { today: ctx.today }) : { hasGate: false };
  const isToday = day.date === ctx.today;

  return el('div.stack', [
    el('div.row', [
      el('strong', { text: `Day ${day.dayNumber}` }),
      day.date ? el('span.section__meta', { text: formatLongDate(day.date) }) : null,
      !isToday && day.date ? tag(relativeDay(day.date, ctx.today), 'amber') : null,
      phase ? tag(phase.name, 'teal') : null,
      isCheckpoint(day) ? tag('checkpoint', 'amber') : null,
      tag(`${formatDuration(dayMinutes(ctx.state, day))} of blocks`),
    ]),

    isCheckpoint(day)
      ? el('div.banner.banner--warn', [
          el('div.banner__body', [
            el('div.banner__title', { text: 'Checkpoint day' }),
            el('div.banner__text', {
              text: `${day.checkpoint}. The normal blocks do not run today — only the ones that run every day without exception.`,
            }),
          ]),
        ])
      : null,

    meter(progress.total ? progress.done / progress.total : 0, progress.complete ? 'complete' : ''),

    el('div.stack--tight.stack', list.map((entry) => blockRow(ctx, day, entry))),

    notYet.length
      ? el('p.field__hint', {
          text: notYet.map((block) => `${block.code} — ${block.name} starts on day ${block.notBeforeDay}: ${block.description}`).join(' · '),
        })
      : null,

    el('div.grid.grid--4', [
      statTile(`${progress.done}/${progress.total}`, 'blocks done', progress.complete ? 'teal' : ''),
      statTile(summary.vocab.streak, `day ${summary.vocab.name ?? 'vocab'} streak`,
        summary.vocab.streak ? 'teal' : ''),
      statTile(summary.daysLeft ?? '—', 'days left'),
      statTile(summary.dueToday, 'due for retrieval', summary.dueToday ? 'amber' : ''),
    ]),

    summary.vocab.code && !summary.vocab.doneToday && isToday
      ? el('p.field__hint', {
          text: `${summary.vocab.name} is the one that breaks if it is skipped — it runs every day, checkpoints included.`,
        })
      : null,

    gate.hasGate ? gatePanel(ctx, phase, gate) : null,

    section('Where the modules are', null, [modulePanel(ctx, day)]),
  ]);
}

function blockRow(ctx, day, { block, topic, done }) {
  return el('div.card.gre-block', { dataset: { code: block.code, done: String(done) } }, [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('button.upnext__tick' + (done ? '.upnext__tick--on' : ''), {
            type: 'button',
            'aria-label': `Mark ${block.code} — ${block.name} ${done ? 'not done' : 'done'}`,
            'aria-pressed': String(done),
            onclick: () => ctx.commit('tick block', () => toggleBlock(day, block.code), { undoable: false }),
          }, [el('span', { text: done ? '✓' : '' })]),
          el('span.mono.gre-block__code', { text: block.code }),
          el('strong.break', { text: block.name }),
          block.pinFirst ? tag('first', 'amber') : null,
          block.everyDay ? tag('every day', 'teal') : null,
        ]),
        tag(formatDuration(block.minutes)),
      ]),
      // The assigned topic, not a generic label — that is the whole point of
      // assigning it a day in advance.
      block.hasTopic
        ? topic
          ? el('div.gre-topic.break', { text: topic })
          : el('div.field__error', { text: 'No topic assigned for today. A block with no slice is a block that drifts.' })
        : null,
      block.description ? el('p.field__hint', { text: block.description }) : null,
      block.pinFirst
        ? el('a.btn.btn--sm', { href: '#/gre/retrieval', text: 'Open the queue' })
        : null,
    ]),
  ]);
}

function gatePanel(ctx, phase, gate) {
  return el('div.banner' + (gate.missed ? '.banner--danger' : gate.met ? '' : '.banner--warn'), [
    el('div.banner__body', [
      el('div.banner__title', {
        text: gate.missed
          ? `${phase.name} missed its gate: module ${gate.gateModule} by day ${gate.gateDay}`
          : gate.met
            ? `${phase.name} has met its gate — module ${gate.gateModule} by day ${gate.gateDay}`
            : `${phase.name}: module ${gate.gateModule} by day ${gate.gateDay}`,
      }),
      el('div.banner__text', {
        text: gate.missed
          ? `Reached module ${gate.reached ?? 0}. A missed gate is the signal to change the plan, not to push on with it.`
          : `Reached module ${gate.reached ?? 0} of ${gate.gateModule}${gate.daysToGate !== null ? `, ${gate.daysToGate} day(s) to the gate` : ''}.`,
      }),
      meter(gate.ratio, gate.met ? 'complete' : ''),
    ]),
  ]);
}

function modulePanel(ctx, day) {
  const box = input({
    type: 'number',
    min: '0',
    value: day.moduleReached ?? '',
    'aria-label': 'Module reached',
    className: 'input--num',
  });
  box.addEventListener('change', () => {
    const value = box.value.trim();
    ctx.commit('record module', () => {
      day.moduleReached = value === '' ? null : Math.max(0, Number(value) || 0);
    }, { undoable: false });
  });

  return el('div.card', [
    el('div.card__body.stack--tight.stack', [
      el('div.row', [
        el('span.field__label', { text: `Module reached by the end of day ${day.dayNumber}` }),
        box,
      ]),
      el('p.field__hint', {
        text: 'What the concept block got to. This is what a phase gate is checked against, so a day it did not move can simply be left blank.',
      }),
    ]),
  ]);
}

// --- the problem log --------------------------------------------------------

function renderLog(ctx) {
  const all = entries(ctx.state);
  const withoutPortable = all.filter((entry) => !isLoggable(entry));

  return el('div.stack', [
    el('div.row', [
      el('button.btn.btn--primary', { type: 'button', text: 'Log a problem', onclick: () => editEntry(ctx, null) }),
      el('span.field__hint', {
        text: 'Log correct answers too. A right answer reached the slow way is a miss you did not notice.',
      }),
    ]),

    withoutPortable.length
      ? el('div.banner.banner--warn', [
          el('div.banner__body', [
            el('div.banner__title', { text: `${withoutPortable.length} entr${withoutPortable.length === 1 ? 'y has' : 'ies have'} no portable move` }),
            el('div.banner__text', { text: 'They came in from an import. The editor will not save one without it.' }),
          ]),
        ])
      : null,

    all.length
      ? el('div.stack--tight.stack', all.slice(0, 80).map((entry) => entryCard(ctx, entry)))
      : empty(
          'Nothing logged',
          'Four fields per problem, and the fourth is the point: one rule about problems in general, roughly six words. Everything else here is scaffolding for that.',
          el('button.btn.btn--primary', { type: 'button', text: 'Log the first problem', onclick: () => editEntry(ctx, null) }),
        ),
    all.length > 80 ? el('p.muted', { text: `…and ${all.length - 80} older entries.` }) : null,
  ]);
}

function entryCard(ctx, entry) {
  const source = entry.appliedFrom ? entryById(ctx.state, entry.appliedFrom) : null;
  return el('div.card.gre-entry', { dataset: { correct: String(entry.correct) } }, [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('span.mono.faint', { text: formatDate(entry.date) }),
          entry.dayNumber ? tag(`day ${entry.dayNumber}`) : null,
          tag(entry.correct ? 'correct' : 'missed', entry.correct ? 'teal' : 'danger'),
          entry.correct ? null : tag(entry.cause, entry.cause === 'concept' ? 'amber' : ''),
          entry.source ? el('span.section__meta.break', { text: entry.source }) : null,
        ]),
        el('div.row', [
          entry.retired
            ? tag('retrieved clean', 'teal')
            : entry.dueDate ? tag(`due ${formatDate(entry.dueDate)}`) : null,
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Edit',
            'aria-label': `Edit the entry from ${entry.date}`,
            onclick: () => editEntry(ctx, entry),
          }),
        ]),
      ]),
      entry.gave ? el('p.break', { text: entry.gave }) : null,
      entry.did ? el('p.muted.break', { text: `Did: ${entry.did}` }) : null,
      entry.broke ? el('p.muted.break', { text: `${entry.correct ? 'Faster route' : 'Broke'}: ${entry.broke}` }) : null,
      isLoggable(entry)
        ? el('div.portable.break', { text: entry.portable })
        : tag('no portable move', 'danger'),
      source
        ? el('div.row', [
            tag('a previous portable move applied here', 'teal'),
            el('span.section__meta.break', { text: source.portable }),
          ])
        : null,
    ]),
  ]);
}

const PORTABLE_HINT = 'A rule about problems in general, not about this one. ' +
  'Good: "check units before choosing the answer". ' +
  'Bad: "remember that this triangle was isosceles". ' +
  'Roughly six words.';

async function editEntry(ctx, entry) {
  const isNew = !entry;
  const day = currentDay(ctx.state, ctx.today);
  const prior = priorEntries(ctx.state, entry);

  const values = await editRecord({
    title: isNew ? 'Log a problem' : 'Entry',
    submitLabel: isNew ? 'Log it' : 'Save',
    deletable: !isNew,
    wide: true,
    fields: [
      { key: 'date', label: 'Date', type: 'date', default: ctx.today },
      {
        key: 'dayNumber',
        label: 'Programme day',
        type: 'number',
        default: entry?.dayNumber ?? day?.dayNumber ?? null,
        hint: 'Which day of the schedule this belongs to. The audit groups by phase using it.',
      },
      { key: 'source', label: 'Problem ID or source', placeholder: 'e.g. OG2 Q47, or a link' },
      {
        key: 'gave',
        label: '1. What it gave and what it asked',
        type: 'textarea',
        rows: 2,
        hint: 'In your own words, one line. If you cannot restate it, you did not read it.',
      },
      { key: 'did', label: '2. What you did', type: 'textarea', rows: 2 },
      {
        key: 'broke',
        label: '3. Where it broke — or the faster route',
        type: 'textarea',
        rows: 2,
        hint: 'If you got it right, this is what the quicker route would have been.',
      },
      {
        key: 'portable',
        label: '4. The portable move',
        type: 'textarea',
        rows: 2,
        required: true,
        requiredMessage: `This is the field the whole log exists for. If you cannot write it, the extraction did not happen — the entry is not saved without it. ${PORTABLE_HINT}`,
        hint: PORTABLE_HINT,
      },
      { key: 'correct', label: 'I got it right', type: 'checkbox' },
      {
        key: 'cause',
        label: 'Cause',
        type: 'select',
        options: GRE_CAUSES,
        default: 'concept',
        hint: 'For a miss. On a correct answer reached slowly, the cause is still worth naming.',
      },
      {
        key: 'appliedFrom',
        label: 'A previous portable move applied here',
        type: 'select',
        options: [
          { value: '', label: 'No — this is new' },
          ...prior.map((other) => ({
            value: other.id,
            label: `${other.date} — ${other.portable.slice(0, 60)}`,
          })),
        ],
        hint: 'This is the number the whole thing is measured by: a move written for one problem firing on a later, unseen one.',
      },
    ],
    values: entry ?? { date: ctx.today, dayNumber: day?.dayNumber ?? null },
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this entry?',
      message: 'It leaves the retrieval queue and stops counting in the audit.',
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete GRE entry', (state) => {
      const index = state.greEntries.findIndex((e) => e.id === entry.id);
      if (index >= 0) state.greEntries.splice(index, 1);
      // A hit pointing at a deleted entry would be counted forever with nothing
      // behind it.
      for (const other of state.greEntries) {
        if (other.appliedFrom === entry.id) other.appliedFrom = null;
      }
    });
    return;
  }

  const patch = {
    date: values.date || ctx.today,
    dayNumber: values.dayNumber ?? null,
    source: values.source,
    gave: values.gave,
    did: values.did,
    broke: values.broke,
    portable: values.portable,
    correct: !!values.correct,
    cause: GRE_CAUSES.includes(values.cause) ? values.cause : 'concept',
    appliedFrom: values.appliedFrom || null,
  };

  if (isNew) {
    ctx.commit('log a GRE problem', (state) => {
      state.greEntries.push(makeGreEntry({
        ...patch,
        ...initialRetrieval(state, patch.date),
      }));
    }, { undoable: false });
    toast('Logged. It comes back for a cold re-attempt in a few days.', {
      action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } },
    });
    return;
  }
  ctx.commit('edit GRE entry', () => Object.assign(entry, patch), { undoable: false });
}

// --- retrieval --------------------------------------------------------------

function renderRetrieval(ctx) {
  const queue = retrievalQueue(ctx.state, { today: ctx.today });
  // An entry answered today has left the queue, but its notes are exactly what
  // should be read now — hiding them at the moment they become useful would
  // undo the whole point of keeping them hidden before.
  const answeredToday = entries(ctx.state)
    .filter((entry) => retrievalRevealed(entry, { today: ctx.today }))
    .filter((entry) => !queue.some((q) => q.entry.id === entry.id))
    .map((entry) => ({ entry, prompt: { id: entry.id, source: entry.source, date: entry.date }, overdueBy: 0 }));
  const shown = [...queue, ...answeredToday];
  const block = blocks(ctx.state).find((b) => b.pinFirst);

  return el('div.stack', [
    el('p.field__hint', {
      text: block
        ? `${block.code} — ${block.name}, ${block.minutes} minutes. ${block.description}`
        : 'Cold re-attempts of problems logged a few days ago.',
    }),
    queue.length
      ? el('p.field__hint', { text: `${queue.length} to re-attempt.` })
      : null,
    shown.length
      ? el('div.stack', shown.map(({ entry, prompt, overdueBy }) => retrievalCard(ctx, entry, prompt, overdueBy)))
      : empty(
          'Nothing due',
          'Entries come back three days after they are logged, then ten. Nothing due means nothing is ready to be tested cold.',
          el('a.btn', { href: '#/gre/log', text: 'Open the log' }),
        ),
  ]);
}

function retrievalCard(ctx, entry, prompt, overdueBy) {
  const revealed = retrievalRevealed(entry, { today: ctx.today });

  return el('div.card.retrieval', { dataset: { revealed: String(revealed) } }, [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('strong.break', { text: prompt.source || 'A problem with no reference' }),
          el('span.section__meta', { text: `logged ${formatDate(prompt.date)}` }),
          overdueBy > 0 ? tag(`${overdueBy}d overdue`, 'amber') : null,
        ]),
        revealed ? tag('recorded today', 'teal') : tag('cold', 'locked'),
      ]),

      revealed
        ? el('div.stack--tight.stack', [
            entry.gave ? el('p.break', { text: entry.gave }) : null,
            entry.broke ? el('p.muted.break', { text: entry.broke }) : null,
            el('div.portable.break', { text: entry.portable }),
          ])
        : el('div.stack--tight.stack', [
            // The whole value of a cold re-attempt is that it is cold. Showing
            // the notes first would turn it into recognition.
            el('p.field__hint', {
              text: 'Re-attempt it first. What you wrote about it stays hidden until a result is recorded — otherwise this is recognition, not retrieval.',
            }),
            el('div.row', [
              el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: 'Got it',
                'aria-label': `Record a correct re-attempt of ${prompt.source || 'this problem'}`,
                onclick: () => record(ctx, entry, true),
              }),
              el('button.btn.btn--danger.btn--sm', {
                type: 'button',
                text: 'Missed it again',
                'aria-label': `Record a failed re-attempt of ${prompt.source || 'this problem'}`,
                onclick: () => record(ctx, entry, false),
              }),
            ]),
          ]),
    ]),
  ]);
}

function record(ctx, entry, correct) {
  const outcome = ctx.commit('record a re-attempt', (state) => {
    const target = state.greEntries.find((e) => e.id === entry.id);
    if (!target) return null;
    return recordRetrieval(state, target, makeGreAttempt({ date: ctx.today, correct }));
  }, { undoable: false });

  toast(
    outcome === 'retired'
      ? 'Retrieved clean at the last interval — it leaves the queue.'
      : outcome === 'reset'
        ? 'Back to the start of the chain, due again shortly.'
        : 'Advanced to the next interval.',
    { action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } } },
  );
}

// --- the audit --------------------------------------------------------------

function renderAudit(ctx) {
  const rows = causeByPhase(ctx.state);
  const hits = portableHits(ctx.state);
  const byPhase = portableHitsByPhase(ctx.state);
  const all = entries(ctx.state);

  if (!all.length) {
    return empty(
      'Nothing to audit yet',
      'This page answers two questions: are concept gaps falling, and are the portable moves firing on problems they were not written for. Both need a log first.',
      el('a.btn', { href: '#/gre/log', text: 'Open the log' }),
    );
  }

  return el('div.stack', [
    // The real output, first and largest.
    section('Portable moves that fired again', 'the number that matters', [
      el('div.grid.grid--3', [
        statTile(hits.total, 'moves that fired on a later problem', hits.total ? 'teal' : ''),
        statTile(`${Math.round(hits.rate * 100)}%`, 'of logged problems'),
        statTile(hits.sources.length, 'distinct moves that carried'),
      ]),
      el('p.field__hint', {
        text: 'A move written for one problem firing on a later, unseen one. This is the output of the whole log — a score would only say how the day went.',
      }),
      hits.sources.length
        ? el('div.card', [
            el('div.card__body.stack--tight.stack', hits.sources.map(({ source, hits: fired }) =>
              el('div.row.row--between', [
                el('div.row', [
                  tag(`${fired.length}×`, fired.length > 1 ? 'teal' : ''),
                  el('span.break', { text: source.portable }),
                ]),
                el('span.section__meta', { text: `written ${formatDate(source.date)}` }),
              ]))),
          ])
        : el('p.field__hint', {
            text: 'None yet. When an entry is logged, the form asks whether an earlier portable move applied — that is where this number comes from.',
          }),
      byPhase.some((row) => row.hits)
        ? el('div.stack--tight.stack', [
            el('span.field__label', { text: 'By phase' }),
            ...byPhase.map((row) =>
              el('div.dist', [
                el('div.truncate', { text: row.name }),
                el('div.dist__bars', [
                  el('div.dist__bar', [
                    el('div.dist__fill.dist__fill--actual', {
                      style: { width: `${(row.hits / Math.max(1, ...byPhase.map((r) => r.hits))) * 100}%` },
                    }),
                  ]),
                ]),
                el('div.mono', { text: String(row.hits) }),
              ])),
          ])
        : null,
    ]),

    section('Why problems were missed', 'per phase, so early can be set against late', [
      rows.length
        ? el('div.card', [
            el('div.card__body.stack.stack--tight', rows.map((row) => causeRow(row))),
          ])
        : el('p.muted', { text: 'No phases defined, so there is nothing to compare against.' }),
      el('p.field__hint', {
        text: 'The share is of misses, not of everything logged — correct answers are in the log too, and would otherwise dilute it. The concept share falling over time is the thing to watch.',
      }),
    ]),
  ]);
}

function causeRow(row) {
  return el('div.stack--tight.stack', [
    el('div.row.row--between', [
      el('strong.break', { text: row.name }),
      el('div.row', [
        tag(`${row.logged} logged`),
        tag(`${row.misses} missed`),
        row.misses
          ? tag(`${Math.round(row.conceptShare * 100)}% concept`, row.conceptShare > 0.5 ? 'amber' : 'teal')
          : null,
      ]),
    ]),
    row.misses
      ? el('div.causebar', GRE_CAUSES.map((cause) =>
          row.counts[cause]
            ? el(`div.causebar__part.causebar__part--${cause}`, {
                style: { width: `${row.shares[cause] * 100}%` },
                title: `${cause}: ${row.counts[cause]} of ${row.misses}`,
              }, [el('span', { text: row.counts[cause] > 0 && row.shares[cause] > 0.12 ? cause : '' })])
            : null))
      : el('p.field__hint', { text: 'Nothing missed in this phase.' }),
  ]);
}

// --- the schedule -----------------------------------------------------------

function renderSchedule(ctx) {
  const list = days(ctx.state);
  const phaseList = phases(ctx.state);

  return el('div.stack', [
    el('div.row', [
      el('button.btn', { type: 'button', text: list.length ? 'Replace the schedule' : 'Set up the schedule', onclick: () => openScheduleImport(ctx) }),
      blocks(ctx.state).length
        ? null
        : el('button.btn', {
            type: 'button',
            text: 'Add the default blocks',
            onclick: () => {
              const added = ctx.commit('seed GRE blocks', (state) => seedBlocks(state));
              toast(`${added} blocks added. Edit their names, durations and rules here.`);
            },
          }),
    ]),

    section('Blocks', `${blocks(ctx.state).length}`, [
      blocks(ctx.state).length
        ? el('div.card', [
            el('div.card__body.stack--tight.stack', blocks(ctx.state).map((block) =>
              el('div.row.row--between', [
                el('div.row', [
                  el('span.mono.gre-block__code', { text: block.code }),
                  el('strong', { text: block.name }),
                  tag(formatDuration(block.minutes)),
                  block.pinFirst ? tag('always first', 'amber') : null,
                  block.everyDay ? tag('every day', 'teal') : null,
                  block.notBeforeDay ? tag(`from day ${block.notBeforeDay}`) : null,
                  block.hasTopic ? tag('has a daily topic') : null,
                ]),
                el('button.btn.btn--ghost.btn--sm', {
                  type: 'button',
                  text: 'Edit',
                  'aria-label': `Edit block ${block.code}`,
                  onclick: () => editBlock(ctx, block),
                }),
              ]))),
          ])
        : el('p.field__hint', { text: 'No blocks defined. The default set is a starting point, not the plan.' }),
    ]),

    section('Phases', `${phaseList.length}`, [
      phaseList.length
        ? el('div.card', [
            el('div.card__body.stack--tight.stack', phaseList.map((phase) => {
              const gate = gateStatus(ctx.state, phase, { today: ctx.today });
              return el('div.row.row--between', [
                el('div.row', [
                  el('strong', { text: phase.name }),
                  gate.hasGate
                    ? tag(`module ${gate.gateModule} by day ${gate.gateDay}`,
                        gate.missed ? 'danger' : gate.met ? 'teal' : '')
                    : tag('no gate', 'locked'),
                  gate.missed ? tag('missed', 'danger') : null,
                ]),
                el('span.section__meta', { text: `${days(ctx.state).filter((d) => d.phaseId === phase.id).length} days` }),
              ]);
            })),
          ])
        : el('p.muted', { text: 'No phases yet.' }),
    ]),

    section('Days', `${list.length}`, [
      list.length
        ? el('table.table', [
            el('thead', [el('tr', [
              el('th', { text: 'Day' }),
              el('th', { text: 'Date' }),
              el('th', { text: 'Phase' }),
              el('th', { text: 'Blocks' }),
              el('th', { text: 'Topics' }),
            ])]),
            el('tbody', list.map((day) =>
              el('tr', { dataset: { day: String(day.dayNumber) } }, [
                el('td.mono', { text: String(day.dayNumber) }),
                el('td.mono', { text: day.date ? formatDate(day.date) : '—' }),
                el('td', { text: phaseById(ctx.state, day.phaseId)?.name ?? '—' }),
                el('td', {
                  text: isCheckpoint(day) ? `checkpoint: ${day.checkpoint}` : (day.blockCodes ?? []).join(', ') || '—',
                }),
                el('td.break', {
                  text: Object.entries(day.topics ?? {}).map(([code, topic]) => `${code}: ${topic}`).join(' · ') || '—',
                }),
              ]))),
          ])
        : el('p.muted', { text: 'No days yet.' }),
    ]),
  ]);
}

async function editBlock(ctx, block) {
  const values = await editRecord({
    title: `Block ${block.code}`,
    wide: true,
    fields: [
      { key: 'code', label: 'Code', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'minutes', label: 'Minutes', type: 'number' },
      { key: 'description', label: 'What it is', type: 'textarea', rows: 2 },
      { key: 'notBeforeDay', label: 'Not before day', type: 'number', hint: 'Leave blank to run from day one.' },
      { key: 'pinFirst', label: 'Always drawn first', type: 'checkbox' },
      { key: 'everyDay', label: 'Runs every day, checkpoints included', type: 'checkbox' },
      { key: 'hasTopic', label: 'Carries a topic assigned per day', type: 'checkbox' },
    ],
    values: block,
  });
  if (!values || values.__delete) return;

  ctx.commit('edit GRE block', () => {
    Object.assign(block, {
      code: values.code.toUpperCase(),
      name: values.name,
      minutes: Math.max(0, Number(values.minutes) || 0),
      description: values.description,
      notBeforeDay: values.notBeforeDay ?? null,
      pinFirst: !!values.pinFirst,
      everyDay: !!values.everyDay,
      hasTopic: !!values.hasTopic,
    });
  }, { undoable: false });
}
