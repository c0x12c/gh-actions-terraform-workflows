# Generalized Terraform Plan Workflow on AWS

This GitHub Workflow action is designed to create a reusable method for running Terraform plan within any AWS environment. It's capable of configuring AWS credentials and posts comments to pull requests when appropriate.

## Inputs

Here are the required inputs for the workflow:

| Input Name          | Description                                      | Required | Default |
|---------------------|--------------------------------------------------|----------|---------|
| `aws_region`        | The AWS region to use                            | `true`   |         |
| `aws_role`          | AWS role to assume for the environment           | `true`   |         |
| `environment`       | The environment to use (e.g., `dev`, `prod`)     | `true`   |         |
| `github_token`      | GitHub Token to post comments to PR              | `true`   |         |
| `python_version`    | The Python version to use                        | `false`  | `3.12`  |
| `secret_filter`     | The filter name to use with git-secret-protector | `false`  | `''`    |
| `terraform_version` | The Terraform version to use                     | `false`  | `1.8.4` |
| `working_dir`       | Working directory for Terraform files            | `true`   |         |
| `refresh`           | Whether to refresh state before planning         | `false`  | `true`  |
| `comment_mode`      | `sticky` updates one comment in place; `new` appends a fresh comment each run | `false` | `sticky` |
| `comment_marker`    | Hidden marker identifying the sticky comment (sticky mode only) | `false` | derived from `environment` + `working_dir` |
| `pr_number`         | PR to comment on; defaults to the triggering event's PR | `false` | `''` |
| `plan_max_rows`     | Resource addresses to place in the `plan_changes` output; the job summary is unaffected | `false` | `20` |

## Outputs

| Output | Description |
|---|---|
| `plan_counts` | The plan's summary line, e.g. `Plan: 0 to add, 2 to change, 0 to destroy.` or `No changes.` |
| `plan_changes` | One header per changing resource (`<address> will be updated in-place`), capped at `plan_max_rows`. Empty when nothing changes. |
| `plan_total` | Number of changing resources, before the cap |
| `has_destroy` | `true` when the plan destroys or replaces anything |

`plan_changes` carries one plan header per line - a resource address and its action - and **never an
attribute value**. Callers forward these
outputs to chat and paging systems, where a rendered plan's `~ attr = value` lines - database
passwords, connection strings - would outlive the run and reach a wider audience than repo auth
allows. Pair with [`notify-approval`](../notify-approval) to post them.

Data-source reads (`will be read during apply`) are excluded, matching Terraform's own
add/change/destroy accounting.

## Job summary

The action writes the full rendered plan to the run's job summary. That page also carries the
**Review pending deployments** button, so an approver reads the plan where they approve it rather
than opening a job. The heading flags a plan that destroys or replaces resources.

This matters most on a tag build: the PR comment below requires a pull request, so without the job
summary a tag-time plan renders nowhere - and on a tag-driven deploy that is the plan being
approved.

The job summary sits behind the same auth as the job log, so unlike the outputs it carries the
plan verbatim.

## Sticky comments

Plan comments are **sticky by default**: one comment per plan, updated in place on every
run. On a PR that runs several plans - multiple environments, or multiple Terraform roots -
appending instead would add a new comment per plan per push and bury the discussion.

Each sticky comment is identified by a hidden HTML marker in its body. Left unset,
`comment_marker` derives `<!-- terraform-plan:<environment>:<working_dir> -->`, so
concurrent plans on the same PR keep their own comments instead of overwriting each other.
Set it explicitly to group them differently.

To get the old append-on-every-run behaviour instead:

```yaml
  - name: Run Terraform Plan
    uses: c0x12c/gh-actions-terraform-workflows/actions/terraform-plan@v2
    with:
      # ...
      comment_mode: 'new'
```

Commenting normally requires a `pull_request` event. To comment from a `workflow_dispatch`
run, pass the target PR explicitly with `pr_number`.

## Usage

Here is an example of how to use this workflow in your GitHub actions:

```
steps:
  - name: Run Terraform Plan
    uses: c0x12c/gh-actions-terraform-workflows/actions/terraform-plan@v2
    with:
      aws_region: 'us-east-1'
      aws_role: 'arn:aws:iam::123456789012:role/my-role'
      github_token: 'github-token'
      environment: 'dev'
      python_version: '3.12'
      secret_filter: 'my-secret-filter'
      terraform_version: '1.8.4'
      working_dir: './terraform'
      refresh: 'true'
```
