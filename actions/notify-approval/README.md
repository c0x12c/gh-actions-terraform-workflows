# Notify approval waiting

Posts a chat notice that a Terraform apply is waiting for approval, carrying the plan summary so an
approver sees what they are approving without opening the run.

Pair it with [`terraform-plan`](../terraform-plan) and feed it that action's outputs.

## Inputs

| Input | Description | Required | Default |
|---|---|---|---|
| `webhook_url` | Slack incoming webhook. Empty skips delivery without failing. | `false` | `''` |
| `environment` | Environment being applied, e.g. `prod` | `true` | |
| `plan_counts` | `plan_counts` output from `terraform-plan` | `false` | `''` |
| `plan_changes` | `plan_changes` output from `terraform-plan`. Headers, never attribute values. | `false` | `''` |
| `plan_total` | `plan_total` output from `terraform-plan` | `false` | `0` |
| `has_destroy` | `has_destroy` output from `terraform-plan` | `false` | `false` |
| `slack_group_id` | Slack user-group ID to mention (e.g. `S01ABC2DEF`). Empty posts no mention. Must be the ID, not the display name. | `false` | `''` |
| `github_token` | Token with `contents:read`, used to generate release notes shown in the notice. Empty skips the changelog section without failing. | `false` | `''` |
| `changelog` | Pre-rendered changelog. Overrides generation from `github_token`; use when the caller already has the text or the ref is not a tag. | `false` | `''` |

## Usage

```yaml
- name: Run Terraform Plan
  id: plan
  uses: c0x12c/gh-actions-terraform-workflows/actions/terraform-plan@v3.3.0
  with:
    environment: prod
    # ... remaining inputs

- name: Notify that an approval is waiting
  if: ${{ success() }}
  continue-on-error: true
  uses: c0x12c/gh-actions-terraform-workflows/actions/notify-approval@v3.3.0
  with:
    webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
    environment: prod
    plan_counts: ${{ steps.plan.outputs.plan_counts }}
    plan_changes: ${{ steps.plan.outputs.plan_changes }}
    plan_total: ${{ steps.plan.outputs.plan_total }}
    has_destroy: ${{ steps.plan.outputs.has_destroy }}
```

## Announce from the plan job, not the apply job

A job declaring `environment:` does not start until someone approves it. A step inside the apply
job could therefore never announce its own gate - it would run after the approval it was meant to
ask for.

Put this in the plan job, which runs ungated, and let the apply job carry the `environment:` key.

## `continue-on-error` is deliberate

A notification must never gate the thing it announces. Where the apply job has `needs: plan`, a
Slack outage without this would fail the plan job and block the deploy. The step still reports its
own failure in the run, so a dead webhook stays visible rather than silently doing nothing.

## What the notice carries

Counts, and one header per changing resource - address plus action. **Never an attribute diff.** A rendered plan is not
secret-masked, and its `~ attr = value` lines hold database passwords and connection strings. A job
log sits behind repo auth and ages out; a chat channel is searchable, forwardable and retained, so
the same bytes have a much longer half-life there.

The notice links to the plan job, where the full diff lives.

When a plan destroys or replaces anything the headline says so and the button turns red.

Rows are dropped in two places - the `plan_max_rows` cap upstream and Slack's own text limit - and
both report how many were omitted. A notice that silently shows a subset is worse than one showing
nothing, because the reader cannot tell it is incomplete.
