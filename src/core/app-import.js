// Importing job applications from a spreadsheet.
//
// The spreadsheet is the user's, so its headers are the user's: "Company Name",
// "Position", "Date Applied", "Where I found it". Guessing a mapping is helpful;
// guessing silently is not. So this module produces a *proposed* mapping with
// the confidence attached, and the view lets every column be corrected before
// anything is written.
//
// The same contract as the outline importer and the file validator: nothing is
// dropped without being reported. A row that cannot become an application is
// returned as a problem carrying its line number and its contents, and a row
// that duplicates something already in the app is flagged rather than merged.

import { APPLICATION_STATUSES, APPLICATION_SOURCES, makeApplication } from './schema.js';
import { isValidISODate, todayISO } from './dates.js';

/**
 * The fields an application can be built from.
 *
 * `aliases` are matched against the spreadsheet's header names. They are
 * deliberately generous — a header only has to be recognised well enough to
 * propose the right column, and the user corrects it in the preview.
 */
export const IMPORT_COLUMNS = [
  {
    key: 'company',
    label: 'Company',
    required: true,
    aliases: ['company', 'company name', 'employer', 'organisation', 'organization', 'firm', 'where'],
  },
  {
    key: 'role',
    label: 'Role',
    required: true,
    aliases: ['role', 'position', 'title', 'job', 'job title', 'role title', 'posting'],
  },
  { key: 'dateApplied', label: 'Date applied', type: 'date', aliases: ['date applied', 'applied', 'date', 'applied on', 'application date', 'submitted', 'date submitted'] },
  { key: 'status', label: 'Status', type: 'status', aliases: ['status', 'stage', 'outcome', 'result', 'progress'] },
  { key: 'source', label: 'Source', type: 'source', aliases: ['source', 'via', 'where found', 'board', 'job board', 'channel', 'found via', 'where i found it'] },
  { key: 'url', label: 'Link', aliases: ['url', 'link', 'posting url', 'job link', 'listing', 'advert', 'ad'] },
  { key: 'resumeVersion', label: 'Resume version', aliases: ['resume', 'cv', 'resume version', 'cv version', 'resume used'] },
  { key: 'referral', label: 'Referral', aliases: ['referral', 'referred by', 'contact', 'referrer', 'intro'] },
  { key: 'nextAction', label: 'Next action', aliases: ['next action', 'next step', 'todo', 'action', 'follow up'] },
  { key: 'nextActionDate', label: 'Next action date', type: 'date', aliases: ['next action date', 'follow up date', 'follow-up', 'due', 'reminder'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'comment', 'detail', 'details'] },
];

const COLUMN_BY_KEY = new Map(IMPORT_COLUMNS.map((column) => [column.key, column]));

/** Status words a spreadsheet is likely to hold, mapped onto Cairn's six. */
const STATUS_SYNONYMS = {
  applied: 'applied',
  submitted: 'applied',
  sent: 'applied',
  open: 'applied',
  pending: 'applied',
  'in progress': 'applied',
  screening: 'screening',
  screen: 'screening',
  'phone screen': 'screening',
  recruiter: 'screening',
  'phone call': 'screening',
  oa: 'screening',
  'online assessment': 'screening',
  interview: 'interview',
  interviewing: 'interview',
  onsite: 'interview',
  technical: 'interview',
  final: 'interview',
  offer: 'offer',
  offered: 'offer',
  accepted: 'offer',
  rejected: 'rejected',
  rejection: 'rejected',
  declined: 'rejected',
  no: 'rejected',
  closed: 'rejected',
  ghosted: 'ghosted',
  'no reply': 'ghosted',
  'no response': 'ghosted',
  silence: 'ghosted',
};

const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// --- mapping ----------------------------------------------------------------

/**
 * Propose which spreadsheet column feeds which field.
 *
 * Scored rather than first-match: with headers "Date" and "Date Applied" both
 * present, the exact alias should win the date field instead of whichever came
 * first. Every proposal carries how it was reached so the view can say "guessed"
 * out loud on the ones that were not exact.
 *
 * @returns {Record<string, {index:number, confidence:'exact'|'partial', header:string}|null>}
 */
export function guessMapping(headers) {
  const clean = headers.map(normalise);
  const mapping = {};
  const taken = new Set();

  const claim = (column, index, confidence) => {
    mapping[column.key] = { index, confidence, header: headers[index] };
    taken.add(index);
  };

  // Exact alias matches first, so they cannot be stolen by a partial one.
  for (const column of IMPORT_COLUMNS) {
    const index = clean.findIndex((header, i) => !taken.has(i) && header && column.aliases.includes(header));
    if (index >= 0) claim(column, index, 'exact');
  }

  for (const column of IMPORT_COLUMNS) {
    if (mapping[column.key]) continue;
    let best = -1;
    let bestLength = 0;
    clean.forEach((header, i) => {
      if (taken.has(i) || !header) return;
      // A containment match, longest alias wins: "date applied" beats "date".
      const hit = column.aliases.find((alias) => header.includes(alias) || alias.includes(header));
      if (hit && hit.length > bestLength) {
        best = i;
        bestLength = hit.length;
      }
    });
    if (best >= 0) claim(column, best, 'partial');
    else mapping[column.key] = null;
  }

  return mapping;
}

// --- value coercion ---------------------------------------------------------

/**
 * Read a date out of a spreadsheet cell.
 *
 * Only unambiguous formats are accepted. `03/04/2026` is deliberately *not*
 * one of them: it is the third of April in most of the world and the fourth of
 * March in the United States, and a silently wrong application date is worse
 * than a reported one the user can fix in the sheet.
 *
 * @returns {{value:string|null, problem:string|null}}
 */
export function readDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null, problem: null };

  if (isValidISODate(text)) return { value: text, problem: null };

  // ISO with a time attached, which is what a timestamp column gives.
  const isoish = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(text);
  if (isoish && isValidISODate(isoish[1])) return { value: isoish[1], problem: null };

  // "4 August 2026", "August 4, 2026", "4 Aug 2026".
  const named = /^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/i.exec(text) ?? null;
  const namedFirst = /^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text) ?? null;
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const findMonth = (name) => monthNames.findIndex((m) => m.startsWith(String(name).toLowerCase().slice(0, 3)));
  if (named || namedFirst) {
    const day = Number(named ? named[1] : namedFirst[2]);
    const month = findMonth(named ? named[2] : namedFirst[1]);
    const year = Number(named ? named[3] : namedFirst[3]);
    if (month >= 0 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isValidISODate(iso)) return { value: iso, problem: null };
    }
  }

  // Unambiguous only because the first part cannot be a month.
  const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text);
  if (slashed) {
    const [, a, b, year] = slashed;
    if (Number(a) > 12 && Number(b) <= 12) {
      const iso = `${year}-${String(Number(b)).padStart(2, '0')}-${String(Number(a)).padStart(2, '0')}`;
      if (isValidISODate(iso)) return { value: iso, problem: null };
    }
    return {
      value: null,
      problem: `"${text}" could be day/month or month/day — Cairn will not guess which. Format that column as YYYY-MM-DD in the sheet and import again.`,
    };
  }

  return { value: null, problem: `"${text}" is not a date Cairn can read — use YYYY-MM-DD` };
}

export function readStatus(raw) {
  const text = normalise(raw);
  if (!text) return { value: 'applied', problem: null };
  if (APPLICATION_STATUSES.includes(text)) return { value: text, problem: null };
  const mapped = STATUS_SYNONYMS[text];
  if (mapped) return { value: mapped, problem: null };
  for (const [word, status] of Object.entries(STATUS_SYNONYMS)) {
    if (text.includes(word)) return { value: status, problem: null };
  }
  return {
    value: 'applied',
    problem: `status "${raw}" is not one Cairn has — recorded as "applied", and the original is in the notes`,
  };
}

export function readSource(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: 'direct', problem: null };
  const match = APPLICATION_SOURCES.find((source) => normalise(source) === normalise(text));
  if (match) return { value: match, problem: null };
  // "other" is a real answer here rather than a failure: the source list is
  // short on purpose, and the original text is kept in the notes.
  return { value: 'other', problem: null, original: text };
}

// --- duplicates -------------------------------------------------------------

const identity = (company, role) => `${normalise(company)}|${normalise(role)}`;

/**
 * Does this row already exist? Matched on company plus role, or on the posting
 * URL — the two things that identify an application regardless of what the
 * spreadsheet called its columns.
 */
export function findDuplicate(existing, candidate) {
  const key = identity(candidate.company, candidate.role);
  const url = String(candidate.url ?? '').trim().toLowerCase();
  for (const application of existing) {
    if (url && String(application.url ?? '').trim().toLowerCase() === url) {
      return { application, on: 'the same link' };
    }
    if (key !== '|' && identity(application.company, application.role) === key) {
      return { application, on: 'the same company and role' };
    }
  }
  return null;
}

// --- the preview ------------------------------------------------------------

/**
 * Turn parsed rows plus a mapping into what would be created.
 *
 * Nothing is written here. The result is what the dialog renders, and the same
 * `records` array is what gets committed if the user goes ahead — so what is
 * previewed is exactly what is imported.
 *
 * @returns {{records:Array, problems:Array, duplicates:number, skipped:number}}
 */
export function buildPreview(rows, mapping, { existing = [], today = todayISO() } = {}) {
  const records = [];
  const problems = [];
  const seen = [];
  let duplicates = 0;

  const cellFor = (row, key) => {
    const entry = mapping?.[key];
    if (!entry || entry.index < 0) return '';
    return String(row.cells[entry.index] ?? '').trim();
  };

  for (const row of rows) {
    const company = cellFor(row, 'company');
    const role = cellFor(row, 'role');

    if (!company && !role) {
      problems.push({
        line: row.line,
        severity: 'skipped',
        message: 'has neither a company nor a role, so there is nothing to identify it by',
        raw: row.cells.filter(Boolean).join(' · ').slice(0, 160),
      });
      continue;
    }

    const rowProblems = [];
    const extraNotes = [];

    const applied = readDate(cellFor(row, 'dateApplied'));
    if (applied.problem) rowProblems.push(applied.problem);
    const nextActionDate = readDate(cellFor(row, 'nextActionDate'));
    if (nextActionDate.problem) rowProblems.push(nextActionDate.problem);

    const status = readStatus(cellFor(row, 'status'));
    if (status.problem) {
      rowProblems.push(status.problem);
      extraNotes.push(`Spreadsheet status: ${cellFor(row, 'status')}.`);
    }

    const source = readSource(cellFor(row, 'source'));
    if (source.original) extraNotes.push(`Source: ${source.original}.`);

    const notes = [cellFor(row, 'notes'), ...extraNotes].filter(Boolean).join(' ').trim();
    const dateApplied = applied.value ?? today;

    const record = makeApplication({
      company: company || 'Unknown company',
      role: role || 'Unknown role',
      source: source.value,
      url: cellFor(row, 'url'),
      dateApplied,
      resumeVersion: cellFor(row, 'resumeVersion'),
      referral: cellFor(row, 'referral'),
      status: status.value,
      nextAction: cellFor(row, 'nextAction'),
      nextActionDate: nextActionDate.value,
      notes,
      lastMovedAt: dateApplied,
    });

    // Checked against what is already saved *and* against earlier rows of this
    // same file, because a spreadsheet duplicates itself as readily as it
    // duplicates the app.
    const duplicate = findDuplicate([...existing, ...seen], record);
    if (duplicate) duplicates += 1;
    seen.push(record);

    records.push({
      line: row.line,
      record,
      problems: rowProblems,
      duplicate: duplicate ? { on: duplicate.on, id: duplicate.application.id } : null,
      // Missing a company or a role is worth flagging but not worth refusing:
      // the row still says something happened.
      incomplete: !company || !role,
    });

    for (const message of rowProblems) {
      problems.push({ line: row.line, severity: 'repaired', message, raw: `${company} — ${role}` });
    }
  }

  return {
    records,
    problems,
    duplicates,
    skipped: problems.filter((p) => p.severity === 'skipped').length,
  };
}

/** The columns a mapping still needs before an import can go ahead. */
export function missingRequired(mapping) {
  return IMPORT_COLUMNS.filter((column) => column.required && !mapping?.[column.key]).map((column) => column.label);
}

export { COLUMN_BY_KEY };
