'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const post = require(path.join(__dirname, '..', '..', 'scripts', 'post-comment.js'));

async function runPostComment({
  mode = 'sticky',
  marker = '',
  prNumber = '',
  workingDir = 'live/workloads',
  planSize = 100,
  planBody = null,
  validationBody = 'valid',
  existing = [],
  contextIssue = 5,
  planExists = true,
  kind = 'plan',
  fmtOutcome = '',
  applyOutcome = 'success',
  initOutcome = 'success',
  validateOutcome = 'success',
  planOutcome = 'success',
  actor = 'tester',
  eventName = 'pull_request',
  workflow = 'Plan',
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-comment-'));
  const oldRunnerTemp = process.env.RUNNER_TEMP;
  const envKeys = [
    'PLAN_KIND',
    'PLAN_ENVIRONMENT',
    'PLAN_WORKING_DIR',
    'PLAN_COMMENT_MODE',
    'PLAN_COMMENT_MARKER',
    'PLAN_PR_NUMBER',
    'PLAN_INIT_OUTCOME',
    'PLAN_VALIDATE_OUTCOME',
    'PLAN_PLAN_OUTCOME',
    'PLAN_ACTOR',
    'PLAN_EVENT_NAME',
    'PLAN_WORKFLOW',
    'PLAN_FMT_OUTCOME',
    'PLAN_APPLY_OUTCOME',
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.RUNNER_TEMP = tmp;
  if (kind === 'plan') {
    fs.writeFileSync(path.join(tmp, 'validate_output.txt'), validationBody);
  }
  if (planExists) {
    fs.writeFileSync(path.join(tmp, 'plan.out'), planBody ?? 'P'.repeat(planSize));
  }

  Object.assign(process.env, {
    PLAN_KIND: kind,
    PLAN_ENVIRONMENT: 'staging',
    PLAN_WORKING_DIR: workingDir,
    PLAN_COMMENT_MODE: mode,
    PLAN_COMMENT_MARKER: marker,
    PLAN_PR_NUMBER: prNumber,
    PLAN_INIT_OUTCOME: initOutcome,
    PLAN_VALIDATE_OUTCOME: validateOutcome,
    PLAN_PLAN_OUTCOME: planOutcome,
    PLAN_ACTOR: actor,
    PLAN_EVENT_NAME: eventName,
    PLAN_WORKFLOW: workflow,
    PLAN_FMT_OUTCOME: fmtOutcome,
    PLAN_APPLY_OUTCOME: applyOutcome,
  });

  const calls = [];
  let pageOpts = null;
  const github = {
    paginate: async (_fn, opts) => {
      pageOpts = opts;
      return existing;
    },
    rest: {
      issues: {
        listComments: 'lc',
        updateComment: async (opts) => calls.push({ op: 'update', id: opts.comment_id, body: opts.body }),
        createComment: async (opts) => calls.push({ op: 'create', issue: opts.issue_number, body: opts.body }),
      },
    },
  };

  try {
    await post({
      github,
      context: { repo: { owner: 'o', repo: 'r' }, issue: { number: contextIssue } },
    });
  } finally {
    for (const key of envKeys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
    if (oldRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = oldRunnerTemp;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { call: calls[0], calls, pageOpts };
}

module.exports = { runPostComment };
