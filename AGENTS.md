# AI Working Agreement

Before changing the project, read `dev_docs/header.md`, inspect Git status, and
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
