import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOutline, planImport, countTree } from '../../src/core/outline.js';
import { createEmptyState, makeThread, makeStage } from '../../src/core/schema.js';

const messages = (list) => list.map((e) => `${e.line}: ${e.message}`).join(' | ');

const GOOD = `# Compiler project (project)

## Lexer
> every token type has a passing test
### Numbers
- Integer literals @45m
- Float literals ^2026-09-01
- Hex and binary
### Strings
- Escapes

## Parser
> the grammar round-trips every fixture
### Expressions
- Precedence climbing @2h
`;

// --- the happy path ---------------------------------------------------------

test('a well-formed outline parses into the full tree', () => {
  const result = parseOutline(GOOD);
  assert.equal(result.ok, true, messages(result.errors));
  assert.deepEqual(result.errors, []);

  assert.equal(result.threads.length, 1);
  const thread = result.threads[0];
  assert.equal(thread.name, 'Compiler project');
  assert.equal(thread.type, 'project');
  assert.deepEqual(thread.stages.map((s) => s.title), ['Lexer', 'Parser']);
  assert.equal(thread.stages[0].doneWhen, 'every token type has a passing test');
  assert.deepEqual(thread.stages[0].steps.map((s) => s.title), ['Numbers', 'Strings']);
  assert.deepEqual(thread.stages[0].steps[0].tasks.map((t) => t.title), [
    'Integer literals', 'Float literals', 'Hex and binary',
  ]);
  assert.deepEqual(result.stats,
    { threads: 1, stages: 2, steps: 3, tasks: 5, implicitSteps: 0, links: 0, tasksWithLinks: 0 });
});

test('estimates and due dates are pulled off the task title', () => {
  const tasks = parseOutline(GOOD).threads[0].stages[0].steps[0].tasks;
  assert.equal(tasks[0].estimateMinutes, 45);
  assert.equal(tasks[0].title, 'Integer literals', 'the marker is stripped from the title');
  assert.equal(tasks[1].due, '2026-09-01');
  assert.equal(tasks[1].title, 'Float literals');
  assert.equal(tasks[2].estimateMinutes, null);
  assert.equal(tasks[2].due, null);
});

test('estimates accept hours, minutes, both, and bare numbers', () => {
  const parsed = parseOutline(`# T
## S
> x
### P
- a @2h
- b @90m
- c @1h30m
- d @30
`);
  assert.equal(parsed.ok, true, messages(parsed.errors));
  assert.deepEqual(parsed.threads[0].stages[0].steps[0].tasks.map((t) => t.estimateMinutes), [120, 90, 90, 30]);
});

// --- the guarantee: nothing is dropped -------------------------------------

test('every marker in the text becomes a record', () => {
  const result = parseOutline(GOOD);
  const counted = countTree(result.threads);
  assert.equal(counted.threads, (GOOD.match(/^#(?!#)/gm) || []).length);
  assert.equal(counted.stages, (GOOD.match(/^##(?!#)/gm) || []).length);
  assert.equal(counted.steps, (GOOD.match(/^###/gm) || []).length);
  assert.equal(counted.tasks, (GOOD.match(/^-/gm) || []).length);
});

test('a long outline keeps every stage, in order', () => {
  // The failure this guards against is a stage quietly going missing.
  const stages = Array.from({ length: 25 }, (_, i) => `## Stage ${i}\n> done when ${i}\n### Step\n- task ${i}`);
  const result = parseOutline(`# Big thread\n${stages.join('\n')}\n`);
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(result.threads[0].stages.length, 25);
  assert.deepEqual(
    result.threads[0].stages.map((s) => s.title),
    Array.from({ length: 25 }, (_, i) => `Stage ${i}`),
  );
  assert.equal(result.stats.tasks, 25);
});

test('an unrecognised line is refused, never skipped', () => {
  const result = parseOutline(`# Thread
## Stage
> done when
### Step
- a real task
this line is prose that should not be here
- another task
`);
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /does not match the outline format/);
  assert.equal(result.errors[0].line, 6);
  assert.equal(result.errors[0].text, 'this line is prose that should not be here');
});

// --- duplicates -------------------------------------------------------------

test('the same thread name twice in one outline is refused', () => {
  const result = parseOutline(`# Compiler
## A
> x
### S
- t

# Compiler
## B
> y
### S
- u
`);
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /appears twice in this outline/);
});

test('the same stage title twice in one thread is refused', () => {
  const result = parseOutline(`# Thread
## Lexer
> x
### S
- t
## Lexer
> y
### S
- u
`);
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /appears twice in "Thread"/);
});

test('the same stage title in different threads is fine', () => {
  const result = parseOutline(`# One
## Setup
> x
### S
- t
# Two
## Setup
> y
### S
- u
`);
  assert.equal(result.ok, true, messages(result.errors));
});

// --- done-when is mandatory -------------------------------------------------

test('a stage with no done-when blocks the import and names itself', () => {
  const result = parseOutline(`# Thread
## Lexer
> fine
### S
- t
## Parser
### S
- u
`);
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /"Parser" has no done-when/);
  assert.doesNotMatch(messages(result.errors), /"Lexer" has no done-when/);
});

test('an empty done-when is refused', () => {
  const result = parseOutline(`# T\n## S\n>\n### P\n- a\n`);
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /done-when is empty/);
});

test('wrapped done-when lines join into one sentence', () => {
  const result = parseOutline(`# T
## S
> every token type has a passing test
> and the fuzzer runs clean
### P
- a
`);
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(
    result.threads[0].stages[0].doneWhen,
    'every token type has a passing test and the fuzzer runs clean',
  );
});

// --- orphans ----------------------------------------------------------------

test('a stage, step, task or done-when with no parent is refused', () => {
  assert.match(messages(parseOutline('## Orphan stage').errors), /needs a thread above it/);
  assert.match(messages(parseOutline('# T\n### Orphan step').errors), /needs a stage above it/);
  assert.match(messages(parseOutline('# T\n- orphan task').errors), /needs a stage above it/);
  assert.match(messages(parseOutline('# T\n> orphan done-when').errors), /needs a stage above it/);
});

test('a thread with no stages is refused', () => {
  const result = parseOutline('# Just a name');
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /has no stages/);
});

test('an empty outline is refused', () => {
  assert.match(messages(parseOutline('').errors), /nothing to import/);
  assert.match(messages(parseOutline('   \n\n  ').errors), /nothing to import/);
});

// --- the forgiving parts, each one reported --------------------------------

test('tasks directly under a stage get a step, and it is reported', () => {
  const result = parseOutline(`# T
## S
> x
- first
- second
`);
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(result.threads[0].stages[0].steps.length, 1);
  assert.equal(result.threads[0].stages[0].steps[0].title, 'Tasks');
  assert.equal(result.threads[0].stages[0].steps[0].tasks.length, 2);
  assert.match(messages(result.warnings), /a step called "Tasks" was created/);
});

test('a stage with no tasks is allowed but warned about', () => {
  const result = parseOutline(`# T\n## Empty\n> x\n`);
  assert.equal(result.ok, true, messages(result.errors));
  assert.match(messages(result.warnings), /"Empty" has no tasks/);
});

test('bullets may be -, * or +, or numbered', () => {
  const result = parseOutline(`# T
## S
> x
### P
- dash
* star
+ plus
1. numbered
2) also numbered
`);
  assert.equal(result.ok, true, messages(result.errors));
  assert.deepEqual(result.threads[0].stages[0].steps[0].tasks.map((t) => t.title), [
    'dash', 'star', 'plus', 'numbered', 'also numbered',
  ]);
});

test('a code fence wrapping the paste is ignored', () => {
  const result = parseOutline('```\n# T\n## S\n> x\n### P\n- a\n```');
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(result.stats.tasks, 1);
});

test('markdown emphasis is stripped from titles', () => {
  const result = parseOutline('# **Bold thread**\n## __Bold stage__\n> x\n### `code step`\n- **bold task**\n');
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(result.threads[0].name, 'Bold thread');
  assert.equal(result.threads[0].stages[0].title, 'Bold stage');
  assert.equal(result.threads[0].stages[0].steps[0].title, 'code step');
  assert.equal(result.threads[0].stages[0].steps[0].tasks[0].title, 'bold task');
});

test('blank lines and indentation do not matter', () => {
  const result = parseOutline('\n\n  # T\n\n   ## S\n\n  > x\n\n  ### P\n\n   - a\n\n');
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(result.stats.tasks, 1);
});

// --- thread types -----------------------------------------------------------

test('a thread type in brackets is honoured', () => {
  const result = parseOutline('# GRE prep (study)\n## S\n> x\n### P\n- a\n');
  assert.equal(result.threads[0].type, 'study');
  assert.equal(result.threads[0].name, 'GRE prep');
});

test('an unknown thread type is refused rather than silently defaulted', () => {
  const result = parseOutline('# Thing (wizardry)\n## S\n> x\n### P\n- a\n');
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /not a thread type/);
  assert.match(messages(result.errors), /project, study, pipeline, habit, reading/);
});

test('no type means project', () => {
  assert.equal(parseOutline('# Thing\n## S\n> x\n### P\n- a\n').threads[0].type, 'project');
});

test('brackets that are part of the name are not mistaken for a type', () => {
  const result = parseOutline('# Rewrite the parser (again)\n## S\n> x\n### P\n- a\n');
  assert.equal(result.ok, false, 'an unknown bracket value is surfaced rather than guessed at');
  assert.match(messages(result.errors), /"again" is not a thread type/);
});

// --- bad dates --------------------------------------------------------------

test('an invalid due date is refused with the offending value', () => {
  const result = parseOutline('# T\n## S\n> x\n### P\n- a ^2026-02-30\n');
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /\^2026-02-30" is not a valid date/);
});

test('a task with no title after markers are stripped is refused', () => {
  const result = parseOutline('# T\n## S\n> x\n### P\n- @45m\n');
  assert.equal(result.ok, false);
  assert.match(messages(result.errors), /task has no title/);
});

// --- planning against existing state ---------------------------------------

test('a new thread name plans as a creation', () => {
  const parsed = parseOutline(GOOD);
  const plan = planImport(parsed, createEmptyState([]));
  assert.equal(plan[0].action, 'create');
  assert.equal(plan[0].existing, null);
});

test('an existing thread name appends instead of duplicating', () => {
  const state = createEmptyState([]);
  state.threads.push(makeThread({ name: 'Compiler project' }));

  const plan = planImport(parseOutline(GOOD), state);
  assert.equal(plan[0].action, 'append');
  assert.equal(plan[0].existing.name, 'Compiler project');
  assert.deepEqual(plan[0].clashes, []);
});

test('appending flags stage titles the thread already has', () => {
  const state = createEmptyState([]);
  const thread = makeThread({ name: 'Compiler project' });
  thread.stages.push(makeStage({ title: 'Lexer', doneWhen: 'already here' }));
  state.threads.push(thread);

  const plan = planImport(parseOutline(GOOD), state);
  assert.equal(plan[0].action, 'append');
  assert.deepEqual(plan[0].clashes, ['Lexer']);
});

test('thread matching ignores case and surrounding space', () => {
  const state = createEmptyState([]);
  state.threads.push(makeThread({ name: 'compiler PROJECT' }));
  assert.equal(planImport(parseOutline(GOOD), state)[0].action, 'append');
});

// --- a realistic messy paste ------------------------------------------------

test('a realistic chat answer parses, with every deviation reported', () => {
  const chatOutput = '```markdown\n' + `
# Job hunt (pipeline)

## Materials
> the resume has been reviewed by two people and the portfolio is live
- Rewrite the backend variant @2h
- Get feedback from Priya

## Applications
> twenty applications sent with tailored cover letters
### Sourcing
1. Build a company shortlist @90m
2. Check Hiring Cafe daily ^2026-09-15
` + '\n```';

  const result = parseOutline(chatOutput);
  assert.equal(result.ok, true, messages(result.errors));
  assert.equal(result.threads[0].type, 'pipeline');
  assert.equal(result.stats.stages, 2);
  assert.equal(result.stats.tasks, 4);

  // The one liberty taken is reported, not silent.
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /step called "Tasks" was created/);

  assert.equal(result.threads[0].stages[1].steps[0].tasks[0].estimateMinutes, 90);
  assert.equal(result.threads[0].stages[1].steps[0].tasks[1].due, '2026-09-15');
});

test('errors carry the line number and the offending text', () => {
  const result = parseOutline(`# T
## S
> x
### P
- fine
!!! broken !!!
`);
  const error = result.errors.find((e) => e.text === '!!! broken !!!');
  assert.ok(error, 'the bad line is reported verbatim');
  assert.equal(error.line, 6);
});

// --- links ------------------------------------------------------------------

test('a bare URL in a task line becomes a link and leaves the title', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- Read the spec https://example.com/spec
`);
  assert.equal(parsed.ok, true);
  const [task] = parsed.threads[0].stages[0].steps[0].tasks;
  assert.equal(task.title, 'Read the spec', 'the title reads as a title again');
  assert.deepEqual(task.links, [{ url: 'https://example.com/spec', label: '' }]);
  assert.equal(parsed.stats.links, 1);
  assert.equal(parsed.stats.tasksWithLinks, 1);
});

test('a markdown link keeps its text as the title and its url as the link', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- See [the RFC](https://example.com/rfc) before starting
`);
  const [task] = parsed.threads[0].stages[0].steps[0].tasks;
  assert.equal(task.title, 'See the RFC before starting');
  assert.deepEqual(task.links, [{ url: 'https://example.com/rfc', label: 'the RFC' }]);
});

test('several links on one task all survive', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- Compare https://example.com/a with https://example.com/b
`);
  const [task] = parsed.threads[0].stages[0].steps[0].tasks;
  assert.equal(task.title, 'Compare with');
  assert.deepEqual(task.links.map((l) => l.url), ['https://example.com/a', 'https://example.com/b']);
});

test('trailing punctuation belongs to the sentence, not the URL', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- Check https://example.com/x, then move on
- Read https://example.com/y.
`);
  const [first, second] = parsed.threads[0].stages[0].steps[0].tasks;
  assert.equal(first.links[0].url, 'https://example.com/x', 'the comma is not part of the address');
  assert.equal(first.title, 'Check, then move on', 'and the comma is not left stranded either');
  assert.equal(second.links[0].url, 'https://example.com/y');
});

test('a link does not interfere with the estimate or the due date', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- Read the docs https://example.com/@handle/page @45m ^2026-09-01
`);
  assert.deepEqual(parsed.errors, []);
  const [task] = parsed.threads[0].stages[0].steps[0].tasks;
  assert.equal(task.title, 'Read the docs');
  assert.equal(task.estimateMinutes, 45, 'the @ inside the URL is not an estimate');
  assert.equal(task.due, '2026-09-01');
  assert.equal(task.links[0].url, 'https://example.com/@handle/page');
});

test('a task that is only a URL keeps the URL as its title rather than becoming empty', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- https://example.com/read-this
`);
  // Nothing is left to call it, so the parser refuses rather than creating a
  // task with a blank title.
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.map((e) => e.message).join(' '), /no title/);
});

test('lifting a link out of a title is reported, once, rather than silently', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- One https://example.com/a
- Two https://example.com/b
- Three
`);
  assert.equal(parsed.ok, true);
  const messages = parsed.warnings.map((w) => w.message).join(' ');
  assert.match(messages, /2 links in 2 task titles moved onto the task itself/);
  assert.equal(parsed.warnings.filter((w) => /moved onto the task/.test(w.message)).length, 1,
    'one summary, not one per task');
});

test('a task with no link has an empty links array, not a missing one', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
### Step
- Plain task
`);
  assert.deepEqual(parsed.threads[0].stages[0].steps[0].tasks[0].links, []);
  assert.equal(parsed.stats.links, 0);
  assert.equal(parsed.stats.tasksWithLinks, 0);
});

test('a URL somewhere other than a task line is still refused', () => {
  const parsed = parseOutline(`# T
## S
> done when this is done
https://example.com/stray
### Step
- A task
`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors[0].message, /does not match the outline format/);
});
