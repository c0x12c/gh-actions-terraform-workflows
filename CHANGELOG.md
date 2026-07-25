# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [v3.0.1] - 2026-07-25

### Fixed

- `terraform-plan`: the "Check for Plan Failure" gate could miss a failed plan. It read `steps.plan.outputs.exitcode`, which the `setup-terraform` wrapper populates from the last terraform command in the step (the `terraform show`), not the plan - so a plan that errored but was followed by a successful `show` would report success. The plan now runs in `scripts/plan.sh`, which exits non-zero on any failure, and the gate keys off the step outcome. Failure output is preserved so it still appears in the PR comment.
- `terraform-plan`: the plan comment no longer runs (and crashes on a missing plan file) after a *pre-plan* failure such as an init/creds/decrypt error - it is skipped unless the plan step actually ran.

### Changed

- `terraform-plan`: the inline plan shell and PR-comment JavaScript are extracted to `actions/terraform-plan/scripts/{plan.sh,post-comment.js}` (invoked via `$GITHUB_ACTION_PATH`), so they are shellcheck'd / unit-tested directly instead of being embedded in `action.yml`. Behavior is unchanged.

## [v3.0.0] - 2026-07-25

### Added

- `terraform-plan`: `comment_mode` input (`sticky` | `new`). In `sticky` mode a single plan comment per plan is updated in place instead of a new comment being posted on every run.
- `terraform-plan`: `comment_marker` input identifying the sticky comment. Left empty it derives `<!-- terraform-plan:<environment>:<working_dir> -->`, so concurrent plans on the same PR keep separate comments.
- `terraform-plan`: `pr_number` input so a `workflow_dispatch`-driven plan can post a comment on a specific PR.

### Changed

- `terraform-plan`: `comment_mode` defaults to `sticky`. Plan comments now update in place rather than accumulating.
- `terraform-plan`: consumer-controlled values are passed to the comment script through the step environment instead of being interpolated into it, and the sticky comment listing is paginated at 100 so the marker is not missed on a busy PR.

### Fixed

- `terraform-plan`: removed a "Terraform Format and Style" line that always rendered empty (it read `steps.fmt.outcome`, but the action has no `fmt` step).
- `terraform-plan`: the truncation notice now reports the number of characters actually shown rather than the pre-notice budget, and the "output too large" fallback is no longer indented into a markdown code block.
- `terraform-plan`: `pr_number` is validated, a multi-line `comment_marker` is rejected, and backtick-bearing metadata is escaped so it cannot break out of its inline code span.

### Warning

- `comment_mode` defaults to `sticky`, which is a behavior change: consumers on the default will see one plan comment per environment updated in place instead of an accumulating thread. This is why the release is a **major bump** (`v3.0.0`). Consumers pinned to `@v2` are unaffected until they move to `@v3`; to keep the previous append-on-every-run behavior after upgrading, set `comment_mode: 'new'`.

## [v2.0.0] - 2026-04-16

### Changed

- Added the `refresh` input to `terraform-plan` and `terraform-plan-gcp`.
- Changed standalone plan actions to use `-refresh=${{ inputs.refresh }}` with a default of `true`, matching the apply actions.

### Warning

- `v1.1.4` changed AWS `terraform-apply` from always using `-refresh=false` to a configurable `refresh` input with a default of `true`; the GCP apply action also defaults `refresh` to `true` in the current `v1` line. Because `v1` is a moving tag, workflows using `@v1` may have already picked up that behavior. If you need the old no-refresh behavior, set `refresh: 'false'` explicitly or pin to `v1.1.3` while you plan the migration.
- Publish this change as a major release and move consumers to `@v2` once plan/apply refresh behavior is reviewed for each environment.

## [v1.1.7] - 2026-03-11

### Added

- Added automated test suite for GitHub Action scripts in `tests/` directory.
- Added a new CI workflow `.github/workflows/test-scripts.yml` to run tests on every pull request and push.

### Fixed

- Fixed backtick escaping logic in `terraform-plan` and `terraform-plan-gcp` actions to correctly handle plans containing backticks by using proper JavaScript escaping.
- Improved the backtick replacement in `terraform-apply-gcp` for consistent PR comment formatting.

### Changed

- Moved existing test scripts from `tools/` to `tests/` for better organization.

## [v1.1.6] - 2026-03-11

### Added

- Added `github_token` input parameter to `terraform-apply-gcp` action for posting PR comments.
- Added Terraform Plan step to `terraform-apply-gcp` action to capture plan output before apply.
- Added PR comment posting step to `terraform-apply-gcp` action with deployment results.

### Fixed

- Fixed GitHub API "Body is too long" error in `terraform-plan` action by implementing automatic truncation when plan output exceeds 65536 character limit.
- Added fallback minimal message when even truncated plan exceeds GitHub's comment limit.

## [v1.1.5] - 2025-10-05

### Fixed

- Fixed Slack failure notification condition in terraform-apply actions to use `failure()` function instead of invalid `steps.tf_apply.outputs.exitcode`.
- Added success notification step to terraform-apply actions with proper `success()` condition.

## [v1.1.4] - 2025-09-20

### Added

- Added `refresh` input parameter to terraform-apply action to control state refresh behavior.

## [v1.1.3] - 2025-07-30

### Fixed

- Escape backticks in Terraform plan outputs.

## [v1.1.2] - 2024-11-14

### Changed

- Update `slack_webhool_url` as optional input to ignore notification.

## [v1.1.1] - 2024-11-01

### Added

- Added Slack notification step on failure for terraform apply workflows.

## [v1.1.0] - 2024-10-25

### Added

- Added Terraform composite workflows for Google Cloud Platform (GCP).

## [v1.0.0] - 2024-10-20

### Changed
- Bump version to v1.0.0

## [v0.5.1] - 2024-10-20

### Changed
- Use `gh-actions-git-secret-protector@v1`.

## [v0.5.0] - 2024-10-07

### Changed
- Make secret decrypting steps optional.

## [v0.4.1] - 2024-09-15

### Fixed
- Fix wordings in Github Action workflow files.

## [v0.4.0] - 2024-09-15

### Changed
-  Use gh-actions-git-secret-protector@v1.0.4.

## [v0.3.0] - 2024-09-15

### Added

- Initial release with two workflows: `terraform-plan` and `terraform-apply`.
