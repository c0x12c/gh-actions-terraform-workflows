#!/usr/bin/env node

/**
 * Tests for the plan PR-comment logic. Requires the REAL scripts/post-comment.js module and
 * calls it with mock github/context, so the test cannot drift from the shipped code.
 *
 * Usage: node tests/test-sticky-comment.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ACTION = path.join(ROOT, 'actions', 'terraform-plan', 'action.yml');
const POST = path.join(ROOT, 'actions', 'terraform-plan', 'scripts', 'post-comment.js');
const post = require(POST);

const MAX = 65536;
const DEFAULT_MARKER = '<!-- terraform-plan:staging:live/workloads -->';

async function run({ mode = 'sticky', marker = '', prNumber = '', workingDir = 'live/workloads',
  planSize = 100, existing = [], contextIssue = 5, planExists = true } = {}) {
  fs.writeFileSync('/tmp/validate_output.txt', 'valid');
  if (planExists) fs.writeFileSync('/tmp/plan.out', 'P'.repeat(planSize));
  else fs.rmSync('/tmp/plan.out', { force: true });
  Object.assign(process.env, {
    PLAN_ENVIRONMENT: 'staging', PLAN_WORKING_DIR: workingDir, PLAN_COMMENT_MODE: mode,
    PLAN_COMMENT_MARKER: marker, PLAN_PR_NUMBER: prNumber, PLAN_INIT_OUTCOME: 'success',
    PLAN_VALIDATE_OUTCOME: 'success', PLAN_PLAN_OUTCOME: 'success', PLAN_ACTOR: 'tester',
    PLAN_EVENT_NAME: 'pull_request', PLAN_WORKFLOW: 'Plan',
  });
  const calls = [];
  let pageOpts = null;
  const github = {
    paginate: async (_fn, o) => { pageOpts = o; return existing; },
    rest: { issues: {
      listComments: 'lc',
      updateComment: async (o) => calls.push({ op: 'update', id: o.comment_id, body: o.body }),
      createComment: async (o) => calls.push({ op: 'create', issue: o.issue_number, body: o.body }),
    } },
  };
  await post({ github, context: { repo: { owner: 'o', repo: 'r' }, issue: { number: contextIssue } } });
  return { call: calls[0], calls, pageOpts };
}

function declaredDefault(name) {
  const lines = fs.readFileSync(ACTION, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.trim() === `${name}:`);
  assert.ok(i !== -1, `input ${name} not declared in action.yml`);
  for (const l of lines.slice(i + 1)) {
    if (/^\s{2}\S/.test(l)) break;
    const m = l.match(/^\s+default:\s*"?([^"]*)"?\s*$/);
    if (m) return m[1];
  }
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✓ PASSED  ${name}`); passed++; }
  catch (e) { console.log(`✗ FAILED  ${name}\n   ${e.message}`); failed++; }
}

(async () => {
  console.log('Running post-comment tests...\n');

  await test('comment_mode defaults to sticky', () => assert.strictEqual(declaredDefault('comment_mode'), 'sticky'));

  await test('new mode appends and embeds no marker', async () => {
    const { call, calls } = await run({ mode: 'new' });
    assert.strictEqual(call.op, 'create');
    assert.ok(!call.body.includes('terraform-plan:'));
    assert.strictEqual(calls.length, 1);
  });

  await test('sticky with no existing comment creates one carrying the marker', async () => {
    const { call } = await run({ mode: 'sticky' });
    assert.strictEqual(call.op, 'create');
    assert.ok(call.body.startsWith(DEFAULT_MARKER));
  });

  await test('sticky updates the existing comment in place', async () => {
    const { call } = await run({ existing: [{ id: 7, body: 'x' }, { id: 42, body: `${DEFAULT_MARKER}\nold` }] });
    assert.strictEqual(call.op, 'update');
    assert.strictEqual(call.id, 42);
  });

  await test('sticky pages at 100 to avoid duplicate stickies', async () => {
    const { pageOpts } = await run({ mode: 'sticky' });
    assert.strictEqual(pageOpts.per_page, 100);
  });

  await test('a custom marker is honoured', async () => {
    const c = '<!-- tf-plan:staging -->';
    const { call } = await run({ marker: c, existing: [{ id: 99, body: `${c}\nold` }] });
    assert.strictEqual(call.id, 99);
  });

  await test('a comment merely quoting the marker is not hijacked', async () => {
    const { call } = await run({ existing: [{ id: 88, body: `quote:\n${DEFAULT_MARKER}\nreply` }] });
    assert.strictEqual(call.op, 'create');
  });

  await test('distinct markers do not collide', async () => {
    const { call } = await run({ existing: [{ id: 11, body: '<!-- terraform-plan:dev:live/workloads -->\ndev' }] });
    assert.strictEqual(call.op, 'create');
  });

  await test('pr_number overrides the event PR', async () => {
    const { call } = await run({ mode: 'new', prNumber: '399', contextIssue: null });
    assert.strictEqual(call.issue, 399);
  });

  await test('a multi-line marker fails fast', async () => {
    await assert.rejects(() => run({ marker: '<!-- a\nb -->' }), /single line/);
  });

  await test('a malformed pr_number fails loudly', async () => {
    for (const bad of ['abc', '0', '-3']) await assert.rejects(() => run({ prNumber: bad }), /positive integer/);
  });

  await test('a backtick in working_dir cannot break the inline code span', async () => {
    const { call } = await run({ workingDir: 'a/`x`/b' });
    assert.ok(call.body.includes('Working Directory: `a/\\`x\\`/b`'));
  });

  await test('comment stays within the GitHub limit', async () => {
    for (const s of [60000, 100000, 500000]) {
      const { call } = await run({ planSize: s });
      assert.ok(call.body.length <= MAX, `size ${s} -> ${call.body.length}`);
    }
  });

  await test('a missing plan.out posts a notice, not a crash', async () => {
    const { call } = await run({ planExists: false });
    assert.ok(call.body.includes('Plan did not run'));
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Passed: ${passed}\nFailed: ${failed}`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
})();
