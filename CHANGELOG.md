# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

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
