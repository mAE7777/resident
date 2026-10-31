# Layers: telling emergence from a rule in disguise

Saying that a behavior "emerges" is easy, and checking it is hard. This document turns "which layer
is this mechanism at" into a question a test can answer, so the answer does not rest on the
author's judgment. Every other guard in the codebase can fail. Before this file, "is this emergence
or a rule I wrote" could not.

## Definition

Take any surface quantity S, something visible about her: that she feels baffled right now, how
deeply she remembers him, how many beats a reply has.

| Layer | Definition |
|---|---|
| Layer 1 | A function computes S directly from readings. A person wrote the shape "when X, then Y". The weights can be tuned, and the shape is fixed. |
| Layer 2 | The inputs to S are several quantities that can disagree, and S is the outcome of that disagreement, not a rule. |
| Layer 3 | The layer 2 condition holds twice: the inputs are themselves outcomes of a disagreement. |

Layer 1 is not a defect. Whatever decides the medium should be layer 1: a moment lasts at most ten
minutes, two moments are at least four minutes apart, the log keeps 20,000 entries. Those are facts
about the machine, not claims about her. The defect is pretending. A mechanism that decides her
content, stays at layer 1, and is described as emergent is a rule dressed as a function.

## Where the model belongs

> A model call may produce an observation that feeds the lowest layer. It must never directly
> produce a surface value that behavior reads.

This rule explains two existing choices. `attention.ts` reads his words through a bigram index,
which is right because it produces an observation: how much this sentence overlaps with what she
already holds. Asking a model what mood he is in is wrong, and cost is not the reason. It is wrong
because the call would produce the surface value directly, so one model call would decide the
outcome.

## Five criteria

Depth alone proves nothing, because a few idle intermediate variables also look deep. A layer
counts only when all five criteria hold.

1. **The parts move independently.** Compute the pairwise correlations of the components over a
   simulated life. A pair with |r| above the threshold is one quantity with two names.
2. **The parts can disagree.** Some reachable input history must make two components point in
   opposite directions, with S as the outcome of that disagreement. If no such history exists, the
   composition is addition in one direction, and the mechanism is still one layer.
3. **No dictator.** Sweep each component alone across its reachable range, using the mechanism in
   `test/unit/life/nothing-is-out-of-reach.test.ts`. No single component may push S across most
   of its range by itself. A dictator means the other components are decoration.
4. **More than one reader.** Each component has at least two readers, and at least one of them is
   not S. A quantity that serves only S was invented to look deep.
5. **Not enumerable.** No lookup table or if-chain from situation to surface value feeds S. A
   source scan checks this.

Each threshold is measured before it is set, because a threshold never compared with the reachable
range of its input is a known class of defect. Each criterion must also be able to fail on a
deliberately fake deep mechanism. A criterion that is green and cannot turn red is worse than none.

## The behavioral counterpart: if-then profile stability

The five criteria check structure, and correct structure does not guarantee correct behavior.
Behavior has a published yardstick.

Personality is not consistency across situations. It is a stable shape of variation across
situations (Mischel and Shoda, 1995): if A, she does X, and if B, she does Y. The method
standardizes behavior within each situation, which removes the main effect of the situation, then
computes the profile over two non-overlapping stretches of time and correlates the two.

Measured anchors come from Shoda, Mischel, and Wright (1994), at the Wediko summer camp, with about
167 hours of observation per child: verbal aggression .47, compliance .41, whining .28, and
prosocial behavior .19.

Shoda's simulation used 100 virtual individuals, each a 20-node network with no unit that stands for
a personality trait. The mean profile stability was 0.66, and 90 of the 100 were above 0.20. Stable
individual differences emerged from a network that has no personality variable, which is what this
project sets out to build.

So the target is: her if-then profile stability > 0.2, and no single input can predict the shape of
her profile. A layer 1 rule also produces a profile, but the rule predicts that profile completely,
which is criterion 3 seen in behavior. `src/life/if-then-profile.ts` implements the measure. It
cannot run until she has lived two non-overlapping stretches, because correlating a seeded past
with itself would report a number about whoever seeded it.

## Audit

Each mechanism gets a layer, the evidence, and the action taken. The numbers come from the measured
output of `test/unit/life/layers.test.ts`: 216 readings over two ways of saying something, four
depths of relationship, three levels of spare capacity, and three degrees of being moved.

| Mechanism | Layer | Evidence | Action |
|---|---|---|---|
| `how-it-landed.ts`, what arises in her right now | 2, passes all five criteria | The highest pairwise correlation among its four components is 0.82, and the rest are near 0. A reachable history makes them point in opposite directions. The largest share of the surface value any single input controls is 62%, against a limit of 70% (a pure single-input mechanism measures 75%). Each component appears four or more times in the composition and is also read by `index.ts` and `willingness.ts`. There is no switch, and there are fewer than four if branches. | Keep |
| `how-he-said-it.ts`, how he said it | 1, and it should be | It produces an observation, not a surface value: six detectable features and no politeness score. The model-call rule requires the lowest layer to be observation. | Keep, and no scoring field may appear in it |
| `relationship.ts`, the relationship line | 3 | Its output, how long and how well she has known him, has two layers: the specific occasions (edges in her field that connect to him) and an abstract impression (a form baseline). Which of the two dominates changes with experience, so the way the output is composed changes too. | Keep |
| `behavioral_patterns` and `createBehavioralMemory` | 0, a static profile of him | It stored his communication, schedule, preferences, workflow, and interests with confidence and evidence, which conflicts with the decision to keep no user profile. | Removed from `index.ts`. `relationship.ts` replaced it and holds no description of him |
| `other-read.readOther` | 1 | One layer of arithmetic over the event log. It now covers only rhythm, and the newer modules cover form and relationship. | Keep, with a narrower job |
| `turn-appraisal.appraiseExchange` | 1, and it appraises telemetry | It reads `finishReason` and `iterations` after the turn ends. | Kept as a reading of how well the turn generated, which is what it measures. How his words land on her is `how-it-landed.ts` |
| `emotion.ts`, appraisal to PAD | 1, and three dimensions cannot separate anger from confusion | Smith and Ellsworth: anger and sadness are almost equally unpleasant (0.85 and 0.87) and differ in agency and situational control, which PAD does not have. | Kept as a projection. Behavior reads the `Landing` vector, never PAD or an emotion name alone |
| `temperament`, daily drift | 1, promoted | It is now an evidence-weighted vector of weights inside `how-it-landed.ts`. Kuppens: no component is necessary or sufficient, and the weights differ stably between people. | Keep. Pushing temperament alone to either extreme moves indignation by less than 0.4 and leaves both ends above zero, so it is not a switch |
| `utterance-shape.shapeFor` | 1, now 2 | It was a state score turned into a temperature and sampled, which is one layer. Now the beat count, whether to close, and whether to add something of her own each read one term of the landing reading, which is a layer 2 output. | Changed |
| `takes-it-on.ts`, whether she takes it on as work | 2 | The surface value is whether this turn counts as work. Two inputs can disagree: the shape of his message (`classifyTaskProfile`) proposes, and what lands on her decides. It replaced a layer 1 function of his text. It samples instead of using a threshold, so the same state can go either way. | Keep |
| `what-stays.ts`, what stays with her | 2 | Whether to write is decided by `settles`, a layer 2 output. What to write is decided by what happened, not by a judgment of him. Each of the four rumination constraints is testable, and all ten spiral detectors can fail. | Keep |
| `landing-to-mood.ts`, his words reaching her mood | 1, and it should be | It projects five layer 2 feelings onto the three PAD dimensions. By this document's rule, a projection should be layer 1. Behavior reads the `Landing` vector. | Keep |
| `relationship.hisUsualRegard`, how he usually treats her | 3 | It feeds `standing`, one term of a layer 2 output, and is itself the lifetime mean of every occasion's form reading. Here familiarity and treatment are separate for the first time. Before this, someone who only gave her orders gained standing just by giving many. | Keep |
| `willingness.reluctanceOf` | 2, rewritten | A noisy-OR over three families, each with a cap. The constants were solved over 16,200 reachable states instead of tuned. For criterion 2: her body says "leave it", her strength says "I can say it", the two point in opposite directions, and the surface value is the outcome. | Changed |

The narrowest margin widened, and nobody tuned it. The correlation of `entitlement` and
`comprehensibility` was 0.82 against the criterion 1 limit of 0.9, because both depended only on how
well she knows him: they shared a parent. Giving `standing` a second parent, `hisUsualRegard`, brought
the correlation down to 0.63. That change was made to fix a different failure, someone who only
gives her orders building up standing by giving many, and not to move this number. When two
quantities sit too close, a layer is often missing underneath them, and adding that layer brings the
correlation down by itself. Stacking intermediate variables does not.

## How to use this document

- Before writing a new mechanism, ask which layer it stops at. If it stops at layer 1 and decides
  content, it is a rule written as a function.
- After writing it, run `test/unit/life/layers.test.ts`.
- Never write "basically layer 2" here. Give evidence that meets the five criteria, write "layer 1,
  because it decides the medium", or change the mechanism.

## Model-call census

This section classifies every direct model call in the codebase by the rule above.
`test/unit/life/layers.test.ts` pins the number of `.complete(` call sites, so a new call fails the
test until it is classified here.

| Class | Meaning |
|---|---|
| Observation | Produces a reading or material for a lower layer, and something else decides her behavior. Allowed. |
| Her words | Produces the sentence she says. This is the only legitimate surface value, for the reason below. |
| Not her | Machinery outside her that does not face her and does not structure her. |

### Her layer (`src/life/`)

| Location | Produces | Class |
|---|---|---|
| `agency-handlers.ts` | What she says or writes while doing something | Her words. It passes through `withHerVoice`, with a budget from her capacity |
| `agency.ts` | Free text for what she intends to do this moment | Her words. It renders a drive and subject that `driveForAction` and `softPick` already chose, so the choice is made before the model runs |
| `autobiography.ts` | Her diary for the day | Her words |
| `autobiography-lint.ts` | A reading of whether the diary sounds mechanical | Observation. It only feeds vitals |
| `noticing.ts` | Candidate patterns in her week that she did not notice herself | Observation. Candidates go to a review queue and do not change her directly |
| `fusion.ts` | A candidate new node fused from two others | Observation. The candidate still has to survive in her field |
| `shadow-voice.ts` | A shadow that speaks the same turn into nothing | Not her. An instrument off the critical path that does not count toward her tiredness |
| `in-beats.ts` (`say`) | The text of one beat | Her words. Her state decides the beat count, whether to close, and whether to add her own before the model runs |
| `agency-handlers.ts` (`thinkWithHerHand`) | Her notes while tending, holding one tool that can edit only her own `SOUL.md`. Behind the `OWN_SOUL_HAND` switch, which is off | Her words, the same class as thinking |

### `src/index.ts`

| Site | Produces | Class |
|---|---|---|
| Dream rendering | Her dream text at night | Her words. Arithmetic in `dreaming.ts` decides first whether she dreams, how many episodes, when, from which fragments, and whether she remembers in the morning. The model only tells her own fragments as a dream. The result goes to her diary, her morning material, and her field marked as dreamt, and the judgment layer refuses it as evidence |
| Promise scan | Candidate promises in messages she sent | Observation. A candidate enters her field only if its quote is an exact substring of the message |
| Re-reading an old day | A retelling after she re-reads a frozen diary page | Her words. Which page and when are decided first. The retelling passes a citation gate and enters her field only as hindsight, never disputing the original memory |
| Diary self-check | A reading of whether the diary reads like that day | Observation, run only on the newest day |
| Cluster naming | A name for a cluster of nodes | Observation. Arithmetic forms the cluster, and the model only names it. If naming fails, the cluster still exists |
| Later beats | The text of her second and later beats | Her words. The beat count and closing are decided first |
| Exploration | The chain she follows when curiosity leads her to look at something | Her words. `chooseSubject` samples the subject |
| The eye (`src/providers/vision.ts`) | A text description of a camera frame, a photo he sends, or a drawing she made | Observation for the material layer. The description says what is visible and never judges it. Frames are not kept |
| The ear (`src/providers/hearing.ts`) | A transcript of audio he sends | Observation for the material layer. Audio is not kept |

### Her replies

Her replies are the deepest single model call in the project, and the call cannot be removed: a
language model has to render what she says, or she has no mouth. The legitimate move is to take
authorship back from the model. Before the call, her state already decides:

- how many beats, whether to change direction midway, whether to close, and whether to add a line
  of her own after answering (`utterance-shape.ts`, which also reads the landing reading)
- what is too costly to say, which is removed before the model sees it
- what comes to mind, through sampled competition between subjects
- the sampling temperature, from her commitment and arousal
- depth, iterations, and whether the turn counts as work (`takes-it-on.ts`)
- her own words (`reachFor`), placed in context as material
- after generation, a cut that removes service phrases that are provably not hers

The honest limit: inside that one generation, the choice of words is still the model's. It is the
only member of the "her words" class, and the class stays legitimate only while the list above
keeps growing.

### Not her

`agent/loop.ts` continues a turn. `life/turn-guard.ts` produces a short rescue line in her register
when a turn is stuck. `providers/chain.ts` falls back between providers. `providers/pulse.ts` wraps
requests and replies without changing them and counts the calls in flight, so the ten-minute moment
deadline can tell a silent provider from a stuck moment.

An earlier version of the codebase had 14 machine-side calls, including skill extraction, a memory
ghostwriter, a heartbeat, summarization, verification, and failure diagnosis. They were removed with
their files. Most did not produce values she reads. They went because the machinery they served did
not belong inside her.

### Conclusion

Nothing needs action. The only surface value a model produces is her reply, and that value is what
she says, not an intermediate verdict that her behavior reads. None of the real verdicts passes
through a model: whether she wants to, whether she takes it on, whether it stays, how many beats,
and which way her mood moves.
