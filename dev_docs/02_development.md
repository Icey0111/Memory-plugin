# Development and Validation

The extension is native JavaScript ES modules, with no build step. Use Node.js 20 or newer.

| Command | Purpose |
| --- | --- |
| npm run check | Discover and syntax-check sources |
| npm test | Offline regressions, including host adapters |
| node test-summary-lifecycle.mjs | Cadence, concurrent reads, joint invalidation and summary transport |
| node recall-baseline.mjs | Original-text retrieval and packing measurement |
| node recall-embed.mjs | Build the optional embedding cache for the ruler |

## Acceptance contract

Default summary cadence is **10 floors**, a floor being one user message and the character's reply -
twenty dialogue message rows. The setting, the report and the hidden count all use that unit; message rows
are the derived number.
A character greeting is not a user turn; an unanswered user message is not completed. Tests of
specific boundaries may explicitly use another interval, but live acceptance must retain 10.

Run at least 30 completed turns to exercise three automatic summaries. Record summary responses
(requested output cap, finish reason, body length, reasoning usage when returned), covered sources,
folded rows, quoted evidence, query, and actual character replies. Keep original text authoritative.
Check one exact historical detail, a changed ownership, an unresolved commitment, and a character
who was absent when a secret was disclosed. A substring recall score is not a narrative-quality score.

Use a new named test chat and verify character, chat identity and extension activation before running.
Wait for the background worker at measurement points without forcing a summary. Record temporary
test settings and restore them after the run. Do not print API credentials or reasoning text.

Offline tests must cover history edit/delete/swipe, late background results, ordinary generation
during a summary, a partial/empty completion, and unchanged main-generation settings. A generation
read must not start or wait for a summary. Quiet fallback recursion remains suppressed.

## Delivery

Review the scoped diff, run checks, commit on the task branch, then use the finish_task.py command
in AGENTS.md to push and verify the remote SHA. Update the PR with actual verification results.
CI runs syntax and offline tests on pull requests to main. Live-model runs are separate acceptance
evidence and are not implied by a green CI check.

## Retrieval experiments

The ruler accepts --paraphrases (question, needle, kind and optional chat), --scorer, --pack,
--evidence, --entries, --embeddings and --dense-weight. --dump and --against compare matched questions.
Use held-out stories before treating measured weights as general defaults. Never commit private
chat corpora, API keys or full provider logs. See 06_retrieval_research.md for past measurements.
