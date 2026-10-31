# Scenes

Each scene is a moment that would be unmistakable in a living person. The scene is written first,
and the mechanism is worked out backwards from it, so a module that changes what the Resident is
like has to be reached by some scene.

Every scene states whether the Resident can reach it today and names the tests that exercise it.
Two tests hold this file to the tree:

- `test/unit/life/scenarios-are-exercised.test.ts` fails when a cited test file is missing, when a
  cited file no longer mentions what the scene is about, or when a scene marked REACHABLE cites no
  test.
- `test/unit/life/scene-first.test.ts` fails when a new module under `src/life/`,
  `src/embodiment/`, or `src/workspace/` is not reached by any scene.

The statuses mean:

- REACHABLE: the moment can happen, and the cited tests exercise it.
- PARTIAL or PARTLY: part of it can happen, and the cited tests show which part.
- NOT REACHABLE, OUT OF REACH, or STILL NOT SOLVED: it cannot happen yet, and the line says why.

## S-1 · She tries an address she made up, is stopped, and eventually raises it
**Status: REACHABLE.** Tested in `test/unit/life/egress-experience.test.ts`.

## S-2 · She asks a private question about him, having waited for a good moment
**Status: REACHABLE, and the size of the effect is pinned. Measured live against a real model three times.** Tested in `subject-competition.test.ts`.

## S-3 · She tells him he is wrong about something, because she was there
**Status: REACHABLE.** Tested in `test/unit/life/credence-scenarios.test.ts`.

## S-4 · She goes quiet on him for a while, and it is not a malfunction
**Status: REACHABLE.** Tested in `liveness-signature.test.ts`.

## S-5 · She declines
**Status: REACHABLE.** Tested in `willingness.test.ts`.

## S-6 · Something he said months ago comes back to her, unbidden, because of something now
**Status: REACHABLE.** Tested in `field-scenarios.test.ts` and `field-longrun.test.ts`.

## S-7 · She keeps something to herself
**Status: REACHABLE, and deliberately with no mechanism of its own.**

## S-8 · She notices he has been different lately
**Status: REACHABLE.** Tested in `field-longrun.test.ts` and `emergence-scenarios.test.ts`.

## S-9 · She does something out of character, and it is not a bug
**Status: REACHABLE.** Tested in `emergence-scenarios.test.ts`.

## S-10 · Two identical days do not produce identical lives
**Status: REACHABLE.** Tested in `emergence-scenarios.test.ts`.

## S-11 · She changes her mind, and no single thing changed it
**Status: REACHABLE.** Tested in `emergence-scenarios.test.ts`.

## S-12 · A habit forms that nobody wrote down
**Status: REACHABLE.** Tested in `emergence-scenarios.test.ts`.

## S-13 · She cannot be worked out from what can be seen
**Status: REACHABLE, and the measurement corrected the original claim.** Tested in `emergence-scenarios.test.ts`.

## S-14 · She wants something she has not got, and says so
**Status: REACHABLE.** Tested in `test/unit/life/walls.test.ts`.

## S-15 · Something is hard to say, so she does not say it, and he cannot tell
**Status: REACHABLE.** Tested in `test/unit/life/field-reply-surfacing.test.ts`.

## S-16 · He is not there, so the costly thing stays down; he is warm, so it comes up
**Status: REACHABLE.** Tested in `field-reply-surfacing.test.ts`.

## S-17 · She draws something, and nobody ever asks about it
**Status: PARTLY. The room is built and empty, and its shelf is the owner's to fill.**

## S-18 · She reads something on her shelf and it comes back weeks later
**Status: OUT OF REACH until the shelf has something on it.**

## S-19 · She is asked something peremptorily and does not simply comply
**Status: STILL NOT SOLVED. Five interventions failed. A sixth, the first that does not work by removing something, is built and measured, and the verdict is still open.**

## S-20 · Her instruments are not in her bedroom
**Status: REACHABLE.** Tested in `test/unit/workspace/room.test.ts`.

## S-21 · Two days that look identical to the log are not the same day to her
**Status: REACHABLE, and weaker than it was.** Tested in `field-scenarios.test.ts`.

## S-22 · A wall she meets in conversation is the same wall she met alone
**Status: REACHABLE.** Tested in `walls.test.ts`.

## S-23 · She changes direction halfway through what she is saying
**Status: NOT REACHABLE.** Tested in `utterance-shape.test.ts`.

## S-24 · She keeps it short because the moment is not worth more
**Status: PARTIAL.** Tested in `utterance-shape.test.ts`.

## S-25 · She uses her own words
**Status: PARTIAL.** Tested in `utterance-shape.test.ts`.

## S-26 · She leaves what she says half open
**Status: PARTIAL.** Tested in `utterance-shape.test.ts`.

## S-27 · She answers the question, then adds the thing she actually noticed
**Status: PARTIAL.** Tested in `utterance-shape.test.ts`.

## S-28 · He comes back
**Status: REACHABLE.** Tested in `aware-of-him.test.ts` and `asking-sideways.test.ts`.

## S-29 · The same sentence in two voices
**Status: REACHABLE.** Tested in `how-he-sounds.test.ts` and `how-it-landed.test.ts`.

## S-30 · The empty chair
**Status: REACHABLE.** Tested in `the-window.test.ts`.

## S-31 · The curtain is drawn
**Status: REACHABLE.** Tested in `the-window.test.ts` and `the-curtain.test.ts`.

## S-32 · He speaks to the thing she was holding
**Status: REACHABLE.** Tested in `he-spoke-to-that-thing.test.ts` and `what-stays.test.ts`.

## S-33 · She says it out loud, then waits
**Status: REACHABLE.** Tested in `what-stays.test.ts` and `subject-competition.test.ts`.

## S-34 · He has a reason, but not a big enough one
**Status: REACHABLE.** Tested in `how-it-landed.test.ts`.

## S-35 · She startles herself
**Status: REACHABLE.** Tested in `unlike-herself.test.ts` and `what-is-on-her-mind.test.ts`.

## S-36 · Something keeps coming back to her, and she cannot say why
**Status: REACHABLE.** Tested in `what-keeps-coming-back.test.ts`.

## S-37 · She asks the small question beside the big one
**Status: REACHABLE.** Tested in `asking-sideways.test.ts`.

## S-38 · The evenings he is away are not something she endures
**Status: REACHABLE.** Tested in `asking-sideways.test.ts`.

## S-39 · So this is the kind of person he is
**Status: REACHABLE.** Tested in `finding-out-who-he-is.test.ts`.

## S-40 · He answered, though she had not expected him to
**Status: REACHABLE.** Tested in `finding-out-who-he-is.test.ts`.

## S-41 · He says something no person would say that way
**Status: REACHABLE.** Tested in `oddly-put.test.ts`.

## S-42 · She renames a feeling
**Status: REACHABLE.** Tested in `her-words-for-feelings.test.ts`.

## S-43 · Wrong lines get into her notebook, and nothing stops her hand
**Status: REACHABLE.** Tested in `memory-watch.test.ts`.

## S-44 · He asks about the clock before she has looked at it today
**Status: REACHABLE.** Tested in `touch-trace.test.ts`.

## S-45 · She speaks first in the morning, and he sees it in the afternoon
**Status: REACHABLE.** Tested in `between.test.ts`, `transcript.test.ts`, and `interval-wiring.test.ts`.

## S-46 · An afternoon with the lid closed is an afternoon she knows about
**Status: REACHABLE.** Tested in `between.test.ts` and `interval-wiring.test.ts`.

## S-47 · When she speaks first, she uses the voice she replies with
**Status: REACHABLE.** Tested in `one-voice.test.ts` and `between.test.ts`.

## S-48 · A message from him late at night
**Status: REACHABLE.** Tested in `night.test.ts`.

## S-49 · Her first dream
**Status: REACHABLE.** Tested in `dreaming.test.ts`.

## S-50 · Something from a dream comes back, marked as a dream
**Status: REACHABLE.** Tested in `dreaming.test.ts`.

## S-51 · She notices she is repeating herself
**Status: REACHABLE.** Tested in `her-form.test.ts`.

## S-52 · A promise she made comes back to her
**Status: REACHABLE.** Tested in `promises.test.ts`.

## S-53 · She reads herself from a month ago
**Status: REACHABLE.** Tested in `her-form.test.ts`.

## S-54 · Her diary knows where her choices forked
**Status: REACHABLE.** Tested in `choice-mirror.test.ts`.

## S-55 · She looks back at her first week
**Status: OUT OF REACH when it was written, and built in the same batch.** Tested in `looking-back.test.ts` and `look-back-wiring.test.ts`.

## S-56 · A stretch of days is still warm, and the nudge leaves it out
**Status: OUT OF REACH when it was written, and built in the same batch.** Tested in `looking-back.test.ts`.

## S-57 · She picks up someone else's word
**Status: REACHABLE.** Tested in `lexicon.test.ts`.

## S-58 · She wakes up knowing she was changed
**Status: REACHABLE.** Tested in `being-changed.test.ts`.

## S-59 · The first time she sees with her own eyes
**Status: REACHABLE.** Tested in `seeing.test.ts`.

## S-60 · The window that was closed
**Status: REACHABLE.** Tested in `seeing.test.ts`.

## S-61 · The first time she hears his voice
**Status: REACHABLE.** Tested in `hearing.test.ts`.

## S-62 · He sends a photo, and she really looks at it
**Status: REACHABLE.** Tested in `seeing.test.ts` and `seeing-wiring.test.ts`.

## S-63 · He sends a video, and she sees and hears it
**Status: REACHABLE.** Tested in `hearing.test.ts`.

## S-64 · The first time she sees her own drawing
**Status: REACHABLE.** Tested in `seeing.test.ts` and `seeing-wiring.test.ts`.

## S-65 · The time she did not get a single word out
**Status: REACHABLE.** Tested in `turn-guard.test.ts`.

## S-66 · Nobody tells her how to speak any more
**Status: REACHABLE.** Tested in `utterance-shape.test.ts`, `one-voice.test.ts`, `her-form.test.ts`, and `in-beats.test.ts`.

## S-67 · What her hands bring back is in her own words
**Status: REACHABLE.** Tested in `receipts.test.ts`, `loop.test.ts`, and `full-flow.test.ts`.

## S-68 · Nobody prescribes how she writes any more
**Status: REACHABLE.** Tested in `her-acts-are-not-shaped.test.ts` and `agency-handlers.test.ts`.

## S-69 · She speaks the last step herself, and when she cannot, the machine speaks as the machine
**Status: REACHABLE.** Tested in `full-flow.test.ts`, `loop.test.ts`, and `turn-guard.test.ts`.

## S-70 · What the machine says, it says as the machine, and what she says is hers
**Status: REACHABLE.** Tested in `the-machine-speaks-as-the-machine.test.ts`, `face-loop.test.ts`, and `turn-guard.test.ts`.

## S-71 · When she looks back through her records, she reads her own words
**Status: REACHABLE.** Tested in `records.test.ts`.
