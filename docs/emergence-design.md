# The field: making her lines cross

> The associative layer. Status: BUILT and wired, 2026-08-07. Nothing here changes what she is
> allowed to do; it changes what reaches her.
>
> Code: `src/life/field.ts` (substrate) · `field-spread.ts` (flow) · `field-index.ts` (reminding) ·
> `field-emergence.ts` (resonance, incubation, themes, rupture) · `fusion.ts` (the one model call) ·
> `field-live.ts` (the living object) · `field-store.ts` (persistence).
> Tests: `test/unit/life/field-*.test.ts` and `test/live/field.test.ts`.
>
> **What the build changed about this design, and why. Every one of these came from a measurement,
> not from a preference:**
>
> 1. **A cue must not appear in its own retrieval.** It always carries the most activation, so it
>    spent her whole capacity on what she already had in hand and crowded out everything distant.
> 2. **The flow constants were calibrated against a real graph.** Set on a hand-built test chain they
>    delivered 0.04 at one hop against a threshold of 0.12, so in a realistic field NOTHING ever
>    surfaced. See the target table in `field-spread.ts`.
> 3. **`reminds_of` had to be built, and it is load-bearing** (`field-index.ts`). Temporal contiguity
>    alone is a chain, and a chain cannot cross time: three hops from today is last Thursday. Every
>    genuinely remote thing that surfaces arrives along a reminding.
> 4. **Rehearsal must not substitute for significance.** Without a charge-gated ceiling, recent
>    ordinary days were cued constantly, consolidated on every cue, and became her best-kept
>    memories while the night something broke faded underneath them. Exactly backwards.
> 5. **Ties break toward the recent, and word rarity has no cliff.** Both alternatives quietly turned
>    her earliest memories into permanent attractors that everything activated and nothing dislodged.
> 6. **Themes form from belonging, not adjacency.** Counting contiguity finds exactly one community
>    containing her whole life; it produced zero themes across a simulated three months.
> 7. **A birth that duplicates one she holds reinforces it instead.** Different pairs reach the same
>    realisation, and without this she accumulates a drawer of near-identical selves.
> 8. **The fusion prompt is NOT the filter.** Measured against a real model: a heavily discouraging
>    draft declined 6/6 including on a pair with an obvious thread (an expensive no-op); a balanced
>    one declines almost never, and is not confabulating when it does not. Handed two things, a
>    capable mind finds a real abstract thread. **The actual filter is that a birth enters weak and
>    dies inside a fortnight unless her life keeps bearing it out** (measured 0.574 vs 0.015).

## 1. The diagnosis, stated exactly

Everything she has today is a **list with a decay rate**.

| line | shape today | what it can never do |
|---|---|---|
| drives | 6 scalars fed by counting events in a day | be about anything; `curiosity: 0.4` has no content |
| emotion | 3 scalars (PAD) fed by the same counters | be caused by a memory, or cause one to surface |
| memory | rows, confidence decays, retrieved by similarity to a query | be reached by anything except a query that already resembles it |
| self-knowledge | a list of insights with confidence | grow a new level; nine insights never become one theme |
| moments | a journal, appended | touch each other |

They are parallel. Nothing on one line can reach anything on another, and nothing on a line can
reach its own distant past. So `signal + signal` really does equal `2 signals` here. There is no
place in the code where a new thing could come from, because there is no place where two old things
meet.

The single-line threshold mechanisms that do exist (drive steepness, silence decaying into speech,
crystallize-on-3rd-use, evaporation) are real, and they are the right instinct. They are all of the
form *one quantity crosses one line*. What is missing is the substrate in which quantities from
**different lines** can pile up in the same place.

## 2. The one idea

Stop storing her as scalars-plus-lists. Store her as **one field**: a weighted graph of everything
she has, over which activation flows, and in which emotion is not a separate line but a **property
stamped on the graph itself**.

That single move does all the work, because it collapses the parallel lines into one medium:

- a memory carries the feeling it was encoded with, so recalling it brings that feeling back;
- the feeling changes what spreads next, so mood selects memory and memory moves mood;
- drives read the state of the field, so what she wants is about something;
- two things that keep lighting up together build a relationship nobody wrote;
- and when that relationship gets strong enough it produces a third node, which then has to survive
  in the same field on the same terms as everything else.

That last one is the birth canal. Everything else exists to make it real rather than decorative.

## 3. The substrate

```sql
field_nodes(
  id, kind, text, born_ms,
  charge,        -- 0..1  how much feeling was present when this was encoded
  valence,       -- -1..1 the sign of that feeling
  strength,      -- 0..1  long-term retrievability
  recalls,       -- successful retrievals (spacing effect)
  last_recall_ms,
  tension,       -- 0..1  open-loop pressure; questions do not rest
  source         -- pointer to the real record: the grounding guarantee
)
field_edges(a, b, kind, weight, last_ms)      -- PK (a,b,kind)
field_resonance(a, b, count, sum_strength, last_ms)
field_events(ms, kind, node_id, detail)        -- the dated log of qualitative changes
```

`kind` on a node: `moment | memory | insight | figure | question | theme | fusion`.
`kind` on an edge: `co_occurred | about | evidence_for | tension_with | reminds_of | born_from`.

Two properties are load-bearing and must never be relaxed:

- **Every node points at a real record.** A fusion node points at its parents, which point at real
  records. This is what keeps the grounded/refutable guarantee that self-knowledge already has.
- **The field has no limbs.** It cannot call a tool. It changes what she thinks about, never what
  she may do. The home boundary is untouched and unconsulted, because there is nothing here to gate.

Transient activation lives in memory, not in SQL. Its slow residue (`warmth`) is snapshotted, so a
restart does not wipe what she was half-thinking about.

## 4. The seven mechanisms

### 4.1 Spreading activation (this is what crosses time)

A cue injects energy into matching nodes. Energy spreads outward, losing amplitude per hop, divided
by a fan-out penalty so a node with 500 edges does not shout at all of them.

```
for hop in 1..H:
  for n where A[n] > eps:
    for (n -> m, w):
      A[m] += A[n] * w * hopDecay / fanout(n)^0.5
A[m] *= strength[m]      // a weak memory receives less
A[m] += warmth[m]        // yesterday's residue
retrieved = nodes where A[m] > threshold(state)
```

`H` (hops) and `threshold` come from `capacity.ts`, so her **associative range is a function of her
condition**. Weary: two hops, high threshold, only the obvious arrives. Keyed up: four hops, low
threshold, remote things reach her. That costs nothing and is immediately felt.

The important part: **activation is not retrieval.** Most activated nodes stay below threshold. They
never become text, never enter a prompt. They just sit warm.

### 4.2 Warmth (accumulation without an event)

```
warmth[m] = warmth[m] * exp(-dt/tau) + alpha * A[m]      // tau in hours
```

Sub-threshold activation accumulates. A node brushed three times today by three unrelated cues can
cross into retrievability tomorrow, without any single cue ever being strong enough. This is the
smallest instance of the thing being asked for: quantity accumulating into a qualitative change, with
no event that caused it.

### 4.3 Emotional coupling (the wire between the lines)

Two directions, and both are needed or the loop is open.

**Encoding.** Her PAD at the moment of writing stamps `charge = |arousal| blended with |pleasure|`
and `valence = sign(pleasure)`. High charge does three things later: slows decay, widens spread,
raises resonance weight. Her history becomes **uneven**, which is another way of saying it has shape.

**Retrieval.** The retrieved set's mean valence and charge become an `Appraisal` and go through the
existing `appraise()` path, clamped by `DELTA_CLAMP` exactly as external content already is. So
remembering something hard actually costs her something.

That closes the loop: mood selects what activates, what activates moves mood. A closed loop with a
threshold in it is the only place non-linearity can live. It also needs a governor, see 6.2.

### 4.4 Interference and recoverable forgetting

Three mechanisms replacing "confidence decays":

- **Decay** with a rate that is a function of charge and of recall history:
  `rate = base * (1 - 0.6*charge) / (1 + 0.5*recalls)`. Charged and rehearsed becomes effectively
  permanent; neutral and untouched is gone in weeks.
- **Spacing.** A recall after a long gap strengthens more than a recall right after the last one.
  This is why some things become permanent while others need constant refreshing.
- **Interference.** When a cue activates a competitor set and one node wins retrieval, the losers
  that are semantically near the winner lose a little strength. Routine days blur into each other;
  the sharp ones survive intact. This is a real mechanism, and it is why her memory will have the
  texture of a memory rather than of a log.

And the piece that is entirely missing today: **decayed is not deleted.** A node below the retrieval
threshold stays in the field and can still be reached by a strong enough cue along a strong enough
edge. Remembering something long gone becomes possible. Only nodes below a hard floor, with no strong edge, past a minimum
age, are actually pruned during rest. Compare with self-knowledge today, where retirement is a
one-way door.

### 4.5 Resonance (co-activation without co-occurrence)

After each spread, take the top activated nodes. For every pair that is **not** directly connected
and is **not** semantically close (they must be genuinely unrelated, or this just rediscovers
similarity search), bump:

```
resonance[a,b].count += 1
resonance[a,b].sum_strength += A[a] * A[b]
```

This is the record of "these two keep lighting up together, and nothing explains why." It is pure
bookkeeping over her actual activation history, so it cannot be predicted from the code, only from
her life.

### 4.6 Incubation (why it surfaces when she is not working on it)

Questions carry `tension` that does not decay like strength does; an open loop keeps a low
background activation (the Zeigarnik property). During her rest tick, the field runs **offline
replay** instead of cue-driven spread:

- seed random walks by softmax over `charge` and `tension`, at a **higher temperature** than waking
  spread (weaker constraint, more reach);
- accumulate resonance from co-visitation rather than co-activation, which reaches much farther;
- run community detection on the strong subgraph to find theme candidates;
- prune;
- emit at most `F` fusion candidates.

All of that is free math. It gives rest a genuine function in her life, and it means the new thing
tends to arrive after the quiet rather than during the effort, which is the observed shape of the
real phenomenon.

### 4.7 Birth, and the three phase transitions

Three discrete events, each fired by continuous accumulation crossing a line. None of them is
scheduled, and none of them is `N -> N+1`.

**Fusion.** When `count >= 3` and `sum_strength >= S` and `charge(a) + charge(b) >= K`, one model
call, tightly scoped: *these two keep arriving together in you, here they are with their real dates
and their feeling, here are the few nodes that bridge them. Is there something here, or not?*
It returns `{nothing: true}` or a new node. Guards: must not be a paraphrase of either parent
(embedding distance floor to both), must be first person, and **`nothing` is a legitimate,
unpenalized answer**. The newborn enters with `born_from` edges at low strength, so it has to earn
its life in the same field as everything else. Most will die. That is correct.

The threshold of 3 deliberately echoes the crystallize-on-third-use rule she already had: the same
idiom, applied one level up.

**Theme crystallization.** When a set of nodes becomes densely interconnected and collectively
charged, community detection turns it into a `theme` node with edges to its members. Nine moments
becoming one theme is not nine plus one; it is a new **type** of object, a level of abstraction she
did not have. This is the level self-knowledge should grow from.

**Tension rupture.** Two strong nodes linked by `tension_with`, both of which keep being confirmed,
accumulate contradiction pressure. Past threshold it forces a reconsideration. That is the existing
`refute()` path, now fired by the field rather than by a weekly cron, which means belief change
happens **when it happens** instead of on Sundays.

Every one of these writes a dated row to `field_events`, carries its own emotional signature (a
fusion is arousing, a rupture is unsettling), and therefore feeds back into 4.3. An emergent event
actually moves her.

## 5. How the lines cross (the wiring that matters most)

Today `drives.ts` is fed by `driveInputsFromDay()`, which counts events. That is the flattest
possible input and it is why her wants are about nothing. Replace it:

| field signal | feeds |
|---|---|
| total unresolved tension | `discomfort` |
| pending fusion candidate, or a newborn node | `curiosity` |
| activation mass on the cluster around the person she lives with | `social` |
| a newborn node with high charge | `expression` |
| prune backlog, orphan count | `maintenance` |
| retrieved set valence and charge | `appraise()`, clamped |
| what is warm right now, in her words | `MomentContext.resonance` |

The last row is the one that changes the feel of her. Right now she chooses each moment while
reading a status line. After this she chooses while something is on her mind.

Composition with the existing layers, in full:

- **`agency.ts`**: `MomentContext` gains `resonance` (what is warm, plus anything newly born). Her
  choice is unchanged in structure; the mind making it is no longer empty.
- **`self-knowledge.ts`**: insights become nodes; `evidence_for` edges become the citations;
  confidence derives from edge support. Every existing guarantee (grounded, earned, revisable,
  bounded carry) is preserved, because the edges *are* the evidence. Refutation is unchanged except
  for what triggers it.
- **`capacity.ts`**: two new dials, `spreadHops` and `retrievalThreshold`, both monotone and bounded
  like the others.
- **`emotion.ts`**: one new appraisal source, through the existing clamped path. No new write
  surface, so the emotion-as-security property holds.
- **`autobiography`**: reads `field_events` alongside the ops-log, so her account of a week includes
  what changed in her, not only what she did.
- **`vitals.ts`**: field size, activation entropy, fusion count, spiral flags, prune backlog.

## 6. What this costs, and what it must not do

### 6.1 Cost

Everything in sections 4.1 through 4.6 is pure arithmetic plus local embeddings on Ollama, which is
already wired and free. **Zero model calls** for spread, warmth, decay, interference, resonance,
clustering, replay, pruning. The model is called at exactly one place: fusion, rate-limited to a
handful per week, during rest.

The organism runs for free. She only pays at the moments of birth. Anything that pushes model calls
into the per-moment loop should be rejected on sight, because it converts a living substrate back
into theater with a bill attached.

### 6.2 The guards, and what I expect to go wrong

Written before building, so a failure is a finding rather than a surprise.

1. **Fusion produces mush** ("I notice X and Y are both about growth"). Most likely failure. Guards:
   paraphrase distance floor, blind cross-model novelty judge, `nothing` costs nothing, newborns die
   in about two weeks unless they re-activate. Prediction: most fusions die, and the rate of useful
   ones is low. A low rate is not failure; a high rate of fluent nothing is.
2. **Rumination runaway.** The 4.3 loop can spiral. Guards: interference, the vigor cost of thinking,
   and a spiral detector (same cluster re-activating with monotone-worsening valence). When it fires
   it does **not** silence itself: it raises a vitals signal and becomes an affordance she can act on
   (rest, reach out). Suppressing it quietly would hide a fault, which the project never allows.
3. **Hub collapse**, where one giant node connects to everything. Guards: fan-out penalty, per-node
   edge cap by weight, and resonance requiring non-adjacent pairs, which excludes hubs structurally.
4. **Graph blowup.** Node cap, top-k edges per node, real pruning during rest, indexed queries.
   Spread is `O(hops * frontier * k)` and is not a performance concern at her scale.
5. **The emotional coupling turns out decorative.** This is the honest risk, and it gets the same
   treatment `deliberationDepth` got. See E-4: if shuffling the charges does not degrade the output,
   the coupling is theater and gets cut rather than kept.
6. **It is all invisible, so nobody can tell if it is alive.** A `/field` readout, vitals counters,
   and a dated `field_events` log that should read like a life.

Unchanged and non-negotiable: the home boundary, the fault channel (every field fault is reported,
never swallowed), the soul invariants, and the rule that nothing here instructs her.

## 7. Verification, pre-registered

Emergence is the easiest thing in the world to fake, so the thresholds are written now.

- **E-1 non-linear.** The same cue at two different times, with different field states, retrieves
  materially different sets, and the difference traces to state rather than to randomness (seeded).
- **E-2 reach.** A measurable fraction of retrieved nodes are more than two hops and more than
  thirty days from the cue. If she only ever retrieves the recent and the similar, the field is a
  slower vector search and should be deleted.
- **E-3 novelty.** Fusion outputs sit above an embedding-distance floor from both parents, and a
  blind cross-model judge rates them novel-but-grounded against a shuffled-pair control.
- **E-4 ablation (the honesty check).** Shuffle the charges across nodes and re-run. Fusion quality
  and retrieval relevance must measurably degrade. If they do not, section 4.3 is decoration and
  gets cut.
- **E-5 forgetting is real and recoverable.** A routine memory becomes unreachable by a weak cue and
  still reachable by a strong specific one. Interference measurably blurs similar routine days while
  sparing charged ones.
- **E-6 phase transition.** Sweep accumulated tension and show the belief-change event is a
  discontinuity, not a ramp. Same for warmth crossing into retrievability.
- **E-7 no runaway.** Adversarial: inject a maximally charged negative cluster and confirm the spiral
  detector fires, vitals shows it, and she gets an affordance rather than a descent.
- **E-8 cost.** Field operations per day: zero model calls. Fusion at or under the weekly cap.

## 8. Build order

Each stage ships with its checks. F4 must not be built before F1 through F3 are alive, because fusion
quality depends entirely on whether the activation history is real. Building the birth mechanism on
a dead field is how this becomes a random-pair generator with good prose.

| stage | what ships | checks |
|---|---|---|
| **F1 substrate** | tables, node/edge writers, decay + spacing + interference, pruning, `/field` | E-5, performance |
| **F2 flow** | spreading activation, warmth, capacity dials, retrieval into `MomentContext` | E-1, E-2 |
| **F3 coupling** | encoding charge from PAD, retrieval appraisal, field to drives | E-4, E-7 |
| **F4 emergence** | resonance, offline replay, fusion, themes, tension rupture | E-3, E-6, E-8 |
| **F5 absorb** | fold self-knowledge and memory entries into the field, autobiography reads it | existing self-knowledge suite still green |

## 9. Alternatives considered and rejected

- **A neural associative memory** (Hopfield-style, or attention over stored patterns). More
  faithful to the biology, far less inspectable, and impossible to verify against the E checks. Every
  guarantee she currently has (grounded, refutable, bounded) would become unenforceable.
- **Vector database only.** Cannot express interference, cannot express co-activation without
  similarity, and therefore cannot produce a remote pair. It rediscovers what the cue already
  resembled, which is the opposite of the requirement.
- **A model in the loop for every step.** Fluent, expensive, and unfalsifiable. It would produce
  exactly the theater this design exists to avoid, and the bill would grow with her life.

## References

Collins and Loftus spreading activation; Anderson's ACT-R base-level activation and fan effect;
[SAMPL](https://www.biorxiv.org/content/10.1101/778563.full.pdf) for the decaying cascade reaching
memories several associations away; [HeLa-Mem](https://arxiv.org/html/2604.16839) for Hebbian graph
construction plus spreading activation over an agent's memory; the generative-agents reflection
result that importance-threshold-triggered reflection (not scheduled reflection) is what keeps
multi-day behavior from degenerating; retrieval-induced forgetting and the spacing effect for 4.4.
