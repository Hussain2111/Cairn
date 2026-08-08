// Built-in note templates. These are seeded into new state and re-seeded on
// import if missing, but they are ordinary records -- they can be edited, and
// user templates sit alongside them.

import { makeTemplate } from './schema.js';

export const BUILTIN_TEMPLATE_IDS = {
  dailyLog: 'tpl_builtin_daily_log',
  retro: 'tpl_builtin_stage_retro',
  question: 'tpl_builtin_question',
  application: 'tpl_builtin_application',
  weekly: 'tpl_builtin_weekly_review',
};

const DAILY_LOG = `# Daily log — {{date}}

## What I did

## What broke

## What's next

## Time spent
`;

const STAGE_RETRO = `# Stage retrospective — {{title}}

## The done-when
> Paste the stage's done-when here.

## Did I meet it?

## What took longer than expected

## What I'd do differently in the next stage
`;

const QUESTION_WRITEUP = `# {{title}}

## The problem

## My approach

## Where I got stuck

## The correct approach

## What I'd recognise next time
`;

const APPLICATION_RECORD = `# {{title}}

- **Company:**
- **Role:**
- **Source:**
- **Resume version:**
- **Referral:**

## Why this one

## What they asked

## Follow-up
`;

const WEEKLY_REVIEW = `# Weekly review — week of {{date}}

## What moved

## What didn't

## Questions

## Pipeline

## Next week's one thing
`;

export function builtinTemplates() {
  return [
    makeTemplate({ id: BUILTIN_TEMPLATE_IDS.dailyLog, name: 'Daily project log', body: DAILY_LOG, builtin: true }),
    makeTemplate({ id: BUILTIN_TEMPLATE_IDS.retro, name: 'Stage retrospective', body: STAGE_RETRO, builtin: true }),
    makeTemplate({ id: BUILTIN_TEMPLATE_IDS.question, name: 'Question write-up', body: QUESTION_WRITEUP, builtin: true }),
    makeTemplate({ id: BUILTIN_TEMPLATE_IDS.application, name: 'Application record', body: APPLICATION_RECORD, builtin: true }),
    makeTemplate({ id: BUILTIN_TEMPLATE_IDS.weekly, name: 'Weekly review', body: WEEKLY_REVIEW, builtin: true }),
  ];
}

/** Fill {{date}} / {{title}} placeholders when a template is applied. */
export function applyTemplate(body, vars = {}) {
  return String(body || '').replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}
