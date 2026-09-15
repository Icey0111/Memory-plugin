# AI Working Agreement

## Read First: AIRP Memory Product Contract

Preserve this user-defined meaning when planning, implementing, reviewing, or
resuming after context compaction:

> 我只能肯定总结摘要负责给剧情发展提供保障，摘要呈结构化，提供记忆的逻辑架构。检索负责精准找到原文的细节，负责确定性事实的根本性。二者共同协作就是针对airp场景的记忆本身。

- Structured summaries maintain the logic required for continuing roleplay:
  the situation, necessary causes, goals, unresolved commitments, state changes,
  conditions, negations and knowledge boundaries.
- Retrieval recovers precise, version-correct original evidence for details and
  factual verification. Original history is authoritative; summaries are derived
  interpretations. A quotation is evidence, not proof of the current world state
  or a guarantee that the reply uses it correctly.
- The two responsibilities must cooperate in the actual prompt. A fact being
  archived, summarized, selected, injected and correctly used are distinct
  outcomes. A parked active constraint is not guaranteed to return through
  similarity search, especially during continuation without an explicit question.
- Preserve necessary meaning before minimizing summary length. Equal numbers of
  turns can carry different amounts of information; unresolved older state also
  needs space. The intended direction is a soft summary-length target with an
  explicit upper bound, separate from the total injection budget. This is a
  product direction: the current 600-token default hard acceptance cap remains
  implemented until a separately validated change replaces it.
- Diagnose the first observed loss in original text -> summary/state -> selection
  and retrieval -> actual injection -> reply. Fix that stage; do not treat more
  layers, a longer summary, structural test passes or recall alone as proof of
  better narrative continuity.

Do not silently replace this contract with an always-small fixed-cost objective,
an unbounded always-injected history, or a promise of perfect semantic memory.
The current goals are in [dev_docs/00_project.md](dev_docs/00_project.md);
the bounded execution plan is [Issue #2](https://github.com/Icey0111/Memory-plugin/issues/2).
Read these responsibilities again after context compaction before choosing the
next task. Unfinished plan steps are not implemented capabilities.

## Before Changing the Project

Read `dev_docs/header.md`, then `dev_docs/00_project.md` and
`dev_docs/01_architecture.md`, inspect Git status, and
preserve unrelated work. Prefer an isolated worktree and a dedicated task
branch. Requirements and iteration evidence belong in the Issue and pull
request; `dev_docs/` contains current facts only.

## Completion Contract

A discussion-only or read-only task requires no commit. A task that changes
tracked project content is complete only when all of the following are true:

1. Relevant tests and checks passed.
2. The final diff was reviewed and contains only task-scoped changes.
3. Changes were committed on a non-default branch.
4. The worktree is clean.
5. The branch was pushed and its remote SHA was verified with:

   ```bash
   python <project-docs-workflow>/scripts/finish_task.py --root <project-root>
   ```

6. A pull request was created or updated when the hosting platform supports it.

If the remote, credentials, network, commit, or verification is missing, report
the task as incomplete or blocked. Never claim completion based only on a local
commit. Never force-push or push the default branch through this workflow.
