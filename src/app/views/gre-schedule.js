// Seeding the GRE schedule.
//
// The plan is not in the source, so this is how it gets in: a paste, a preview
// of everything found, a list of anything that could not be read, and only then
// a commit. Replacing a schedule is destructive to the days — which carry the
// ticked blocks and the module numbers — so that is said before it happens.

import { el, openDialog, toast, tag, copyText } from '../ui.js';
import { parseSchedule, fillDates, SCHEDULE_EXAMPLE } from '../../core/gre-schedule.js';
import { makeGreDay, makeGrePhase } from '../../core/schema.js';
import { blocks, days, seedBlocks } from '../../core/gre.js';
import { formatDate } from '../../core/dates.js';

export function openScheduleImport(ctx) {
  // Block codes in the paste are checked against the blocks that exist, so the
  // default set has to be in place before the first line is read. It is a
  // template — the schedule page is where its names, durations and rules get
  // edited — and seeding it changes nothing else.
  if (!blocks(ctx.state).length) {
    ctx.commit('add the default GRE blocks', (state) => seedBlocks(state), { undoable: false, rerender: false });
  }

  const input = el('textarea.textarea.textarea--tall', {
    placeholder: 'Paste the schedule…',
    spellcheck: 'false',
    'aria-label': 'Schedule',
  });
  const preview = el('div.stack');
  let parsed = null;
  let inferDates = false;

  const goButton = el('button.btn.btn--primary', {
    type: 'button',
    text: 'Import the schedule',
    disabled: true,
    id: 'gre-schedule-go',
  });

  const inferToggle = el('input', {
    type: 'checkbox',
    'aria-label': 'Fill in missing dates',
    onchange: (event) => {
      inferDates = event.target.checked;
      draw();
    },
  });

  const draw = () => {
    preview.replaceChildren();
    const text = input.value.trim();
    if (!text) {
      preview.appendChild(el('p.field__hint', {
        text: 'Nothing pasted yet. Phases, days, blocks and topics are listed here before anything is created.',
      }));
      goButton.disabled = true;
      return;
    }

    const codes = blocks(ctx.state).map((b) => b.code);
    parsed = parseSchedule(input.value, { blockCodes: codes });
    const shown = inferDates ? { ...parsed, days: fillDates(parsed.days) } : parsed;
    parsed = shown;

    preview.appendChild(el('p.field__hint', {
      text: `Block codes are checked against the ${codes.length} block(s) defined: ${codes.join(', ')}. Anything else in a block list is named rather than quietly dropped.`,
    }));

    preview.appendChild(
      el('div.row', [
        tag(`${shown.stats.phases} phase${shown.stats.phases === 1 ? '' : 's'}`, 'teal'),
        tag(`${shown.stats.days} day${shown.stats.days === 1 ? '' : 's'}`),
        shown.stats.checkpoints ? tag(`${shown.stats.checkpoints} checkpoint(s)`, 'amber') : null,
        tag(`${shown.stats.topics} assigned topic(s)`),
      ]),
    );

    const undated = shown.days.filter((day) => !day.date).length;
    if (undated) {
      preview.appendChild(
        el('label.check', [
          inferToggle,
          el('span', { text: `Fill in the ${undated} missing date(s) by counting forward from the first dated day` }),
        ]),
      );
      preview.appendChild(el('p.field__hint', {
        text: 'Offered rather than automatic: a schedule with rest days is not consecutive, and guessing would put every later day on the wrong date.',
      }));
    }

    if (shown.unparsed.length) {
      preview.appendChild(banner('warn', `${shown.unparsed.length} line(s) could not be read`,
        'Listed rather than dropped. Fix them above and the preview updates.'));
      preview.appendChild(
        el('div.unparsed', shown.unparsed.slice(0, 30).map((entry) =>
          el('div.row', [tag(`line ${entry.line}`, 'amber'), el('code.break.faint', { text: entry.text })]))),
      );
    } else {
      preview.appendChild(el('p.field__hint', { text: 'Every line was understood.' }));
    }

    if (shown.warnings.length) {
      preview.appendChild(
        el('div.stack--tight.stack', [
          el('span.field__label', { text: `${shown.warnings.length} thing(s) worth checking` }),
          ...shown.warnings.slice(0, 20).map((w) =>
            el('div.row', [w.line ? tag(`line ${w.line}`) : null, el('span.break', { text: w.message })])),
        ]),
      );
    }

    if (days(ctx.state).length) {
      preview.appendChild(banner('danger', `This replaces the ${days(ctx.state).length} day(s) already in the schedule`,
        'The ticked blocks and recorded module numbers on those days go with them. Logged problems are not touched. One undo puts it all back.'));
    }

    preview.appendChild(
      el('table.table', [
        el('thead', [el('tr', [
          el('th', { text: 'Day' }),
          el('th', { text: 'Date' }),
          el('th', { text: 'Phase' }),
          el('th', { text: 'Blocks' }),
          el('th', { text: 'Topics' }),
        ])]),
        el('tbody', shown.days.slice(0, 60).map((day) =>
          el('tr', [
            el('td.mono', { text: String(day.dayNumber) }),
            el('td.mono', {
              text: day.date ? `${formatDate(day.date)}${day.dateWasInferred ? ' *' : ''}` : '—',
            }),
            el('td', { text: day.phaseNumber ? `phase ${day.phaseNumber}` : '—' }),
            el('td', { text: day.checkpoint ? `checkpoint: ${day.checkpoint}` : day.blockCodes.join(', ') || '—' }),
            el('td.break', {
              text: Object.entries(day.topics).map(([code, topic]) => `${code}: ${topic}`).join(' · ') || '—',
            }),
          ]))),
      ]),
    );
    if (shown.days.length > 60) {
      preview.appendChild(el('p.muted', { text: `…and ${shown.days.length - 60} more, all of which will be imported.` }));
    }

    goButton.disabled = !(shown.days.length || shown.phases.length);
  };

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 300);
  });
  draw();

  return openDialog({
    title: 'The schedule',
    wide: true,
    body: el('div.stack', [
      el('p.field__hint', {
        text: 'Which days exist, which phase each belongs to, which blocks run on which day, and each day\'s assigned topics. None of it is in the app — the programme has an end date and will be rewritten, and a plan compiled into the source cannot be either of those.',
      }),
      el('div.row', [
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Show me the format',
          onclick: () => {
            input.value = SCHEDULE_EXAMPLE;
            draw();
          },
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Copy the format',
          onclick: async () => {
            const ok = await copyText(SCHEDULE_EXAMPLE);
            toast(ok ? 'Format copied.' : 'Could not reach the clipboard.', { variant: ok ? '' : 'danger' });
          },
        }),
      ]),
      el('pre.schedule-format', { text: FORMAT_HELP }),
      input,
      preview,
    ]),
    footer: (close) => {
      goButton.onclick = () => {
        if (parsed) close(parsed);
      };
      return [
        el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
        goButton,
      ];
    },
    onClose: (value) => {
      if (value) commitSchedule(ctx, value);
    },
  });
}

const FORMAT_HELP = `# Phases
1. Foundations | module 12 by day 14

# Days
Day 1 | 2026-09-01 | phase 1 | B, C, E1, E2, F | C: ratios | E2: text completion
Day 14 | 2026-09-14 | phase 1 | checkpoint: timed section | module 12

Fields after the day number are order-independent. "module 12" on a day records
where the study plan got to, which is what a phase gate is checked against.`;

function banner(variant, title, text) {
  return el(`div.banner.banner--${variant}`, [
    el('div.banner__body', [
      el('div.banner__title', { text: title }),
      el('div.banner__text', { text }),
    ]),
  ]);
}

function commitSchedule(ctx, parsed) {
  ctx.commit('import the GRE schedule', (state) => {
    // Blocks are needed for the day rows to mean anything, so a schedule
    // imported into an empty app brings the default set with it.
    seedBlocks(state);

    const phaseIds = new Map();
    state.grePhases = parsed.phases.map((phase, index) => {
      const record = makeGrePhase({
        name: phase.name,
        order: index,
        gateModule: phase.gateModule ?? null,
        gateByDay: phase.gateByDay ?? null,
      });
      phaseIds.set(phase.number, record.id);
      return record;
    });

    state.greDays = parsed.days.map((day) => makeGreDay({
      dayNumber: day.dayNumber,
      date: day.date ?? null,
      phaseId: day.phaseNumber ? phaseIds.get(day.phaseNumber) ?? null : null,
      blockCodes: day.blockCodes,
      topics: day.topics,
      checkpoint: day.checkpoint,
      moduleReached: day.moduleReached ?? null,
    }));
  });

  toast(`Schedule set: ${parsed.days.length} day(s) across ${parsed.phases.length} phase(s).`, {
    action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } },
    timeout: 12000,
  });
  ctx.navigate('#/gre');
}
