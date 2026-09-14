# ADR-0035: A detail-survival needle is matched with paraphrase tolerance

- Status: accepted
- Date: 2026-09-14
- Supersedes: -
- Superseded by: -

## Context

The first live detail-survival run (chat DetailSurvival1, 20 turns, both batches committed) read three of
six details as absent from every channel while the injected blocks carried them. The merged summary said
"缺角" for a needle written "缺了一角", "左耳白" for "左耳是白的", and "第三夜前" / "第三天天黑前" for
"第三天夜里". A verbatim-only reader charged two of them to the model as fabricated and one as refused; the
reply had answered all three correctly. The adaptive retention step used the same verbatim test, so it also
asked four details the summary had actually kept.

## Decision

Match a needle with two readings, verbatim first:

1. **verbatim** - any surface form occurs in the text;
2. **content run** - any contiguous run of at least two of the needle's content characters occurs, longest
   run first, with function characters ("了", "的", "是", "里", ...) dropped. The matched token is recorded.

Channel attribution, the committed-summary retention and the reply reading share this matcher. The
question-leak check stays strict, and a run needs two content characters, so a short needle cannot match by
coincidence.

## Consequences

- The frozen live run re-scores as 摘要保留 4 / 检索取回 1 / 拒绝 1 / 编造 0 - five confirmed passes and the
  never-written value refused - instead of 1/1/2/2.
- Every row records how each needle matched, so a tolerant hit is auditable and never silently replaces a
  verbatim one.
- This is a measured heuristic, not semantics: an incidental two-character run can match, so the negative
  control stays mandatory and `answer-adjudication.mjs` still decides what a row means.
- Needle guidance changes: a needle should be a distinctive token, together with the paraphrase forms the
  story might use, rather than one wording of a clause.
