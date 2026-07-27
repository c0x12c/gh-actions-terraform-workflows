'use strict';
// Exercises tools/changelog-release.sh against fixture CHANGELOGs with a fake `git` on
// PATH (mirrors test-plan-gate.js). Runs in DRY_RUN so nothing is pushed; asserts the
// parse + [Unreleased] skip + idempotency + strictly-increasing (numeric) verdicts.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const SCRIPT = path.resolve(__dirname, '..', 'tools', 'changelog-release.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-release-'));

// Fake git: emit ls-remote lines from $FAKE_TAGS; stub rev-parse. Any push/tag => fail
// the test (DRY_RUN must never reach them).
const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir);
fs.writeFileSync(path.join(binDir, 'git'), [
  '#!/usr/bin/env bash',
  'if [ "$1" = "ls-remote" ]; then',
  '  for t in $FAKE_TAGS; do printf "%s\\trefs/tags/%s\\n" 0000000000000000000000000000000000000000 "$t"; done',
  '  exit 0',
  'fi',
  'if [ "$1" = "rev-parse" ]; then echo deadbee; exit 0; fi',
  'echo "fake-git: unexpected mutating call: $*" >&2; exit 99',
  '',
].join('\n'));
fs.chmodSync(path.join(binDir, 'git'), 0o755);

function run(changelog, fakeTags) {
  const clFile = path.join(tmp, `CL-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(clFile, changelog);
  try {
    const out = execFileSync('bash', [SCRIPT], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        CHANGELOG_FILE: clFile,
        DRY_RUN: 'true',
        FAKE_TAGS: fakeTags,
      },
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const cl = (top) => `# Change Log\n\n## [${top}] - 2026-01-01\n\n### Added\n- thing\n`;
let passed = 0;
function check(name, cond, ctx) {
  assert.ok(cond, `${name}\n---\n${ctx}\n---`);
  passed++;
}

// 1. New version above latest -> would release.
let r = run(cl('v3.1.0'), 'v3.0.0 v3.0.1');
check('new version releases', r.code === 0 && /would tag v3\.1\.0/.test(r.out), JSON.stringify(r));

// 2. [Unreleased] -> skip no-op.
r = run(cl('Unreleased'), 'v3.0.1');
check('unreleased skips', r.code === 0 && /skipping \(no-op\)/.test(r.out), JSON.stringify(r));

// 3. Already-tagged -> idempotent no-op.
r = run(cl('v3.0.1'), 'v3.0.0 v3.0.1');
check('already-released no-op', r.code === 0 && /already released \(no-op\)/.test(r.out), JSON.stringify(r));

// 4. Malformed version -> error.
r = run(cl('v3.0'), 'v3.0.1');
check('malformed errors', r.code === 1 && /not a vX\.Y\.Z/.test(r.out), JSON.stringify(r));

// 5. Non-increasing version -> error.
r = run(cl('v2.9.0'), 'v3.0.1');
check('non-increasing errors', r.code === 1 && /not strictly greater/.test(r.out), JSON.stringify(r));

// 6. Two-digit minor beats single-digit (numeric, not lexical).
r = run(cl('v3.10.0'), 'v3.9.0');
check('numeric compare v3.10.0>v3.9.0', r.code === 0 && /would tag v3\.10\.0/.test(r.out), JSON.stringify(r));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`test-changelog-release: ${passed}/6 passed`);
