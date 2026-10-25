---
name: madar-workflow
description: "Use for implementation, debugging, review, or resuming work in Madar. Define observable outcomes, choose relevant Matt Pocock and poteto skills, verify changes, and improve the environment from recurring failures."
---

## Start with intent and proof

Turn the request into a short brief before substantial implementation. Infer what the conversation
already answers and state consequential assumptions. Investigate questions the code or tools can
answer. Ask the human about unresolved product choices that materially change the result.

Keep this brief in the thread or the existing tracking item:

```text
Outcome: Who benefits, and what should they be able to do?
Scope: What changes, and what stays outside this task?
Context: Relevant issue, prior decision, reproduction, or source files.
Proof: Observable success and the smallest check that demonstrates it.
Constraints: Compatibility, performance, data, or authorization limits that matter here.
```

For a bug, identify a reproduction and expected behavior. For performance work, identify the workload,
baseline, metric, and measurement method. For a feature, describe a successful user journey and its
important failure or reverse state. For documentation, define what decision or task the text enables.

Proceed with authorized, reversible work once the outcome and proof are clear. Keep product choices
with the human and implementation details with the agent.

## Gather context and choose the tools

Inspect the relevant source, nearby tests, and applicable guidance. On a resumed task, compare prior
decisions with the actual branch and working tree. Treat transcripts as historical evidence, then
confirm claims against current code. Use only this project's history unless the user expands scope.

Choose the smallest useful set of installed skills. The following are entry points, not a sequence
that every task must run:

- For unclear intent, use [grilling](../grilling/SKILL.md). For decisions spanning several sessions,
  consider [wayfinder](../wayfinder/SKILL.md) when the user wants a planning exercise.
- For subsystem behavior or ownership, use [how](../how/SKILL.md). For design rationale, use
  [why](../why/SKILL.md). For a significant interface decision, use [architect](../architect/SKILL.md).
- For a reported defect, use [diagnosing-bugs](../diagnosing-bugs/SKILL.md). Use
  [pstack-tdd](../pstack-tdd/SKILL.md) for a cheap local regression target. Use
  [tdd](../tdd/SKILL.md) when the user requests a test-first workflow.
- For measured performance claims, use [benchmark-checklist](../benchmark-checklist/SKILL.md).
- For a requested review, use [code-review](../code-review/SKILL.md). For an adversarial review,
  use [interrogate](../interrogate/SKILL.md).
- For substantial prose, use [unslop](../unslop/SKILL.md). For changes to agent instructions,
  use [writing-for-agents](../writing-for-agents/SKILL.md).

Read each chosen skill before applying it. Repository instructions govern differences such as
bundled requests for full-suite checks, automatic commits or PRs, and browser verification.

## Implement one verifiable change

Identify the data shape, invariant, and module that should own the behavior. Prefer existing seams.
Complete one coherent change, including affected callers and the applicable entries in AGENTS.md's
"Hit every surface" list. Preserve performance and remote behavior when choosing the implementation.

Reuse the repository's scripts and verification tools. When repeated mechanical work needs a tool,
build a small rerunnable script or codemod and verify it on one representative case before widening
its scope. Keep judgment in the skill and repeatable mechanics in code.

Fix the first incorrect assumption or transition that caused a defect. If two fixes based on the
same premise fail the same check, test that premise directly before trying another fix. Keep
unrelated cleanup outside the change.

## Verify and review the result

Run the proof defined in the brief. Use focused behavior tests and applicable lint or type checks.
Backend behavior changes include focused tests. Prefer assertions at observable boundaries; a test
must detect wrong behavior rather than repeat the implementation. Documentation-only edits need
content, link, and diff checks rather than application tests.

For authorized UI verification, use [test-t3-app](../test-t3-app/SKILL.md) or
[test-t3-mobile](../test-t3-mobile/SKILL.md). Follow AGENTS.md's browser and computer-use permission
rule. Reuse the existing client controls and isolated test-data setup. Report a missing integrated
pass as unverified; compilation alone cannot establish that a user journey works.

Inspect the final diff against the brief and the affected surfaces. Recheck after a meaningful fix;
stop repeating checks once the relevant checks pass and no unresolved concern requires another run.
Report the resulting behavior, evidence from the checks actually run, and remaining limitations.
Separate observed facts from inferences. A failing or unavailable proof is an explicit gap.

## Improve the environment from evidence

After a recurring correction or repeated workaround, identify what let it happen. Prefer a narrower
API or better data model, then types, then an existing lint or validation mechanism. Use a behavior
test for a regression. Use a skill or short context pointer when the lesson requires judgment.
Prove a new automated check catches a real example of the mistake and accepts a valid case.

Review samples of completed work when assessing the workflow. Look for repeated human interventions,
false confidence from checks, missing context, and duplicated setup. Compare similar tasks by whether
the agent reached verified outcomes with fewer corrections. Use [retro](../retro/SKILL.md) for a
requested session retrospective. Personal preferences need an explicit instruction or recurring
evidence; a podcast example alone does not establish the user's preferred style.

Group related findings before assigning fixes. Keep evidence and unresolved findings in the owning
issue or project item when tracker updates are authorized, otherwise in the thread. Keep temporary
logs outside the worktree. Capture durable decisions using the existing documentation rules. This
workflow is not a second backlog or wiki. Only include an environment improvement in the current
change when it is necessary to complete the task; otherwise propose it separately.

## Scale autonomy when the proof supports it

The default is to carry an authorized task through implementation and verification, then return a
reviewable result. The podcast's autonomous merging and scheduled work are examples of a later trust
level. They grant no additional permissions in this project.

When the user requests parallel or coordinated work, group reports by likely cause first. Give each
worker an outcome, context pointers, ownership boundaries, proof, and a stopping condition. Isolate
concurrent writes and have the primary agent review and verify the integrated result. Use the live
model catalog and requested settings rather than copying the podcast's model choices.

Before expanding standing automation, agree its scope, triggers, verification, stop conditions, and
recovery path. Begin with observation and grouped findings. Expand to fixes only within the granted
scope and after the verification method has demonstrated useful results. Human sampling can improve
the process; it does not replace checks on each change. Irreversible actions and poorly verifiable
work need a human decision before execution.

## Giving the next task

The human can start with a normal request or name `madar-workflow`. Supply the desired result and any
important constraints; the agent should discover routine implementation details. For example:

```text
Fix this bug in Madar. Here is the reproduction and expected behavior: ...
Find the root cause, make the smallest complete change, and show the proof.
```

For a larger effort, first ask the agent to identify the unresolved decisions and verification method.
Agree the product choices, then let it implement within that scope. Requests for additional autonomy
should name the actions being authorized.
