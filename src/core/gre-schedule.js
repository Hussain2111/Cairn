// Seeding the GRE schedule from a paste.
//
// The programme is not in the source. It has an end date, it will be rewritten
// when a gate is missed, and a plan compiled into the code cannot be either of
// those things. So the days, the phases, which blocks run when and each day's
// assigned topics are all data, and this is how they get in.
//
// Same contract as the other importers: a preview of everything found, and
// every line that could not be read reported by number rather than dropped.

import { isValidISODate, addDays } from './dates.js';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * The format, which is also what the dialog shows:
 *
 *   # Phases
 *   1. Foundations | module 12 by day 14
 *   2. Consolidation | module 24 by day 30
 *
 *   # Days
 *   Day 1 | 2026-09-01 | phase 1 | B, C, E1, E2, F | C: ratios | E2: text completion
 *   Day 4 | 2026-09-04 | phase 1 | A, B, C, E1, E2, F | C: rates
 *   Day 14 | 2026-09-14 | phase 1 | checkpoint: timed quant section
 *
 * Fields after the day number and date are order-independent: a "phase n", a
 * list of block codes, "C: topic" pairs and "checkpoint: label" are recognised
 * by shape, because a schedule typed by hand does not keep its columns straight.
 */
export function parseSchedule(source, { blockCodes = [] } = {}) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const known = new Set(blockCodes.map((code) => code.toUpperCase()));
  const phases = [];
  const days = [];
  const unparsed = [];
  const warnings = [];
  let section = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;
    if (!line || /^(-{3,}|={3,})$/.test(line)) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const label = heading[1].toLowerCase();
      if (/phase/.test(label)) section = 'phases';
      else if (/day|schedule/.test(label)) section = 'days';
      else section = null;
      continue;
    }

    const phase = section !== 'days' ? parsePhaseLine(line) : null;
    if (phase) {
      phases.push({ ...phase, line: lineNo });
      continue;
    }

    const day = parseDayLine(line, known, warnings, lineNo);
    if (day) {
      days.push({ ...day, line: lineNo });
      continue;
    }

    unparsed.push({ line: lineNo, text: line });
  }

  // Days are numbered by the schedule, not by their position in the paste.
  days.sort((a, b) => a.dayNumber - b.dayNumber);

  const seen = new Set();
  for (const day of days) {
    if (seen.has(day.dayNumber)) {
      warnings.push({ line: day.line, message: `day ${day.dayNumber} appears more than once — the later one wins` });
    }
    seen.add(day.dayNumber);
  }

  // A day naming a phase that was never defined would silently lose its gate.
  const phaseNumbers = new Set(phases.map((p) => p.number));
  for (const day of days) {
    if (day.phaseNumber !== null && !phaseNumbers.has(day.phaseNumber)) {
      warnings.push({
        line: day.line,
        message: `day ${day.dayNumber} names phase ${day.phaseNumber}, which is not defined above — it will be imported without a phase`,
      });
      day.phaseNumber = null;
    }
  }

  const undated = days.filter((d) => !d.date).length;
  if (undated) {
    warnings.push({ line: 0, message: `${undated} day(s) have no date — they will not line up with the calendar until one is given` });
  }

  return {
    phases,
    days,
    unparsed,
    warnings,
    stats: {
      phases: phases.length,
      days: days.length,
      checkpoints: days.filter((d) => d.checkpoint).length,
      topics: days.reduce((sum, d) => sum + Object.keys(d.topics).length, 0),
      unparsed: unparsed.length,
    },
  };
}

/** "1. Foundations | module 12 by day 14" */
function parsePhaseLine(line) {
  const match = line.match(/^(?:phase\s*)?(\d+)\s*[.)|:-]\s*(.+)$/i);
  if (!match) return null;
  const number = Number(match[1]);
  const rest = match[2];
  const parts = rest.split('|').map(clean);
  const name = parts[0] || `Phase ${number}`;

  let gateModule = null;
  let gateByDay = null;
  for (const part of parts.slice(1)) {
    const gate = part.match(/module\s*(\d+)\s*(?:by|before)?\s*(?:day\s*)?(\d+)?/i);
    if (gate) {
      gateModule = Number(gate[1]);
      if (gate[2]) gateByDay = Number(gate[2]);
    }
    const byDay = part.match(/\bday\s*(\d+)/i);
    if (byDay && gateByDay === null) gateByDay = Number(byDay[1]);
  }
  return { number, name, gateModule, gateByDay };
}

/** "Day 1 | 2026-09-01 | phase 1 | B, C, E1 | C: ratios" */
function parseDayLine(line, known, warnings, lineNo) {
  const match = line.match(/^day\s*(\d+)\b\s*[|:—–-]?\s*(.*)$/i);
  if (!match) return null;

  const dayNumber = Number(match[1]);
  const parts = match[2].split('|').map(clean).filter(Boolean);

  let date = null;
  let phaseNumber = null;
  let checkpoint = '';
  let moduleReached = null;
  const blockCodes = [];
  const topics = {};

  for (const part of parts) {
    const checkpointMatch = part.match(/^checkpoint\s*[:—–-]?\s*(.*)$/i);
    if (checkpointMatch) {
      checkpoint = clean(checkpointMatch[1]) || 'checkpoint';
      continue;
    }

    const topic = part.match(/^([A-Za-z]\d?)\s*[:=]\s*(.+)$/);
    if (topic && known.has(topic[1].toUpperCase())) {
      topics[topic[1].toUpperCase()] = clean(topic[2]);
      continue;
    }

    const phase = part.match(/^phase\s*(\d+)$/i);
    if (phase) {
      phaseNumber = Number(phase[1]);
      continue;
    }

    const module = part.match(/^module\s*(\d+)$/i);
    if (module) {
      moduleReached = Number(module[1]);
      continue;
    }

    if (isValidISODate(part)) {
      date = part;
      continue;
    }

    // A bare list of block codes.
    const codes = part.split(/[,+/]/).map((c) => clean(c).toUpperCase()).filter(Boolean);
    if (codes.length && codes.every((code) => known.has(code))) {
      blockCodes.push(...codes);
      continue;
    }

    // Unrecognised codes are named rather than quietly discarded — a typo in a
    // block code would otherwise remove that block from the day.
    const unknown = codes.filter((code) => !known.has(code));
    if (codes.length && unknown.length) {
      warnings.push({
        line: lineNo,
        message: `day ${dayNumber}: "${unknown.join(', ')}" ${unknown.length === 1 ? 'is not a block code' : 'are not block codes'} — ignored`,
      });
      blockCodes.push(...codes.filter((code) => known.has(code)));
      continue;
    }

    warnings.push({ line: lineNo, message: `day ${dayNumber}: could not read "${part}"` });
  }

  return {
    dayNumber,
    date,
    phaseNumber,
    checkpoint,
    moduleReached,
    blockCodes: [...new Set(blockCodes)],
    topics,
  };
}

/**
 * Fill in dates for days that have none, counting forward from the first dated
 * day. Offered, never automatic: a schedule with rest days is not consecutive,
 * and guessing at that would put every later day on the wrong date.
 */
export function fillDates(days) {
  const anchor = days.find((day) => day.date);
  if (!anchor) return days;
  return days.map((day) => (day.date
    ? day
    : { ...day, date: addDays(anchor.date, day.dayNumber - anchor.dayNumber), dateWasInferred: true }));
}

export const SCHEDULE_EXAMPLE = `# Phases

1. Foundations | module 12 by day 14
2. Consolidation | module 24 by day 30
3. Test shape | module 30 by day 42

# Days

Day 1 | 2026-09-01 | phase 1 | B, C, E1, E2, F | C: ratios and proportions | E2: text completion
Day 2 | 2026-09-02 | phase 1 | B, C, E1, E2, F | C: percent change | E2: sentence equivalence
Day 3 | 2026-09-03 | phase 1 | B, C, E1, E2, F | C: exponents | E2: reading comprehension
Day 4 | 2026-09-04 | phase 1 | A, B, C, E1, E2, F | C: linear equations | E2: text completion | module 4
Day 5 | 2026-09-05 | phase 1 | A, B, C, D, E1, E2, F | C: word problems | E2: paired blanks
Day 14 | 2026-09-14 | phase 1 | checkpoint: timed quant section plus extraction | module 12
Day 15 | 2026-09-15 | phase 2 | A, B, C, E1, E2, F | C: geometry | E2: reading comprehension
`;
