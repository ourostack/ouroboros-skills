---
name: pr-reviewer-audit
description: Audit which reviewers are required on a PR (by files touched) and which are active approvers in the current PR's vote state. Produces a file→required-groups map + approver ranking. Runnable via helpers/audit.py against a live PR. Use when operator asks "who needs to approve this PR," "what's the reviewer situation," or when drafting a who-to-ping message for a long-sitting PR.
---

# PR reviewer audit

When a PR has been sitting without movement, the operator needs to
know who is structurally required to approve (by ADO branch-policy
required-reviewer rules, scoped by file path) and who is actually
reviewing the PR today. This skill is the recipe; the runnable
implementation lives in `helpers/audit.py`.

Engine-agnostic. All calls go through the ADO REST API; no harness
MCP tools are named in the recipe.

## Preamble — az tenant sniff

ADO REST authentication uses `az account get-access-token --resource <ADO resource GUID>`,
which returns a token scoped to the CURRENT azure account's
tenant. If the active `az` login is under a different tenant, the
REST calls either return 401s or silently query a different ADO
tenant's data (rare but possible).

Before any REST call, verify the active tenant:

```bash
az account show --query tenantDefaultDomain -o tsv
```

Expected: `microsoft.onmicrosoft.com`.

If mismatched, switch:

```bash
az login --tenant microsoft.onmicrosoft.com
```

The `helpers/audit.py` implementation runs this check on startup and
exits (or logs and returns a sentinel) on mismatch before any
network call. Never skip the tenant check — a subtly-wrong tenant
produces plausible-looking output that's actually from the wrong
directory.

## 4-step recipe

### Step 1 — fetch required-reviewer policies for the target branch

```
GET https://dev.azure.com/{org}/{project}/_apis/policy/configurations
    ?repositoryId={guid}
    &refName=refs/heads/main
    &api-version=7.1
```

Returns all branch policies on `main` for the specified repo.

### Step 2 — filter to enabled required-reviewer policies

Of the returned policies, keep only those where:

- `type.id == "fd2167ab-b0be-447a-8ec8-39368250530e"` — the
  required-reviewer policy type GUID.
- `isEnabled == true`.
- `isDeleted == false`.

Each surviving policy has:

- `settings.scope[]` — each scope entry has a `matchKind`
  (`Exact` | `Prefix` | `DefaultBranch`) and a `refName` / `path`
  that defines what files the policy applies to.
- `settings.requiredReviewerIds[]` — the identity descriptors of the
  groups (or individuals) required to approve matches.

### Step 3 — fetch the PR's current reviewer votes

```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{guid}/pullRequests/{prId}
    ?api-version=7.1
```

The response's `reviewers[]` array lists every reviewer added to the
PR with:

- `vote` — `10` (approved), `5` (approved with suggestions),
  `0` (no vote), `-5` (waiting), `-10` (rejected).
- `votedFor[]` — when a reviewer votes "on behalf of" a required
  group, ADO records the group descriptor(s) in this array. This
  is how a single human's approve-vote can satisfy a required-group
  check.

### Step 4 — build file→group map + approver ranking

- **File → required groups**: for each changed file in the PR,
  walk the policy scopes and collect the groups whose scope covers
  that file path.
- **Approver ranking**: group reviewers by which required-groups
  they could satisfy (via `votedFor[]`), ranked by historical
  approval activity on similar PRs (pulled from prior PRs in the
  same repo — see `helpers/audit.py` for the scoring function).

Output:

```
{
  "file_to_groups": {
    "src/Common/Partners/SMB/Models/SMBAgentResponse.cs": [
      "Teams SMB Reviewers",
      "Teams Common DTO Owners"
    ],
    ...
  },
  "approver_ranking": [
    {"displayName": "...", "currentVote": "approved", "satisfies": ["Teams SMB Reviewers"], "score": 0.92},
    ...
  ]
}
```

## Dead-end group types — don't waste time expanding

Some ADO required-reviewer groups cannot be expanded to individual
human approvers via the REST API. When the recipe surfaces one of
these group descriptors, do not keep drilling:

- **CRG (Contact Role Groups)** — returns zero members on both
  `GET /{org}/_apis/identities?descriptors={descriptor}&queryMembership=Expanded`
  and `GET /{org}/_apis/graph/memberships/{descriptor}?direction=Down`.
  The CRG is an abstract policy anchor, not a materialized identity
  list.
- **AAD application groups** — similar: the descriptor resolves but
  membership-expansion endpoints return empty. Members are gated
  by a separate AAD application-role system that the ADO REST
  surface does not expose.
- **PIM JIT (Just-In-Time) groups** — membership is ephemeral and
  session-scoped. Querying membership now returns who is
  currently-elevated, not who can elevate.

Fallback when any of these surfaces: switch to
**active-approver-ranking by PR history.** Query recent PRs in the
same repo that touched overlapping files, extract the human
reviewers who actually voted on those PRs, and rank by activity.
The history query is in `helpers/audit.py`.

## Runnable implementation

`helpers/audit.py` is the runnable implementation of this 4-step
recipe. Invocation:

```bash
python helpers/audit.py <org> <project> <repoId> <prId>
```

The script:

1. Runs the az-tenant sniff preamble; exits on mismatch.
2. Authenticates to ADO REST via
   `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`
   (the ADO resource GUID).
3. Executes steps 1–4 above.
4. Emits the `{"file_to_groups": ..., "approver_ranking": ...}`
   dict as JSON.

Stdlib + `requests` only. No harness-specific SDK dependency; runs
on any Python 3.10+ environment with `az` installed.

## When to run the audit

- **PR has been sitting without movement** for more than a few
  business days. Output feeds a who-to-ping draft.
- **Before asking an operator-provided reviewer for signoff** — the
  audit confirms they are actually a required approver, not just
  a stakeholder.
- **After a merge fails on a required-reviewer policy gate** — the
  audit shows which policies were unsatisfied.
