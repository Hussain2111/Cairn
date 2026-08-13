// Question banks and the review queue.

import { el, tag, empty, openDialog, confirm, toast } from '../ui.js';
import { pageHead, editRecord, statTile } from './shared.js';
import {
  reviewQueue,
  recordAttempt,
  scheduleAfterAttempt,
  chainPosition,
  questionStats,
  lastAttempt,
  findDuplicateQuestion,
  mergeQuestion,
  normaliseIntervals,
} from '../../core/srs.js';
import {
  makeQuestion,
  makeAttempt,
  makeExtraction,
  hasExtraction,
  BANKS,
  BANK_LABELS,
  BANK_FIELDS,
  DIFFICULTIES,
  MISS_CAUSES,
} from '../../core/schema.js';
import { formatDate, relativeDay, todayISO } from '../../core/dates.js';

export function title(ctx) {
  const bank = ctx.route.params[0];
  if (bank === 'review') return 'Review queue';
  return bank ? `${BANK_LABELS[bank] ?? 'Questions'}` : 'Questions';
}

export function render(ctx) {
  const param = ctx.route.params[0];
  if (ctx.route.name === 'review' || param === 'review') return renderReview(ctx);
  if (BANKS.includes(param)) return renderBank(ctx, param);
  return renderOverview(ctx);
}

// --- overview ---------------------------------------------------------------

function renderOverview(ctx) {
  const today = ctx.today;
  const due = reviewQueue(ctx.state, { today });
  const stats = questionStats(ctx.state.questions);

  return el('div', [
    pageHead('Questions', {
      sub: 'Practice is scheduled, not chosen. Intervals: ' + normaliseIntervals(ctx.state.settings.srsIntervals).join(' / ') + ' days.',
      actions: [
        due.length ? el('a.btn.btn--primary', { href: '#/questions/review', text: `Review ${due.length} due` }) : null,
        el('button.btn', { type: 'button', text: 'Add question', onclick: () => addQuestion(ctx, 'sql') }),
      ].filter(Boolean),
    }),

    el('div.grid.grid--3', [
      statTile(due.length, 'due today', due.length ? 'amber' : ''),
      statTile(stats.active, 'in rotation'),
      statTile(stats.retired, 'retired', 'teal'),
      statTile(`${Math.round(stats.unaidedRate * 100)}%`, 'attempts unaided'),
    ]),

    el('div.grid.grid--3', { style: { marginTop: 'var(--sp-4)' } }, BANKS.map((bank) => {
      const questions = ctx.state.questions.filter((q) => q.bank === bank);
      const bankDue = questions.filter((q) => !q.retired && q.dueDate && q.dueDate <= today).length;
      return el('a.card', { href: `#/questions/${bank}`, style: { color: 'var(--text)' } }, [
        el('div.card__body.stack--tight.stack', [
          el('strong', { text: BANK_LABELS[bank] }),
          el('div.row', [
            tag(`${questions.length} total`),
            bankDue ? tag(`${bankDue} due`, 'amber') : null,
            tag(`${questions.filter((q) => q.retired).length} retired`, 'teal'),
          ]),
        ]),
      ]);
    })),
  ]);
}

// --- one bank ---------------------------------------------------------------

function renderBank(ctx, bank) {
  const today = ctx.today;
  const showRetired = ctx.route.query.get('retired') === '1';
  const focusId = ctx.route.query.get('focus');
  const all = ctx.state.questions.filter((q) => q.bank === bank);
  const questions = all
    .filter((q) => (showRetired ? q.retired : !q.retired))
    .sort((a, b) => String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')));

  return el('div', [
    pageHead(BANK_LABELS[bank], {
      sub: `${all.length} question(s) · ${all.filter((q) => q.retired).length} retired`,
      actions: [
        el('a.btn.btn--ghost', { href: '#/questions', text: 'All banks' }),
        el('button.btn.btn--primary', { type: 'button', text: 'Add question', onclick: () => addQuestion(ctx, bank) }),
      ],
    }),

    el('div.row', { style: { marginBottom: 'var(--sp-3)' } }, [
      el('a.btn.btn--sm' + (showRetired ? '.btn--ghost' : ''), { href: `#/questions/${bank}`, text: 'In rotation' }),
      el('a.btn.btn--sm' + (showRetired ? '' : '.btn--ghost'), { href: `#/questions/${bank}?retired=1`, text: 'Retired' }),
    ]),

    questions.length
      ? el('div.card', questions.map((q) => questionRow(ctx, q, today, focusId)))
      : empty(
          showRetired ? 'Nothing retired yet' : `No ${BANK_LABELS[bank]} questions`,
          showRetired
            ? 'A question retires once you solve it unaided and without hesitation at the final interval.'
            : 'Add the first one. Every attempt records what you hesitated on, which is the part worth re-reading later.',
          showRetired ? null : el('button.btn.btn--primary', { type: 'button', text: 'Add question', onclick: () => addQuestion(ctx, bank) }),
        ),
  ]);
}

function questionRow(ctx, question, today, focusId) {
  const chain = chainPosition(question, ctx.state.settings.srsIntervals);
  const last = lastAttempt(question);
  const overdue = !question.retired && question.dueDate && question.dueDate < today;

  const row = el('div.q-row' + (question.retired ? '.q-row--retired' : ''), { dataset: { id: question.id } }, [
    el('div', [
      el('div.q-row__title.break', { text: question.title }),
      el('div.q-row__meta', [
        tag(question.difficulty),
        ...(question.tags ?? []).map((t) => tag(t)),
        ...Object.entries(question.fields ?? {}).filter(([, v]) => v).map(([, v]) => tag(String(v))),
        question.url ? el('a.tag', { href: question.url, target: '_blank', rel: 'noopener noreferrer', text: 'source' }) : null,
        el('span.chain', { title: `Interval chain: ${chain.intervals.join(' / ')} days` },
          chain.intervals.map((_, i) =>
            el('span.chain__pip' + (i < chain.index ? '.chain__pip--done' : i === chain.index ? '.chain__pip--current' : '')))),
      ]),
      last?.hesitation
        ? el('div.hesitation', { style: { marginTop: 'var(--sp-2)' }, text: `Hesitated on: ${last.hesitation}` })
        : null,
      // The portable move is the output of the whole exercise, so it reads on
      // the row rather than behind a click.
      question.extraction?.portable
        ? el('div.portable', { style: { marginTop: 'var(--sp-2)' }, text: question.extraction.portable })
        : null,
    ]),
    el('div.row', [
      question.retired
        ? tag(`retired ${formatDate(question.retiredAt)}`, 'teal')
        : tag(`${formatDate(question.dueDate)} · ${relativeDay(question.dueDate, today)}`, overdue ? 'danger' : question.dueDate === today ? 'amber' : ''),
      el('button.btn.btn--sm', { type: 'button', text: 'Attempt', onclick: () => logAttempt(ctx, question) }),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: hasExtraction(question) ? 'Extraction' : 'Extract',
        'aria-label': `Extraction for ${question.title}`,
        onclick: () => openExtraction(ctx, question),
      }),
      el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Edit', onclick: () => editQuestion(ctx, question) }),
    ]),
  ]);
  if (focusId === question.id) row.classList.add('is-focused');
  return row;
}

// --- the review queue -------------------------------------------------------

function renderReview(ctx) {
  const today = ctx.today;
  const queue = reviewQueue(ctx.state, { today });

  if (!queue.length) {
    return el('div', [
      pageHead('Review queue', { sub: formatDate(today) }),
      empty(
        'Nothing due today',
        'The scheduler decides when each question comes back. Everything currently in rotation is scheduled for a later date.',
        el('a.btn', { href: '#/questions', text: 'Back to the banks' }),
      ),
    ]);
  }

  const entry = queue[0];
  const question = entry.question;
  const chain = chainPosition(question, ctx.state.settings.srsIntervals);

  return el('div', [
    pageHead('Review queue', {
      sub: `${queue.length} due · ${BANK_LABELS[question.bank]}`,
      actions: [el('a.btn.btn--ghost', { href: '#/questions', text: 'All banks' })],
    }),

    el('div.review-card.stack', [
      el('div.row', [
        tag(BANK_LABELS[question.bank], 'amber'),
        tag(question.difficulty),
        entry.overdueBy > 0 ? tag(`${entry.overdueBy}d overdue`, 'danger') : tag('due today', 'amber'),
        el('div.spacer'),
        el('span.chain', chain.intervals.map((_, i) =>
          el('span.chain__pip' + (i < chain.index ? '.chain__pip--done' : i === chain.index ? '.chain__pip--current' : '')))),
      ]),
      el('h2.page-title.break', { text: question.title }),
      question.url
        ? el('a', { href: question.url, target: '_blank', rel: 'noopener noreferrer', text: question.url })
        : null,
      el('div.row', (question.tags ?? []).map((t) => tag(t))),
      priorHesitations(question),
      question.extraction?.portable
        ? el('div.stack--tight.stack', [
            el('span.field__label', { text: 'The move you took from it last time' }),
            el('div.portable', { text: question.extraction.portable }),
          ])
        : null,
      el('div.row', [
        el('button.btn.btn--primary', { type: 'button', text: 'Record attempt', onclick: () => logAttempt(ctx, question) }),
        el('button.btn', { type: 'button', text: 'Extract', onclick: () => openExtraction(ctx, question) }),
        el('button.btn.btn--ghost', { type: 'button', text: 'Skip for now', onclick: () => skip(ctx, question) }),
      ]),
    ]),

    queue.length > 1
      ? el('section.section', { style: { marginTop: 'var(--sp-5)' } }, [
          el('div.section__head', [
            el('h2.section__title', { text: 'Also due' }),
            el('div.section__rule'),
            el('span.section__meta', { text: `${queue.length - 1} more` }),
          ]),
          el('div.card', queue.slice(1).map((e) => questionRow(ctx, e.question, today, null))),
        ])
      : null,
  ]);
}

function priorHesitations(question) {
  const rows = (question.attempts ?? []).filter((a) => a.hesitation?.trim()).slice(-3).reverse();
  if (!rows.length) return null;
  return el('div.stack--tight.stack', [
    el('span.field__label', { text: 'What you hesitated on before' }),
    ...rows.map((a) => el('div.hesitation', { text: `${a.date ? formatDate(a.date) : 'undated'} — ${a.hesitation}` })),
  ]);
}

function skip(ctx, question) {
  ctx.commit('skip question', () => {
    question.dueDate = todayISO();
  }, { undoable: false, message: null });
  toast('Skipped — it stays due today.');
}

// --- attempts ---------------------------------------------------------------

async function logAttempt(ctx, question) {
  const unaided = el('input', { type: 'checkbox' });
  const minutes = el('input.input', { type: 'number', min: '0', step: '1', placeholder: 'e.g. 18' });
  const hesitation = el('textarea.textarea', {
    rows: 3,
    placeholder: 'What made you pause? Write it even if you solved it.',
  });
  const date = el('input.input', { type: 'date', value: todayISO() });
  const preview = el('div.field__hint');

  const read = () => ({
    date: date.value || todayISO(),
    unaided: unaided.checked,
    minutes: minutes.value === '' ? null : Number(minutes.value),
    hesitation: hesitation.value.trim(),
  });

  // The dialog says what the scheduler will do before you commit to it, so the
  // consequence of ticking "unaided" is never a surprise.
  const updatePreview = () => {
    const patch = scheduleAfterAttempt(question, makeAttempt(read()), ctx.state.settings.srsIntervals);
    preview.textContent = patch.retired
      ? 'This attempt retires the question.'
      : patch.outcome === 'reset'
        ? 'This resets the chain — it will be due again today.'
        : patch.outcome === 'held'
          ? `Hesitation blocks retirement: it holds at the final interval, next review ${formatDate(patch.dueDate)}.`
          : `Next review: ${formatDate(patch.dueDate)} (${relativeDay(patch.dueDate, ctx.today)}).`;
  };
  for (const node of [unaided, minutes, hesitation, date]) {
    node.addEventListener('input', updatePreview);
    node.addEventListener('change', updatePreview);
  }
  updatePreview();

  const result = await openDialog({
    title: 'Attempt',
    wide: true,
    body: el('div.stack', [
      el('div.break', { text: question.title }),
      el('label.check', [unaided, el('span', { text: 'Solved it unaided' })]),
      el('div.field-row', [
        el('label.field', [el('span.field__label', { text: 'Minutes' }), minutes]),
        el('label.field', [el('span.field__label', { text: 'Date' }), date]),
      ]),
      el('label.field', [
        el('span.field__label', { text: 'What I hesitated on' }),
        hesitation,
        el('span.field__hint', { text: 'Hesitation does not reset the chain, but it does block retirement.' }),
      ]),
      preview,
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', { type: 'button', text: 'Record', onclick: () => close(read()) }),
    ],
  });
  if (!result) return;

  let outcome = null;
  ctx.commit('record attempt', () => {
    outcome = recordAttempt(question, makeAttempt(result), ctx.state.settings.srsIntervals);
  }, { undoable: false });

  const message = {
    retired: 'Retired — solved unaided at the final interval.',
    reset: 'Back to the start of the chain. Due again today.',
    advanced: `Next review ${formatDate(question.dueDate)}.`,
    held: `Hesitation recorded, so it stays at the final interval. Next review ${formatDate(question.dueDate)}.`,
  }[outcome];

  // Straight after a miss is the one moment the extraction can actually be
  // written — later you remember the answer, not the mistake. So it is offered
  // here, but as an offer: a dialog that opens itself on every wrong answer
  // stops being a prompt and becomes a toll.
  const offerExtraction = !result.unaided && !hasExtraction(question);
  toast(message, {
    action: offerExtraction
      ? { label: 'Extract', onClick: () => openExtraction(ctx, question) }
      : { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } },
    timeout: offerExtraction ? 12000 : 7000,
  });
}

// --- the extraction ---------------------------------------------------------
//
// Four fields, and the fourth is the point. This came out of the GRE tab, which
// scheduled study days as well — GregMat already does that, so the scheduling
// went and the format stayed. It applies to a SQL window function exactly as
// well as it applied to a quant problem, so it is on every bank rather than one.

/**
 * Open the extraction editor for a question.
 *
 * The portable move is required *once the extraction has been started*, which
 * is the honest version of the old GRE rule. Requiring it on a blank form would
 * mean you could not add a question before attempting it; not requiring it at
 * all would let the first three fields be filled in and the rule — the only
 * part that transfers to a problem you have not seen — quietly skipped.
 */
export async function openExtraction(ctx, question) {
  const current = question.extraction ?? makeExtraction();

  const gave = el('textarea.textarea', { rows: 2, value: current.gave ?? '' , 'aria-label': 'What it gave and asked' });
  const did = el('textarea.textarea', { rows: 2, value: current.did ?? '', 'aria-label': 'What I did' });
  const broke = el('textarea.textarea', { rows: 2, value: current.broke ?? '', 'aria-label': 'Where it broke' });
  const portable = el('input.input', {
    value: current.portable ?? '',
    placeholder: 'e.g. "read the constraint before choosing the join"',
    'aria-label': 'The portable move',
  });
  const cause = el('select.select', { 'aria-label': 'Cause' }, [
    el('option', { value: '', text: '—', selected: !current.cause }),
    ...MISS_CAUSES.map((value) => el('option', { value, text: value, selected: value === current.cause })),
  ]);
  const errorNode = el('div.field__error');

  const result = await openDialog({
    title: 'Extraction',
    wide: true,
    body: el('div.stack', [
      el('div.break', { text: question.title }),
      el('label.field', [
        el('span.field__label', { text: 'What it gave and what it asked' }),
        gave,
        el('span.field__hint', { text: 'In your own words, one line. If you cannot restate it, that is the finding.' }),
      ]),
      el('label.field', [el('span.field__label', { text: 'What I did' }), did]),
      el('label.field', [
        el('span.field__label', { text: 'Where it broke' }),
        broke,
        el('span.field__hint', { text: 'Or, if you got it right, what the faster route was. A right answer reached the slow way is a miss you did not notice.' }),
      ]),
      el('label.field', [
        el('span.field__label', { text: 'The portable move' }),
        portable,
        el('span.field__hint', {
          text: 'Roughly six words, and about problems in general rather than this one. Good: "check the base case before the recursion". Bad: "remember that question 14 uses a CTE".',
        }),
      ]),
      el('label.field', [
        el('span.field__label', { text: 'Cause' }),
        cause,
        el('span.field__hint', { text: 'Optional. Four causes because they need four different responses.' }),
      ]),
      errorNode,
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save',
        onclick: () => {
          const values = {
            gave: gave.value.trim(),
            did: did.value.trim(),
            broke: broke.value.trim(),
            portable: portable.value.trim(),
            cause: cause.value || null,
          };
          const started = values.gave || values.did || values.broke;
          if (started && !values.portable) {
            errorNode.textContent =
              'Write the portable move. It is the only part that reaches a problem you have not seen — if you cannot write it, the extraction has not happened yet.';
            portable.focus();
            return;
          }
          close(values);
        },
      }),
    ],
  });
  if (!result) return;

  ctx.commit('extraction', () => {
    question.extraction = makeExtraction(result);
  }, { undoable: false });
}

// --- add and edit -----------------------------------------------------------

function bankFieldSpecs(bank) {
  return (BANK_FIELDS[bank] ?? []).map((spec) => ({
    key: `field_${spec.key}`,
    label: spec.label,
    type: spec.type === 'select' ? 'select' : 'text',
    options: spec.type === 'select' ? ['', ...spec.options] : undefined,
  }));
}

async function addQuestion(ctx, bank) {
  const values = await editRecord({
    title: `Add to ${BANK_LABELS[bank]}`,
    submitLabel: 'Add',
    wide: true,
    fields: [
      { key: 'bank', label: 'Bank', type: 'select', options: BANKS.map((b) => ({ value: b, label: BANK_LABELS[b] })), default: bank },
      { key: 'title', label: 'Title', required: true },
      { key: 'url', label: 'Source URL', type: 'url', placeholder: 'https://…' },
      { key: 'difficulty', label: 'Difficulty', type: 'select', options: DIFFICULTIES, default: 'medium' },
      { key: 'tags', label: 'Topic tags', placeholder: 'comma separated' },
      ...bankFieldSpecs(bank),
    ],
  });
  if (!values) return;

  const fields = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('field_') && value) fields[key.slice(6)] = value;
  }
  const candidate = {
    bank: values.bank,
    title: values.title,
    url: values.url,
    difficulty: values.difficulty,
    tags: values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    fields,
  };

  const duplicate = findDuplicateQuestion(ctx.state, candidate);
  if (duplicate) {
    const answer = await confirm({
      title: 'This looks like one you already have',
      message:
        `"${duplicate.question.title}" in ${BANK_LABELS[duplicate.question.bank]} matches by ${duplicate.on}. ` +
        `Merging keeps its ${duplicate.question.attempts.length} attempt(s) and its place in the schedule.`,
      confirmLabel: 'Add separately',
      extraLabel: 'Merge into the existing one',
      danger: false,
    });
    if (!answer) return;
    if (answer === 'extra') {
      ctx.commit('merge question', (state) => {
        const index = state.questions.findIndex((q) => q.id === duplicate.question.id);
        state.questions[index] = mergeQuestion(state.questions[index], candidate);
      }, { message: 'Merged' });
      ctx.navigate(`#/questions/${duplicate.question.bank}?focus=${duplicate.question.id}`);
      return;
    }
  }

  ctx.commit('add question', (state) => {
    state.questions.push(makeQuestion(candidate));
  }, { undoable: false });
}

async function editQuestion(ctx, question) {
  const values = await editRecord({
    title: 'Question',
    wide: true,
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'url', label: 'Source URL', type: 'url' },
      { key: 'difficulty', label: 'Difficulty', type: 'select', options: DIFFICULTIES },
      { key: 'tags', label: 'Topic tags', placeholder: 'comma separated' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
      { key: 'dueDate', label: 'Next review', type: 'date', hint: 'Editing this overrides the scheduler.' },
      ...bankFieldSpecs(question.bank),
    ],
    extraAction: { label: 'Extraction…', onClick: () => openExtraction(ctx, question) },
    values: {
      ...question,
      tags: (question.tags ?? []).join(', '),
      ...Object.fromEntries(Object.entries(question.fields ?? {}).map(([k, v]) => [`field_${k}`, v])),
    },
  });
  if (!values) return;

  ctx.commit('edit question', () => {
    question.title = values.title;
    question.url = values.url;
    question.difficulty = values.difficulty;
    question.notes = values.notes;
    question.tags = values.tags ? values.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    if (values.dueDate) {
      question.dueDate = values.dueDate;
      question.retired = false;
      question.retiredAt = null;
    }
    const fields = {};
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith('field_') && value) fields[key.slice(6)] = value;
    }
    question.fields = fields;
  }, { undoable: false });
}
