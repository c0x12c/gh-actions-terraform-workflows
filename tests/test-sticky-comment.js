#!/usr/bin/env node

/**
 * Unit test for sticky PR-comment behaviour (terraform-plan)
 *
 * Unlike the other suites, this one extracts and executes the real script from
 * actions/terraform-plan/action.yml rather than mirroring it, so the test cannot
 * silently drift from the action.
 *
 * Usage: node tests/test-sticky-comment.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MAX_COMMENT_LENGTH = 65536;
const ACTION = path.join(__dirname, '..', 'actions', 'terraform-plan', 'action.yml');

/**
 * Pull the github-script body out of the action without a YAML dependency: find the
 * comment step's `script: |` block and strip its common indentation, which is what the
 * YAML block scalar does at runtime.
 */
function extractCommentScript() {
  const lines = fs.readFileSync(ACTION, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes('script: |'));
  assert.ok(start !== -1, 'could not find the script block in action.yml');

  const body = [];
  const indent = lines[start].search(/\S/) + 2;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

/** Substitute the ${{ }} expressions the runner would have already interpolated. */
function interpolate(src, { mode, marker, prNumber }) {
  return src
    .replace(/\$\{\{ inputs\.comment_mode \}\}/g, mode)
    .replace(/\$\{\{ inputs\.comment_marker \}\}/g, marker)
    .replace(/\$\{\{ inputs\.environment \}\}/g, 'staging')
    .replace(/\$\{\{ inputs\.working_dir \}\}/g, 'live/workloads')
    .replace(/\$\{\{ inputs\.pr_number \}\}/g, prNumber)
    .replace(/\$\{\{ steps\.\w+\.outcome \}\}/g, 'success')
    .replace(/\$\{\{ github\.actor \}\}/g, 'tester')
    .replace(/\$\{\{ github\.event_name \}\}/g, 'pull_request')
    .replace(/\$\{\{ github\.workflow \}\}/g, 'Plan');
}

async function runAction({
  mode = 'new',
  marker = '',
  prNumber = '',
  planSize = 100,
  existingComments = [],
  contextIssue = 5,
}) {
  fs.writeFileSync('/tmp/validate_output.txt', 'Success! The configuration is valid.');
  fs.writeFileSync('/tmp/plan.out', 'P'.repeat(planSize));

  const calls = [];
  let paginateOpts = null;
  const github = {
    paginate: async (_fn, opts) => {
      paginateOpts = opts;
      return existingComments;
    },
    rest: {
      issues: {
        listComments: 'listComments',
        updateComment: async (o) => calls.push({ op: 'update', id: o.comment_id, body: o.body }),
        createComment: async (o) => calls.push({ op: 'create', issue: o.issue_number, body: o.body }),
      },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, issue: { number: contextIssue } };

  const src = interpolate(extractCommentScript(), { mode, marker, prNumber });
  await new Function('github', 'context', 'require', `return (async () => {${src}})()`)(github, context, require);

  return { call: calls[0], calls, paginateOpts };
}

const DEFAULT_MARKER = '<!-- terraform-plan:staging:live/workloads -->';
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ PASSED  ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ FAILED  ${name}\n   ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log('Running sticky comment tests...\n');

  await test('default mode posts a new comment and embeds no marker', async () => {
    const { call, calls } = await runAction({ mode: 'new' });
    assert.strictEqual(call.op, 'create');
    assert.ok(!call.body.includes('terraform-plan:'), 'marker leaked into non-sticky comment');
    assert.strictEqual(calls.length, 1);
  });

  await test('sticky with no existing comment creates one carrying the marker', async () => {
    const { call } = await runAction({ mode: 'sticky' });
    assert.strictEqual(call.op, 'create');
    assert.ok(call.body.startsWith(DEFAULT_MARKER), 'sticky comment must lead with its marker');
  });

  await test('sticky updates the existing comment in place', async () => {
    const { call } = await runAction({
      mode: 'sticky',
      existingComments: [{ id: 7, body: 'unrelated' }, { id: 42, body: `${DEFAULT_MARKER}\nold plan` }],
    });
    assert.strictEqual(call.op, 'update');
    assert.strictEqual(call.id, 42);
  });

  await test('sticky requests all comment pages (marker must not be missed)', async () => {
    const { paginateOpts } = await runAction({ mode: 'sticky' });
    assert.strictEqual(paginateOpts.per_page, 100, 'must page at 100 to avoid duplicate stickies');
  });

  await test('a custom marker is honoured', async () => {
    const custom = '<!-- tf-plan:staging -->';
    const { call } = await runAction({
      mode: 'sticky',
      marker: custom,
      existingComments: [{ id: 99, body: `${custom}\nold` }],
    });
    assert.strictEqual(call.op, 'update');
    assert.strictEqual(call.id, 99);
  });

  await test('different markers do not collide on the same PR', async () => {
    const { call } = await runAction({
      mode: 'sticky',
      existingComments: [{ id: 11, body: '<!-- terraform-plan:dev:live/workloads -->\ndev plan' }],
    });
    assert.strictEqual(call.op, 'create', 'staging must not overwrite the dev sticky comment');
  });

  await test('pr_number overrides the event PR', async () => {
    const { call } = await runAction({ mode: 'new', prNumber: '399', contextIssue: undefined });
    assert.strictEqual(call.op, 'create');
    assert.strictEqual(call.issue, 399);
  });

  await test('sticky comment stays within the GitHub comment limit', async () => {
    for (const planSize of [60000, 65000, 100000, 500000]) {
      const { call } = await runAction({ mode: 'sticky', planSize });
      assert.ok(
        call.body.length <= MAX_COMMENT_LENGTH,
        `plan ${planSize} produced ${call.body.length} chars (limit ${MAX_COMMENT_LENGTH})`,
      );
    }
  });

  await test('a plan that fits is not truncated just to reserve room for the notice', async () => {
    const { call } = await runAction({ mode: 'sticky', planSize: 100 });
    assert.ok(!call.body.includes('Plan truncated'), 'small plan should not be truncated');
  });

  console.log('\n' + '='.repeat(50));
  console.log(`Tests completed: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
})();
