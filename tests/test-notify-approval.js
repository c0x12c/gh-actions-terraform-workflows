#!/usr/bin/env node

/**
 * Tests for the approval-notice payload. Runs the REAL
 * actions/notify-approval/scripts/payload.py, so the Block Kit shape and the truncation
 * accounting are exercised rather than mirrored.
 *
 * Usage: node tests/test-notify-approval.js
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'actions', 'notify-approval', 'scripts', 'payload.py');

function build(overrides = {}) {
  const env = Object.assign(
    {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      REPO: 'acme/infra',
      ENVIRONMENT: 'prod',
      REF_NAME: 'v1.2.3',
      RUN_URL: 'https://example.invalid/run/1',
      PLAN_COUNTS: 'Plan: 0 to add, 2 to change, 0 to destroy.',
      PLAN_TOTAL: '2',
      HAS_DESTROY: 'false',
      PLAN_CHANGES: 'module.a.aws_db_instance.this will be updated in-place\n'
        + 'module.b.aws_db_instance.this will be updated in-place',
    },
    overrides,
  );
  return JSON.parse(execFileSync('python3', [SCRIPT], { env, encoding: 'utf8' }));
}

const sections = (p) => p.blocks.filter((b) => b.type === 'section');
const button = (p) => p.blocks[p.blocks.length - 1].elements[0];
const codeBlock = (p) => {
  const s = sections(p);
  return s.length > 2 ? s[2].text.text : '';
};

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL - ${name}\n    ${e.message}`);
  }
}

console.log('notify-approval');

test('a routine plan gets the primary button and no alarm', () => {
  const p = build();
  assert.strictEqual(button(p).style, 'primary');
  assert.ok(!/DESTROYS/.test(p.blocks[0].text.text));
  assert.ok(sections(p)[1].text.text.includes('0 to add, 2 to change, 0 to destroy'));
});

test('a destructive plan gets the danger button and a flagged headline', () => {
  const p = build({ HAS_DESTROY: 'true', PLAN_COUNTS: 'Plan: 0 to add, 0 to change, 2 to destroy.' });
  assert.strictEqual(button(p).style, 'danger');
  assert.ok(/DESTROYS OR REPLACES/.test(p.blocks[0].text.text));
});

test('an absent plan summary still produces a valid notice', () => {
  const p = build({ PLAN_COUNTS: '', PLAN_CHANGES: '', PLAN_TOTAL: '0' });
  assert.ok(sections(p)[1].text.text.includes('plan summary unavailable'));
  assert.strictEqual(codeBlock(p), '', 'no empty code block');
});

test('rows dropped upstream by the cap are reported, not hidden', () => {
  // plan_total is the pre-cap count, so the notice can say how many it is not showing. A notice
  // that silently shows a subset is worse than one showing nothing.
  const p = build({
    PLAN_TOTAL: '47',
    PLAN_CHANGES: Array.from({ length: 20 }, (_, i) => `module.m${i}.aws_s3_bucket.this will be updated in-place`).join('\n'),
  });
  assert.ok(/\.\.\. 27 more not shown/.test(codeBlock(p)));
});

test('long rows truncate on a line boundary and report the remainder', () => {
  const long = Array.from(
    { length: 60 },
    (_, i) => `module.very.long.namespace.path.number${i}.aws_instance.resource_with_long_name will be updated in-place`,
  ).join('\n');
  const p = build({ PLAN_TOTAL: '60', PLAN_CHANGES: long });
  const body = codeBlock(p).replace(/```/g, '').trim().split('\n');
  assert.ok(codeBlock(p).length < 3000, 'must fit the Slack text limit');
  assert.ok(/more not shown/.test(body[body.length - 1]), 'remainder reported');
  body.slice(0, -1).forEach((l) => assert.ok(l.endsWith('in-place'), `row cut mid-way: ${l}`));
});

test('attribute values never reach the payload', () => {
  // The upstream output is addresses only; this asserts the builder adds nothing of its own.
  const p = build();
  assert.ok(!JSON.stringify(p).includes('password'));
  assert.ok(!/=\s*"/.test(codeBlock(p)), 'no attribute assignments in the body');
});

test('a valid slack_group_id mentions the group once', () => {
  const p = build({ SLACK_GROUP_ID: 'S01ABC2DEF' });
  const firstSectionText = sections(p)[0].text.text;
  assert.ok(firstSectionText.endsWith('<!subteam^S01ABC2DEF>'), 'first section ends with the mention');
  const occurrences = firstSectionText.split('<!subteam^S01ABC2DEF>').length - 1;
  assert.strictEqual(occurrences, 1);
  assert.ok(!p.text.includes('subteam'), 'top-level text field does not contain subteam');
});

test('a malformed slack_group_id fails loudly', () => {
  assert.throws(() => build({ SLACK_GROUP_ID: '@dev-rain' }), /Slack user-group ID/);
});

test('changelog markup cannot ping a channel', () => {
  const p = build({ CHANGELOG: '* <!channel> ship it by @someone in #1' });
  const payload = JSON.stringify(p);
  assert.ok(!payload.includes('<!channel>'), 'escaped markup not in payload');
  assert.ok(payload.includes('&lt;!channel&gt;'), 'escaped form is in payload');
});

test('no changelog and no group id leaves the block count unchanged', () => {
  const p = build();
  assert.strictEqual(p.blocks.length, 5, 'baseline block count is 5');
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall passed');
