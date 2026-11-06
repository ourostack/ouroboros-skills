---
name: pr-reviewer-audit
description: Audit which reviewers are required on a PR (by files touched) and which are active approvers in the current PR's vote state. Produces a file→required-groups map + approver ranking. Use when operator asks "who needs to approve this PR," "what's the reviewer situation," or when drafting a who-to-ping message for a long-sitting PR.
---

# PR reviewer audit

When a PR has been sitting without movement, the operator needs to
know **who is structurally required to approve** (by the host's
branch-policy required-reviewer rules, scoped by file path) and **who
is actually reviewing the PR today**. This skill is the
platform-agnostic recipe.

> **Overlay users:** platform-specific runnable implementations
> (auth preamble, tenant-sniff checks, REST endpoints, required-
> reviewer policy-type identifiers, and any group-expansion lore
> for the host's identity system) typically live in a consumer
> overlay's PR-toolbox skill. The conceptual recipe below applies
> to any platform.

## 4-step recipe

### Step 1 — fetch required-reviewer policies for the target branch

Query the host platform's branch-protection / required-reviewer
policy surface for the PR's target branch. Capture every policy that
mandates one or more reviewers, with its file-path scope (if the
platform supports per-path policies).

### Step 2 — filter to enabled required-reviewer policies

Drop disabled / deleted policies. For each surviving policy, capture:

- The **scope** — what file paths the policy covers (exact path,
  prefix, default-branch, etc., depending on platform).
- The **required reviewers** — the identity descriptors of the groups
  (or individuals) required to approve matches.

### Step 3 — fetch the PR's current reviewer votes

Query the PR's reviewer list with each reviewer's current vote state
and (if the platform supports it) which required-groups each vote
covers ("voted on behalf of group X" semantics).

### Step 4 — build file→group map + approver ranking

- **File → required groups**: for each changed file in the PR, walk
  the policy scopes and collect the groups whose scope covers that
  file path.
- **Approver ranking**: group reviewers by which required-groups they
  could satisfy, ranked by historical approval activity on similar
  PRs (pulled from prior PRs in the same repo).

Output:

```
{
  "file_to_groups": {
    "src/Common/Partners/SMB/Models/ExampleResponse.cs": [
      "Example SMB Reviewers",
      "Example Common DTO Owners"
    ],
    ...
  },
  "approver_ranking": [
    {"displayName": "...", "currentVote": "approved", "satisfies": ["Example SMB Reviewers"], "score": 0.92},
    ...
  ]
}
```

## Dead-end group types — don't waste time expanding

Some platforms expose "required-reviewer groups" that cannot be
expanded to individual human approvers via the standard membership
API. Common patterns to recognize and short-circuit on:

- **Policy-anchor groups** that have no materialized member list
  (membership-expansion returns empty even though the descriptor
  resolves).
- **Application / service-principal-style groups** gated by a
  separate identity-role system the standard membership API doesn't
  expose.
- **Just-In-Time (JIT) elevation groups** whose membership is
  ephemeral and session-scoped — querying membership now returns who
  is currently-elevated, not who can elevate.

Fallback when any of these surfaces: switch to **active-approver
ranking by PR history.** Query recent PRs in the same repo that
touched overlapping files, extract the human reviewers who actually
voted on those PRs, and rank by activity.

## When to run the audit

- **PR has been sitting without movement** for more than a few
  business days. Output feeds a who-to-ping draft.
- **Before asking an operator-provided reviewer for signoff** — the
  audit confirms they are actually a required approver, not just a
  stakeholder.
- **After a merge fails on a required-reviewer policy gate** — the
  audit shows which policies were unsatisfied.
