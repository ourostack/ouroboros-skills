---
name: work-ideator
description: Align new engineering work on the intended outcome, constraints, definition of done, and explicit go-ahead before implementation. Resume already-approved work without reopening alignment.
---

# Work Ideator

New engineering work needs substantive alignment and an explicit go-ahead before implementation, even when the code change looks obvious. Repository contribution permission, a ready plan, "get this started," and the agent's confidence do not establish that agreement.

For already-approved work, read its existing alignment receipt and resume from the current task state without another workshop or go-ahead. The receipt can be the relevant conversation plus a short pointer in the existing task card; it is not a new state store or mandatory planning document.

The boundary follows the action, not its eventual filename. Before go, do not write or execute a candidate implementation or new tests, including disposable prototypes in scratch, uncommitted changes, and code you intend to delete. Reading source, running existing tests, and probing existing behavior without substituting replacement logic are discovery. A useful implementation spike needs its own explicitly approved scope; calling it research does not supply that approval.

## Align

1. Read the request, prior agreement, and the code, product, or evidence it touches. Read-only discovery can precede go-ahead; implementation cannot.
2. Explain the intended user outcome and current behavior. Surface the material constraints, non-goals, and tradeoffs instead of turning an assumption into a decision.
3. Apply Ponytail's ladder: does this need to exist, already exist, or reduce to a native/stdlib/current dependency? Recommend the smallest complete shape and explain what it deliberately does not do.
4. Agree the definition of done, including the observable result, applicable quality and compatibility floors, contribution scope, and terminal delivery boundary. A published preview, an open PR, a merge, and a deployment are different outcomes.
5. Obtain the operator's explicit go-ahead for that understood contract and retain the exact confirming message or durable reference.

Use normal conversation, one material decision group at a time. Reuse context, answer objections, and revise the proposed shape. Do not substitute a fixed questionnaire, a ceremonial "looks good?", or a request for permission to investigate for actual alignment. A request that already supplies an explicitly agreed contract and go-ahead does not need a redundant extra turn.

## Hand off

Record a concise alignment receipt in the existing task or planning artifact: outcome, constraints, definition of done, agreed scope and non-goals, and the go-ahead reference. Choose the post-go planning lane through `work-orchestration`; clear work can remain task-card-only.

After go-ahead, keep control through the agreed terminal state. Routine implementation decisions and recoverable failures are not new approval gates. Reopen only a material change to the agreed outcome or authority, not a discovery that can be handled inside it. Read-only questions and status requests remain questions, not invitations to implement.
