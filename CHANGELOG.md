# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [v2.0.0] - Unreleased

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
