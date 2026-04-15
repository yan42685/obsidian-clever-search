# AGENTS

## Design Doc Update Rule

- When a stage or phase goal from an active design document is fully achieved,
  update that design document's implementation-status or progress section in
  the same workstream before closing the task or creating the final commit.
- For `coverage-lexical` work, this applies in particular to the active design
  docs under `benchmarks/design/`.
- Do not rely on memory alone for stage tracking; write the completed-state
  update back into the relevant design doc once the milestone is actually
  reached.

## Plan Completion Check Rule

- When executing a plan-mode task or a user-provided implementation plan, do a final end-of-task check that every planned item is 100% complete before closing the task.
- If any plan item is intentionally deferred, blocked, or only partially complete, call that out explicitly in the final status instead of implying the whole plan is done.
