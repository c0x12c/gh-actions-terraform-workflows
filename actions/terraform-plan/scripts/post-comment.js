'use strict';

// Posts the terraform plan result as a PR comment. Extracted from action.yml so it can be
// linted and unit-tested directly. Inputs arrive via env (PLAN_*) - never interpolated into
// the caller's `script:` body, which would be a script-injection vector. Invoked as:
//   require(`${process.env.GITHUB_ACTION_PATH}/scripts/post-comment.js`)({ github, context })

const fs = require('fs');

const MAX_COMMENT_LENGTH = 65536; // GitHub comment body cap

module.exports = async ({ github, context }) => {
  const env = process.env;
  const environment = env.PLAN_ENVIRONMENT.toUpperCase();
  const workingDir = env.PLAN_WORKING_DIR;
  const sticky = env.PLAN_COMMENT_MODE === 'sticky';

  // Trimmed so a padded marker still matches. Default keys on environment+working_dir so
  // concurrent plans on one PR keep separate comments.
  const marker = (env.PLAN_COMMENT_MARKER || '').trim() ||
    `<!-- terraform-plan:${env.PLAN_ENVIRONMENT}:${workingDir} -->`;
  // Sticky comments are matched on their first line, so a multi-line marker never matches.
  if (sticky && /[\r\n]/.test(marker)) {
    throw new Error('comment_marker must be a single line');
  }

  // Read then remove the temp files (consistent with the repo's other actions).
  const consume = (p) => {
    if (!fs.existsSync(p)) return '';
    const v = fs.readFileSync(p, 'utf8');
    fs.rmSync(p, { force: true });
    return v;
  };
  const esc = (s) => s.replace(/`/g, '\\`');
  const tmp = process.env.RUNNER_TEMP || '/tmp';
  const validationOutput = esc(consume(`${tmp}/validate_output.txt`));
  // May be absent if an earlier step failed before the plan ran; post a notice rather than crash.
  const planRaw = consume(`${tmp}/plan.out`);
  const plan = planRaw ? esc(planRaw) : 'Plan did not run - an earlier step failed. See the workflow logs.';

  // Values that render inside inline-code spans; an embedded backtick would break the span.
  const inline = (v) => String(v ?? '').replace(/`/g, '\\`');
  const meta = `*Pusher: @${env.PLAN_ACTOR}, Action: \`${inline(env.PLAN_EVENT_NAME)}\`, Working Directory: \`${inline(workingDir)}\`, Workflow: \`${inline(env.PLAN_WORKFLOW)}\`*`;
  const footer = `\n\`\`\`\n\n</details>\n\n${meta}`;
  // The one line a reviewer acts on. Pinned above the <details> whenever the plan is truncated,
  // so the decision signal never depends on how much of the plan happened to fit.
  const summaryMatch = plan.match(/^(?:Plan: .*|No changes\..*)$/m);
  const summaryBlock = summaryMatch ? `**\`${summaryMatch[0]}\`**\n\n` : '';
  const header = (pinned = '') => `${sticky ? marker + '\n' : ''}#### Environment: ${environment}
#### Terraform Initialization ⚙️\`${env.PLAN_INIT_OUTCOME}\`
#### Terraform Validation 🤖\`${env.PLAN_VALIDATE_OUTCOME}\`
<details><summary>Validation Output</summary>

\`\`\`\n
${validationOutput}
\`\`\`

</details>

#### Terraform Plan 📖\`${env.PLAN_PLAN_OUTCOME}\`

${pinned}<details><summary>Show Plan</summary>

\`\`\`\n
`;

  let output;
  if (header().length + footer.length + plan.length > MAX_COMMENT_LENGTH) {
    // Budget against the header that will actually be emitted - the pinned summary is part of it.
    const available = MAX_COMMENT_LENGTH - (header(summaryBlock).length + footer.length);
    // Size the notice against a placeholder first: its length depends on the number it reports.
    const notice = (n) => `\n\n... [Plan truncated - showing the last ${n} characters. See workflow logs for full output.] ...`;
    const SEPARATOR = '\n\n';
    const maxPlan = available - notice(available).length - SEPARATOR.length;
    // Keep the END of the plan. "Plan: N to add, M to change, K to destroy" is the last line,
    // and it is the one line a reviewer needs. Keeping the head drops it on exactly the large
    // plans where the count matters most, leaving a truncated resource dump and no summary.
    output = maxPlan > 0
      ? `${header(summaryBlock)}${notice(maxPlan)}${SEPARATOR}${plan.slice(-maxPlan)}${footer}`
      : `${sticky ? marker + '\n' : ''}#### Environment: ${environment}\n\n#### Terraform Plan 📖\`${env.PLAN_PLAN_OUTCOME}\`\n\n${summaryBlock}Plan output is too large to display. Please check the workflow logs for the full plan.\n\n${meta}`;
  } else {
    output = `${header()}${plan}${footer}`;
  }

  // Resolve the PR: a valid pr_number wins; otherwise the event's PR. Fail loudly rather than
  // posting onto the wrong PR (or undefined). The step `if:` only checks pr_number != '' (no
  // trim), so a whitespace-only value reaches here and trims to empty - hence the fallback +
  // guard below.
  const raw = (env.PLAN_PR_NUMBER || '').trim();
  let issue_number;
  if (raw !== '') {
    issue_number = Number(raw);
    if (!Number.isInteger(issue_number) || issue_number <= 0) {
      throw new Error(`pr_number must be a positive integer, got "${raw}"`);
    }
  } else {
    issue_number = context.issue.number;
    if (!Number.isInteger(issue_number) || issue_number <= 0) {
      throw new Error('no pull request to comment on: pass a valid pr_number when running outside a pull_request event');
    }
  }
  const { owner, repo } = context.repo;

  if (sticky) {
    // per_page 100: the default 30 can miss the marker on a busy PR and create a duplicate.
    const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
    // Match the marker as the first line only: the plan text is embedded verbatim, so a
    // substring match could latch onto a comment that merely quotes the marker.
    const existing = comments.find((c) => c.body && c.body.split('\n')[0].trim() === marker);
    if (existing) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: output });
      return;
    }
  }
  await github.rest.issues.createComment({ owner, repo, issue_number, body: output });
};
