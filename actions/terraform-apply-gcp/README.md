# Generalized Terraform Apply GitHub Workflow Action

This GitHub workflow action is designed to create a reusable method for running Terraform Apply within any GCP environment. After it performs the apply, it sends a notification to Slack.

## Inputs

Here are the inputs the workflow requires:

| Input Name                       | Description                                                | Required | Default |
|----------------------------------|------------------------------------------------------------|----------|---------|
| `gcp_project_id`                 | GCP Project ID to use                                      | `true`   |         |
| `gcp_service_account`            | The GCP Service Account to use for authentication          | `true`   |         |
| `gcp_workload_identity_provider` | The GCP Workload Identity Provider to use                  | `true`   |         |
| `environment`                    | The environment to use (e.g., `dev`, `prod`)               | `true`   |         |
| `python_version`                 | Python version to use                                      | `false`  | `3.12`  |
| `secret_filter`                  | The filter name to use with git-secret-protector           | `false`  | `''`    |
| `slack_webhook_url`              | The Slack Webhook URL for posting deployment notifications | `false`  | `''`    |
| `terraform_version`              | Terraform version to use                                   | `false`  | `1.8.4` |
| `working_dir`                    | The working directory for Terraform files                  | `true`   |         |
| `refresh`                        | Whether to refresh state before planning and applying      | `false`  | `true`  |
| `github_token`                   | GitHub Token to post comments to PR                        | `false`  | `''`    |
| `num_commits`                    | Recent commits listed in the Slack notification            | `false`  | `3`     |

## Outputs

| Output Name    | Description                                                                                                                                                            |
|----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `error_detail` | The terraform error from a failed apply (from the first `Error:` block onward, capped at 2000 bytes), exactly as terraform wrote it. Empty on success. Use it to render your own failure notification. |

The Slack failure notification already carries this error in its body, so an alert names the cause
(a held state lock, a denied permission) without opening the run.

The error is captured from the CLI's own output, which means GitHub's secret masking does not apply
to it - the job log renders registered secrets as `***`, this text does not. Terraform redacts
values it knows are sensitive, so the residual case is a provider error quoting a request body.
Point `slack_webhook_url` at a channel you would be comfortable seeing that in, and treat
`error_detail` the same way if you render it yourself.

`error_detail` is terraform's text, so treat it as data. Pass it through `env:` rather than
interpolating it into a `run:` block, where a resource name containing `$(...)` or backticks would
be executed by the shell:

```yaml
- if: failure()
  env:
    DETAIL: ${{ steps.tf.outputs.error_detail }}   # not "${{ ... }}" inside the run body
  run: printf '%s' "$DETAIL" | your-notifier
```

The notification lists the `num_commits` most recent commits, so an alert says what was being
applied. That list comes from the checked-out repo, so the caller's checkout has to be at least
that deep - `actions/checkout` defaults to `fetch-depth: 1`, which leaves only the head commit to
list:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 3
```

## Usage

```
steps:
  - name: Run Terraform Apply
    uses: c0x12c/gh-actions-terraform-workflows/actions/terraform-apply-gcp@v2
    with:
      gcp_project_id: 'my-project-id'
      gcp_service_account: 'my-service-account'
      gcp_workload_identity_provider: 'my-workload-identity-provider'
      environment: 'prod'
      python_version: '3.9'
      secret_filter: 'my-secret-filter'
      slack_webhook_url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX'
      terraform_version: '0.14.5'
      working_dir: './terraform'
      refresh: 'true'
      github_token: 'github-token'
```
