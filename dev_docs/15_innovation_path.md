# Innovation Path

## v1 - 2026-09-11 22:40:00 - re-read the evidence, decide what to own, and decide what not to build

### 1. What the research settles, and what it leaves open

**Settled, treat as fact:**
1. Raw long context is not a reliable consistency substrate. Performance is
   non-monotone in length, position-dependent, and effective context is roughly half
   of what models claim. Reading the full history offline scores far higher than the
   same model deployed with that history available.
2. Persona and character fidelity degrade over long sessions, and **compaction does not
   reset the drift**. Summarising history harder cannot be the fix for drift.
3. Every roleplay front-end surveyed implements conditional text injection plus one
   rolling lossy summary plus optional embedding retrieval. **None maintains a mutable,
   contradiction-checked world state.** All are lossy by construction, and their own
   documentation says so.
4. In long narrative, consistency failures concentrate in the **factual and temporal**
   dimensions and peak mid-narrative.

**Open - and this is the part that matters:**
1. **No benchmark measures whether a memory architecture causes continuity failures.**
   Roleplay benchmarks score single-response character quality. QA benchmarks score
   fact lookup. Neither attributes an error to the memory design.
2. **Forgotten commitments and promises are not measured anywhere.**
3. **Contradiction and supersession correctness is unmeasured.** Systems implement
   conflict handling; nobody reports precision or recall on it.
4. **Determinism, run-to-run variance and cost per turn are unmeasured** across the
   field. The benchmarks are accuracy-only.

### 2. The reframe

Every system in the literature, including the good ones, shares one assumption: memory
is **a store that is queried**. Vector stores, fact stores, temporal knowledge graphs,
memory streams - all of them write records and later retrieve records.

The research shows the field is crowded there and blocked, not for lack of structures
but for lack of a **ruling**: nobody can say whether a given memory design is adequate,
because the only measuring device available is a model judge, and model judges are
demonstrably unreliable (rank correlation with human preference is reported negative,
with a majority of pairwise verdicts flipping).

So the blank is not a missing structure. **The blank is the absence of a measuring
device.** More structures built without one is guessing, and the field already has
plenty of guesses.

### 3. The thesis

Two properties of the roleplay problem decide everything:

- The transcript is a **complete, ordered, authoritative log**.
- The consumer is a **frozen model with a fixed token budget**.

Together they mean memory has **no information content relative to the log**. Whatever
a memory block says, the log already says. Memory's only value is being a projection of
the log that is (a) **sound** - nothing in it is false - and (b) **sufficient** - nothing
needed for this turn's decision is missing - at a cost we can pay.

That makes the objective well-posed for the first time:

> Minimise tokens subject to: the projection is sound, and it is sufficient.

and it converts compression from a salience heuristic into a **minimum sufficient
projection** problem. Sufficiency is not a vibe; it is answerability against a finite,
checkable question set derived from the state itself.

### 4. The decision

**Own the ruling, not the structure.** Build the measuring device first, then let it
choose which structures are worth their cost. Concretely:

**Minimum sufficient projection.** Define a finite deterministic question set over the
current world state (what is true now, why, what was promised, who knows). A projection
is sufficient when every question is answerable from it. A block is *necessary* when
removing it makes some question unanswerable. The cost-optimal projection is then the
smallest set of blocks that is still sufficient - a set-cover problem, solved
deterministically, with no model judge anywhere in the loop.

This is the sharpened form of the project's own original insight ("memory should store
differences, not content"): the projection keeps only the blocks that carry **unique
answerability**, and everything else is dropped because it provably changes nothing.

**Two consequences worth naming.** "Cheap" stops being a guess: you pay only for blocks
that carry a question no other block carries. "Stable" becomes structural: soundness is
enforced by supersession and validity intervals, not by hoping the summariser behaved.

**Not building**, and why:
- **A memory graph or vector network.** No evidence connects such structures to
  continuity; the field's graph systems are unmeasured on it; and the project's own
  direction already classifies vectors as an addressing method, not memory. Building one
  would be imitation, not innovation.
- **Bigger context.** Settled against by the measurements in section 1.
- **A brain-like generative memory.** Assumes plasticity a frozen model does not have.
- **Any model judge as the acceptance criterion.** It is the thing that broke the field's
  ability to rule.

### 5. The path

| Stage | What is built | What it must move | How we know it failed |
|---|---|---|---|
| 0 (done) | deterministic change spine, supersession, irreversibility ranking | - | - |
| **1. The ruling** | extend the existing judge-free T-Causal instrument into a **length certificate**: contradiction rate, commitment retention, epistemic leak, causal reachability and tokens, measured at 10/30/60/100 floors on the same chat | produces a curve nobody has published | if the curve is flat, the instrument measures nothing |
| **2. The epistemic channel** | who-knows-what becomes a first-class, code-enforced scope; a character can only be told what they experienced | leak rate to zero; this is the one effect already measured large in the AIRP work | if leak is already zero, the premise is wrong |
| **3. Sufficiency** | per-block ablation against the deterministic question set; keep only uniquely-answerable blocks | tokens fall at constant answerability | if dropping a block never breaks a question, the question set is too weak |
| **4. Structure, chosen by the instrument** | only what stage 1 and 3 say is missing - probably temporal validity, possibly causal edges | closes a named gap in the certificate | if no gap is named, add nothing |

Stage 1 is the decision point. It is cheap, it needs no new architecture, it is built
from parts that already exist (the deterministic spine, the T-Causal case builder, the
live harness), and its output decides whether stages 2 to 4 are needed at all.

### 6. Honest risks

1. **Sufficiency is only checkable over a finite question set.** For free-form character
   behaviour there is no check. The criterion is therefore defined over *checkable*
   questions only, and that is a real restriction, not a technicality: it means the
   instrument can miss failures that no question covers.
2. **Sufficiency may not beat a well-tuned salience score.** This is a hypothesis, not a
   finding. Stage 3 is the test, and a negative result is a real result.
3. **Academic novelty is not guaranteed.** "Structured memory for roleplay" is taken -
   event graphs and character-state trees already exist. What is defensible here is the
   *judge-free instrument* and the *sufficiency criterion*, not structure as such. Claim
   those two, and do not claim to have invented structured memory.
4. **Cost per turn is unmeasured across the entire field, including this project.** Any
   claim of being cheaper is currently unfounded; stage 1 must report tokens for that
   reason, and not as an afterthought.
5. **The result may be that the honest answer is "one good model, minimal memory".**
   Nothing in the research rules that out. The instrument is what would reveal it.
