# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This repository provides reusable composite GitHub Actions for managing Terraform operations across different environments (dev, prod, stage, etc.). The actions are designed to integrate with AWS and GCP, securely manage secrets using git-secret-protector, and provide comprehensive CI/CD workflows.

### Core Components

**Composite Actions Structure:**
- `actions/terraform-plan/` - Terraform planning action for AWS environments
- `actions/terraform-plan-gcp/` - Terraform planning action for GCP environments
- `actions/terraform-apply/` - Terraform apply action for AWS environments
- `actions/terraform-apply-gcp/` - Terraform apply action for GCP environments
- `actions/eks-scale-down/` - EKS cluster scaling action

**Release Management:**
- `tools/semtag` - Semantic versioning tool for automated releases
- `tools/create_release.sh` - Script for creating releases with proper version tagging
- `.github/workflows/` - Automated workflows for version management and releases

### Action Patterns

All Terraform actions follow a consistent pattern:
1. Setup Terraform with caching
2. Configure cloud provider credentials (AWS/GCP)
3. Decrypt secrets if needed (using git-secret-protector)
4. Run Terraform operations (init, validate, plan/apply)
5. Post results to PR comments (for plan actions)
6. Send Slack notifications (for apply actions, optional)

### Key Features

- **Multi-cloud support**: Separate actions for AWS and GCP
- **Secret management**: Integration with git-secret-protector for encrypted secrets
- **PR integration**: Terraform plan results are automatically posted as PR comments
- **Slack notifications**: Optional notifications for deployment status
- **Caching**: Terraform plugin caching for faster builds
- **Version management**: Automated semantic versioning and release management

## Common Development Tasks

### Testing Actions Locally

Since this repository contains GitHub Actions, testing requires:
- Using `act` tool for local GitHub Actions testing
- Setting up proper environment variables and secrets
- Testing against actual AWS/GCP resources (use dev environments)

### Release Management

**Create a new release:**
```bash
# For patch release
./tools/create_release.sh patch

# For minor release
./tools/create_release.sh minor

# For major release
./tools/create_release.sh major
```

The release process automatically:
- Updates version tags
- Creates GitHub releases
- Updates both specific version tags (v1.2.3) and major/minor tags (v1, v1.2)

### Action Development

When modifying actions:
1. Update the `action.yml` file in the respective action directory
2. Update the corresponding `README.md` with usage examples
3. Test using `act` or in a test repository
4. Create a PR following the existing template
5. After merge, create a new release to make changes available

### Version Strategy

This repository uses semantic versioning with moving tags:
- `v1.2.3` - Specific version
- `v1.2` - Latest patch in minor version
- `v1` - Latest minor in major version

Users typically reference major version tags (e.g., `@v1`) to get automatic updates.