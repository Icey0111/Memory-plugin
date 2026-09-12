# fix_epistemic_is_not_a_constant

- Date: 2026-09-11 20:05:00
- Session: Second finding of the functional check. The injected block labelled every non-intention memory
  `epistemic="fact"`, including beliefs and inferences.

## Problem / Requirement

The extraction prompt asks for two different things: how certain the claim is (`epistemic`) and how the
holder came to know it (`channel`). Measured over **844 real operations in 211 extraction records**, the
model wrote `channel` every time (saw 316, heard 145, inferred 120, told 26, empty 56) and `epistemic`
**never**.

The default was [memory-core.js L358](file:///D:/memory_plugin/memory-core.js#L358):

    epistemic: op.epistemic || (op.kind === 'intention' ? 'plan' : 'fact')

So every belief, every inference and every rumour was published to the prompt as a fact. Captured from a
real request on chat `Seraphina - 2026-09-11@19h32m15s946ms`:

    <memory id="m_4_3_2vq8m" kind="belief" status="active" epistemic="fact" ...>
    <summary>塞拉菲娜推断灰咳不是普通疾病，而是有东西在人的肺里扎根、抽丝、往外生长…</summary></memory>

That is the one upgrade the extraction rules forbid in as many words ("传闻/猜测/计划…不得升级为
fact"), printed back to the model as an assertion. Two further consequences:

- [v55-spine.js L110-L121](file:///D:/memory_plugin/v55-spine.js#L110-L121) infers the provenance channel
  from `belief`/`inference`/`rumor`; with the constant `fact` those rows fell through to `heard`.
- a wrong word in the field invalidated the **whole operation**, so a model that answered with the
  channel vocabulary (saw/heard/told/inferred, the obvious mistake) silently lost a memory.

## Purpose of Change

An epistemic label is data, not a constant: it must be derived from the record and never assert more
certainty than the model stated.

## How It Was Changed

- [memory-core.js L22-L49](file:///D:/memory_plugin/memory-core.js#L22-L49) — new exported
  `normalizeEpistemic(value, kind)`: an explicit valid value wins, the channel vocabulary is accepted as
  an alias (`saw`->observed, `heard`/`told`->reported, `inferred`->inference, `guess`->belief), and
  otherwise the kind decides: `belief`->belief, `intention`->plan, everything else->fact.
- [memory-core.js L379](file:///D:/memory_plugin/memory-core.js#L379) — `memoryFromAdd` uses it instead
  of the constant default.
- [memory-core.js L118-L123](file:///D:/memory_plugin/memory-core.js#L118-L123) — validation accepts an
  alias instead of rejecting the operation. A wrong field name should not cost a memory; a genuinely
  unknown word is still rejected.
- [memory-core.js L488-L495](file:///D:/memory_plugin/memory-core.js#L488-L495) — an `update` that changes
  `kind` without restating `epistemic` re-derives it, so an event does not keep the belief label it
  used to carry.
- [memory-extractor.js L93-L99](file:///D:/memory_plugin/memory-extractor.js#L93-L99) — the extractor
  normaliser keeps an aliased value rather than deleting it.
- [memory-extractor.js L224](file:///D:/memory_plugin/memory-extractor.js#L224) — the prompt now names the
  field: `op.epistemic` is required and enumerated, `op.channel` is separate, and the two must not be
  mixed.
- [test-v55-epistemic.mjs L1-L60](file:///D:/memory_plugin/test-v55-epistemic.mjs#L1-L60) — new test:
  the default follows the kind, aliases resolve, an alias does not invalidate an op, an unknown word does,
  the end-to-end store carries the right values, and a kind change re-derives.

## Verification

- `node run-tests.mjs` — **68/68 test files pass in 18.7 s** (66 before this session's two fixes).
- Offline, through `applyMemoryOps`: `belief` without an epistemic stores `epistemic: belief` and
  `channel: inferred` (it used to store `fact` / `heard`); `epistemic: 'told'` stores `reported`;
  `epistemic: 'saw'` stores `observed`; `intention` stores `plan`.
- Not yet re-measured live: whether the clarified prompt now makes the model emit `op.epistemic` on its
  own. The label is correct either way, because the kind fallback is what changed.
