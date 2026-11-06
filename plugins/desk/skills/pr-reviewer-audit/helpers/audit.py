"""ADO PR reviewer audit — 4-step recipe from ``../SKILL.md``.

Implements the file→required-groups map + approver ranking for a
given ADO pull request. Stdlib + ``requests`` only; no harness-
specific SDK.

Entry points:

- ``ensure_tenant()`` — verifies the active ``az`` account is in
  the expected tenant. Runs before any ADO request.
- ``parse_args(argv)`` — parses ``(org, project, repo_id, pr_id)``.
- ``main(org, project, repo_id, pr_id)`` — runs the recipe; returns
  ``{"file_to_groups": ..., "approver_ranking": ...}``.
- CLI: ``python audit.py <org> <project> <repo_id> <pr_id>``.

Integration against a real PR is a documented manual-verify step,
not automated by ``test_audit.py``.
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
from typing import Any

import requests

logger = logging.getLogger(__name__)


EXPECTED_TENANT = "microsoft.onmicrosoft.com"
ADO_RESOURCE_GUID = "499b84ac-1321-427f-aa17-267ca6975798"
REQUIRED_REVIEWER_POLICY_TYPE_ID = "fd2167ab-b0be-447a-8ec8-39368250530e"
API_VERSION = "7.1"
REQUEST_TIMEOUT_SECONDS = 30


def ensure_tenant() -> bool:
    """Verify the active ``az`` session is in the expected tenant.

    Returns ``True`` when the active tenant matches
    ``EXPECTED_TENANT``. On mismatch, logs a warning and returns
    ``False`` — callers should abort or switch tenants before any
    ADO request.
    """
    proc = subprocess.run(
        ["az", "account", "show", "--query", "tenantDefaultDomain", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=False,
    )

    if proc.returncode != 0:
        logger.warning(
            "az account show failed (returncode=%s); cannot verify tenant. "
            "stderr=%r",
            proc.returncode,
            proc.stderr.strip() if proc.stderr else "",
        )
        return False

    active_tenant = (proc.stdout or "").strip()

    if active_tenant != EXPECTED_TENANT:
        logger.warning(
            "az tenant mismatch: active=%r expected=%r. Run "
            "`az login --tenant %s` before retrying.",
            active_tenant,
            EXPECTED_TENANT,
            EXPECTED_TENANT,
        )
        return False

    return True


def _get_bearer_token() -> str:
    """Fetch an ADO REST bearer token via ``az``."""
    proc = subprocess.run(
        [
            "az",
            "account",
            "get-access-token",
            "--resource",
            ADO_RESOURCE_GUID,
            "--query",
            "accessToken",
            "-o",
            "tsv",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"az get-access-token failed (returncode={proc.returncode}); "
            f"stderr={proc.stderr.strip() if proc.stderr else ''!r}"
        )
    return (proc.stdout or "").strip()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _fetch_required_reviewer_policies(
    org: str,
    project: str,
    repo_id: str,
    headers: dict[str, str],
) -> list[dict[str, Any]]:
    """Step 1+2 — fetch policies and filter to enabled required-reviewer."""
    url = (
        f"https://dev.azure.com/{org}/{project}/_apis/policy/configurations"
        f"?repositoryId={repo_id}"
        f"&refName=refs/heads/main"
        f"&api-version={API_VERSION}"
    )
    resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    body = resp.json()

    configs = body.get("value", []) or []
    filtered: list[dict[str, Any]] = []
    for cfg in configs:
        type_info = cfg.get("type") or {}
        if type_info.get("id") != REQUIRED_REVIEWER_POLICY_TYPE_ID:
            continue
        if not cfg.get("isEnabled", False):
            continue
        if cfg.get("isDeleted", False):
            continue
        filtered.append(cfg)
    return filtered


def _fetch_pr_detail(
    org: str,
    project: str,
    repo_id: str,
    pr_id: str,
    headers: dict[str, str],
) -> dict[str, Any]:
    """Step 3 — fetch PR detail including reviewers and votes."""
    url = (
        f"https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo_id}"
        f"/pullRequests/{pr_id}"
        f"?api-version={API_VERSION}"
    )
    resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.json()


def _fetch_pr_files(
    org: str,
    project: str,
    repo_id: str,
    pr_id: str,
    headers: dict[str, str],
) -> list[str]:
    """Helper — fetch the set of files changed by the PR.

    Uses the PR iterations/changes endpoint. Returns an empty list
    on a dry-run / no-iteration PR (acceptable for a smoke test).
    """
    url = (
        f"https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo_id}"
        f"/pullRequests/{pr_id}/iterations?api-version={API_VERSION}"
    )
    resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    iterations = resp.json().get("value") or []
    if not iterations:
        return []

    latest = iterations[-1]
    iter_id = latest.get("id")
    if iter_id is None:
        return []

    changes_url = (
        f"https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo_id}"
        f"/pullRequests/{pr_id}/iterations/{iter_id}/changes"
        f"?api-version={API_VERSION}"
    )
    changes_resp = requests.get(
        changes_url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS
    )
    changes_resp.raise_for_status()
    change_entries = changes_resp.json().get("changeEntries") or []
    paths: list[str] = []
    for entry in change_entries:
        item = entry.get("item") or {}
        path = item.get("path")
        if path:
            paths.append(path)
    return paths


def _scope_matches(scope: dict[str, Any], file_path: str) -> bool:
    """Return True when a policy scope covers ``file_path``."""
    match_kind = scope.get("matchKind") or "Exact"
    scope_path = scope.get("path") or ""
    if not scope_path:
        return True
    if match_kind == "Exact":
        return file_path == scope_path
    if match_kind == "Prefix":
        return file_path.startswith(scope_path)
    if match_kind == "DefaultBranch":
        return True
    return False


def _build_file_to_groups(
    policies: list[dict[str, Any]],
    files: list[str],
) -> dict[str, list[str]]:
    """Step 4a — produce ``{file: [group_descriptor, ...]}``."""
    out: dict[str, list[str]] = {}
    for f in files:
        groups: list[str] = []
        for cfg in policies:
            settings = cfg.get("settings") or {}
            scopes = settings.get("scope") or []
            if any(_scope_matches(s, f) for s in scopes):
                required_ids = settings.get("requiredReviewerIds") or []
                for rid in required_ids:
                    if rid not in groups:
                        groups.append(rid)
        out[f] = groups
    return out


def _build_approver_ranking(
    pr_detail: dict[str, Any],
    file_to_groups: dict[str, list[str]],
) -> list[dict[str, Any]]:
    """Step 4b — rank current reviewers by which required groups they
    can satisfy via ``votedFor[]``.
    """
    all_required_groups: set[str] = set()
    for groups in file_to_groups.values():
        all_required_groups.update(groups)

    ranking: list[dict[str, Any]] = []
    for reviewer in pr_detail.get("reviewers") or []:
        voted_for = reviewer.get("votedFor") or []
        satisfies = [
            entry.get("id")
            for entry in voted_for
            if entry.get("id") in all_required_groups
        ]
        ranking.append(
            {
                "displayName": reviewer.get("displayName"),
                "descriptor": reviewer.get("descriptor"),
                "vote": reviewer.get("vote"),
                "satisfies": satisfies,
            }
        )
    # Stable ordering: reviewers who satisfy more groups rank first.
    ranking.sort(key=lambda r: (-len(r["satisfies"] or []),))
    return ranking


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI argument parser. Accepts 4 positional args.

    Order: ``org project repo_id pr_id``.
    """
    parser = argparse.ArgumentParser(
        description="Audit required-reviewer policies and approver votes on an ADO PR.",
    )
    parser.add_argument("org", help="ADO organization name (e.g., domoreexp)")
    parser.add_argument("project", help="ADO project name (e.g., Teamspace)")
    parser.add_argument("repo_id", help="Repository GUID")
    parser.add_argument("pr_id", help="Pull-request numeric ID")
    return parser.parse_args(argv)


def main(
    org: str,
    project: str,
    repo_id: str,
    pr_id: str,
) -> dict[str, Any]:
    """Run the 4-step recipe and return the result dict.

    Return shape: ``{"file_to_groups": {...}, "approver_ranking": [...]}``.
    """
    tenant_ok = ensure_tenant()
    if not tenant_ok:
        logger.warning(
            "proceeding with tenant-mismatch sentinel; no ADO requests will be issued"
        )
        return {"file_to_groups": {}, "approver_ranking": []}

    try:
        token = _get_bearer_token()
    except RuntimeError as exc:
        logger.warning("could not acquire ADO bearer token: %s", exc)
        return {"file_to_groups": {}, "approver_ranking": []}

    headers = _auth_headers(token)

    policies = _fetch_required_reviewer_policies(org, project, repo_id, headers)
    pr_detail = _fetch_pr_detail(org, project, repo_id, pr_id, headers)
    files = _fetch_pr_files(org, project, repo_id, pr_id, headers)

    file_to_groups = _build_file_to_groups(policies, files)
    approver_ranking = _build_approver_ranking(pr_detail, file_to_groups)

    return {
        "file_to_groups": file_to_groups,
        "approver_ranking": approver_ranking,
    }


def _cli_main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ns = parse_args(argv)
    result = main(ns.org, ns.project, ns.repo_id, ns.pr_id)
    json.dump(result, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli_main())
