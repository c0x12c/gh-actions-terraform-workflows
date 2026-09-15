#!/usr/bin/env python3
"""Build the Slack Block Kit payload announcing a terraform apply awaiting approval.

Carries counts and one header per changing resource. Attribute diffs are excluded deliberately: a rendered
plan is not secret-masked, and its value lines hold database passwords and connection strings that
would outlive the run once they reach a channel.
"""
import json
import os
import re

BODY_BUDGET = 2400  # Slack caps a text object at 3000; leaves room for the fence and the tail line
CHANGELOG_BUDGET = 1200  # a second fenced block; the same Slack 3000-char text cap applies


def _mention(group_id: str) -> str:
    """Slack resolves user groups by ID, not display name - an unknown ID renders as literal text
    and pings nobody, so a malformed value is worth failing on rather than posting silently."""
    if not group_id:
        return ""
    if not re.fullmatch(r"S[A-Z0-9]{2,}", group_id):
        raise SystemExit(
            f"slack_group_id must be a Slack user-group ID like S01ABC2DEF, got: {group_id}"
        )
    return f"<!subteam^{group_id}>"


def _escape_mrkdwn(text: str) -> str:
    """Release-note lines carry PR titles, which any contributor controls. Slack parses
    `<!channel>`, `<!subteam^ID>` and `<@U123>` out of message text, so an unescaped title can make
    an approval notice ping an audience the author of the title chose. Slack's own escaping for
    text content is these three, ampersand first."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _render_changelog(raw: str) -> str:
    """GitHub's generated notes are markdown; Slack mrkdwn has no headings and its own bullet."""
    lines = []
    for line in raw.split("\n"):
        stripped = _escape_mrkdwn(line.strip())
        if not stripped or stripped.startswith("**Full Changelog**"):
            continue
        if stripped.startswith("#"):
            lines.append(f"*{stripped.lstrip('#').strip()}*")
        elif stripped.startswith(("* ", "- ")):
            lines.append(f"- {stripped[2:]}")
        else:
            lines.append(stripped)
    out, size = [], 0
    for line in lines:
        if size + len(line) > CHANGELOG_BUDGET:
            out.append("... more in the release notes")
            break
        out.append(line)
        size += len(line) + 1
    return "\n".join(out)


def main() -> None:
    repo = os.environ["REPO"]
    environment = os.environ["ENVIRONMENT"]
    ref_name = os.environ["REF_NAME"]
    run_url = os.environ["RUN_URL"]
    counts = os.environ.get("PLAN_COUNTS") or "plan summary unavailable"
    changes = os.environ.get("PLAN_CHANGES") or ""
    total = int(os.environ.get("PLAN_TOTAL") or 0)
    has_destroy = os.environ.get("HAS_DESTROY") == "true"
    group_id = os.environ.get("SLACK_GROUP_ID", "").strip()
    changelog = os.environ.get("CHANGELOG", "").strip()

    rows = [line for line in changes.split("\n") if line.strip()]

    # Truncate on a line boundary so an address is never cut mid-way, which would read as a
    # different address entirely.
    kept, size = [], 0
    for line in rows:
        if size + len(line) > BODY_BUDGET:
            break
        kept.append(line)
        size += len(line) + 1
    body = "\n".join(kept)

    # Count against what survived, never the pre-truncation list. Two things drop rows - the
    # plan_max_rows cap upstream and the budget above - and a notice that silently shows a subset
    # is worse than one showing nothing, because the reader cannot tell it is incomplete.
    omitted = max(total, len(rows)) - len(kept)
    if omitted > 0:
        body += f"\n... {omitted} more not shown, open the plan job"

    headline = "*Terraform apply is waiting for approval*"
    if has_destroy:
        headline = (
            ":rotating_light: *Terraform apply is waiting for approval - "
            "THIS PLAN DESTROYS OR REPLACES RESOURCES*"
        )

    mention = _mention(group_id)

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{headline}\n`{repo}` -> *{environment}* at `{ref_name}`"
                + (f"\n{mention}" if mention else ""),
            },
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*{counts}*"}},
    ]
    rendered_changelog = _render_changelog(changelog) if changelog else ""
    if rendered_changelog:
        blocks.append(
            {"type": "section", "text": {"type": "mrkdwn", "text": rendered_changelog}}
        )
    if body:
        blocks.append(
            {"type": "section", "text": {"type": "mrkdwn", "text": f"```\n{body}\n```"}}
        )
    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "Resource addresses and counts only - attribute values are omitted "
                    "because a rendered plan is not secret-masked. Open the *Terraform plan* job "
                    "for the full diff. The pull-request-time plan is not a substitute: several "
                    "pull requests can merge between it and the tag.",
                }
            ],
        }
    )
    blocks.append(
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "style": "danger" if has_destroy else "primary",
                    "text": {"type": "plain_text", "text": "Review the plan and approve"},
                    "url": run_url,
                }
            ],
        }
    )

    print(
        json.dumps(
            {
                "text": f"Terraform apply waiting for approval: {repo} {environment} "
                f"{ref_name} - {counts}",
                "blocks": blocks,
            }
        )
    )


if __name__ == "__main__":
    main()
