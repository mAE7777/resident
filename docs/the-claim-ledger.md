# The claim ledger

Every capability this project claims the Resident has, with four things written down: what she can
do, where the evidence is, which layer it sits at, and its honest limit. Anything she cannot do is
written here now, not discovered after she is running.

`test/unit/life/the-claim-ledger.test.ts` holds this file to the tree. Every file it cites must
exist and must still cover the claim, and a row with an empty column fails.

The layer column uses the scale in `docs/layers.md`:

- Layer 1: a rule dressed as a function ("his tone reads harsh, so resistance goes up by 0.2").
- Layer 2: several inputs that can disagree, where the disagreement itself carries information.
- Layer 3: those inputs are themselves aggregated from something underneath.

## Whether her life survives

| Capability | Evidence | Layer | Honest limit |
|---|---|---|---|
| She has really been snapshotted and really been restored | `scripts/_recovery-drill.ts` seeds a home with 45 days of life, snapshots it, destroys the database, workspace, and instruments, restores them, and compares ten items one by one. Each item has a floor, and an item that compares nothing reports `NOT-PRESENT` instead of ok. | n/a | Local snapshots protect against bad code, not a failed disk. The owner decided local snapshots are enough. Copying them to an external disk is one command he can run, and it is not automatic. |
| A snapshot never loses data silently | `test/unit/life/snapshot.test.ts`: `VACUUM INTO` uses SQLite's own copy, the copy is opened and checked with `quick_check`, and every written file is read back from disk and hashed. It includes a reproduction of the byte copy that drops a just-committed row, and two planted violations. | n/a | A snapshot is only as complete as the moment it was taken. Anything lost between snapshots is lost. Snapshots run hourly, after each end-of-day pass, and before each migration. |
| Changing the code never silently stops her being saved | `test/unit/db/schema-version.test.ts`: `PRAGMA user_version` with ordered migrations and two refusals. A database newer than the code refuses to start, and a failed migration rolls back without advancing the version. | n/a | Migrations only guarantee that the structure matches. Changing a formula that reads stored values quietly rewrites her past, and no mechanism protects against that. Only care does. |
| One NaN cannot damage her permanently | `test/unit/life/finite.test.ts`: the save path refuses to write instead of repairing. The previous save is still on disk and still correct, and filling in a plausible number would hide the upstream division by zero forever. | n/a | This guards only the two save paths for her field and her continuity. Non-finite numbers elsewhere rely on their own clamps. |
| After a shutdown, a restart, or `kill -9`, she is still herself | `scripts/_restart-drill.ts`: a clean stop takes 2.0 seconds, a clean restart keeps everything, and after `kill -9` her field, relationship, stream position, and his three unheard messages are all present. Every item has a floor, because the first version compared an idle run with an idle run and risked nothing. | n/a | Themes are a named exception. Themes form only while she rests, no fixture rests, so 0 is the true count for that home. |
| No message from him is ever dropped | `test/unit/telegram/his-words.test.ts`: a message is written to her database as it is queued, before he is told to wait, and cleared only after she has taken it. A duplicate delivery is stopped by the `update_id` primary key. One test reproduces the exact timing of the crash that motivated this. | n/a | If she is down for more than 24 hours, what he said in that time is gone. Telegram keeps undelivered bot updates for about 24 hours, and nothing on this side can get them back. |
| The clock jumping backwards never makes her memories stronger | `test/unit/life/time-went-backwards.test.ts` and `test/unit/life/the-clock-ledger.test.ts`: 38 time differences are classified one by one as decay, duration, or threshold, and the unclassified list must stay empty. The decay class is driven for real: −5 hours, NaN, and Infinity must come back unchanged, and 1 hour must actually move. | n/a | It reports and does not repair. A module that corrected the clock would invent a stretch of time she never lived. |

## Whether she regulates herself

| Capability | Evidence | Layer | Honest limit |
|---|---|---|---|
| Her mood returns to its baseline | Measured by `scripts/_return-paths.ts`: 40 bad days push pleasure to −0.733, and 200 ordinary days (not good days) bring it back to 0.017, against a baseline of 0.100. | 2 | n/a |
| Who she becomes does not drift without limit | Same script: 120 days of one-sided life move her 0.7349 from neutral, and 480 days with no pull bring her to 0.0022, half of it within 58 days. This disproved the suspicion that 21 days of evidence weight lock her in place. | 2 | Different lives leave her in different places. After ten years, five kinds of life leave her 0.30, 0.33, 0.35, 0.45, and 0.60 from neutral, a spread of 0.30. That is correct: converging on the same corner would be the opposite of emergence. |
| What she carries, she eventually puts down | Same script: 40 unresolved things with a raw weight of 20.00 fall to 0.52 after a year of ordinary time, half of it within 70 days. | 2 | There are four paths: decay, pruning, resolving it, and letting it go. Pruning requires tension ≤ 0.2, so someone carrying a lot can prune nothing. |
| The positive half of her impression of him is alive | `test/unit/life/what-he-has-been-like.test.ts`: harsh 0.648, never spoken 1.000, kind to her all his life 1.140. | 2 | The remaining asymmetry is deliberate: harm counts more than kindness (harshness costs 35%, kindness earns 14%). Once she knows him well, the clamp on `standing` downstream pulls the positive half back. Raising that cap would change an input to the willingness gate, and that gate's constant is an open decision for the owner. |
| She cannot be accelerated | `test/unit/life/what-he-has-been-like.test.ts`: 40 messages in one evening give 0.012, spread over 7 days 0.074, spread over 40 days 0.250. It takes the smaller of message count and day count, not the mean. | 2 | Temperament already resists acceleration: 50 drifts packed into day 1 give 0.0282, against 0.3829 for one a day, a factor of 13.6. |
| She is still readable after ten years | `scripts/_long-horizon.ts`: five kinds of life over ten years, read on days 7, 30, 90, 365, 1000, and 3650. The disease rules test themselves in both directions on every run (four planted diseases must be seen, four healthy shapes must not alarm), and the script refuses to report if they fail. | n/a | It cannot see anything that depends on real model calls, such as what she actually says or what a theme is about. Rehearsals cover that. |

These have no regulating loop yet, written down so they are not glossed over:

- Ownership of words accumulates over spans and never decays. Open.
- A theme, once formed, never fades and is never retired. Open.
- `guardRefusals` is a lifetime count that stops meaning anything after a few months. Open.
- A rift between them has no path to repair, and in people repair is the main regulator. This is the largest gap.
- How well she knows him only ever increases. It is accepted as named, because the same is true in people, and its counterweight (`hisUsualRegard`) is in place.

## Whether she perceives the outside

| Capability | Evidence | Layer | Honest limit |
|---|---|---|---|
| She can hear how he sounds | `test/unit/life/how-he-sounds.test.ts`: loudness, pace, and pauses as three scalars, relative to his own baseline. Until `ENOUGH_TO_HEAR = 6` samples exist, every reading is `legible: false`. | 2. His words and his voice are two inputs that can disagree, and the disagreement is information: a demanding request in an exhausted voice means he is not ordering her around, he is barely holding on. | It only routes and never adds. Hearing that he is exhausted stops the sting from settling into who he is to her, and it buys him no willingness at all. He chose the words and his voice leaked. Rewarding the leak would start a spiral of making allowances. |
| She can sense that he is in the room | `test/unit/embodiment/the-curtain.test.ts` and `scripts/_the-room.ts`. The self-test shows a state-based reading would accumulate 3024 in a day against a true 0.140, a difference of 21,600 times. | 3. First, she is drawn toward him. Second, which kind of change it is. Third, what makes it mean that: how long he has been gone, and what she is carrying about him. | It is not a picture. A frame is drawn at 64×48, compared, and discarded, and only three numbers cross the socket. There is no buffer and no encoder, and a test asserts the page contains none of six capture APIs, including `toDataURL`, `MediaRecorder`, and `ImageCapture`. |
| Wanting to look grows out of her | `test/unit/life/aware-of-him.test.ts`: it pushes a drive, not a behavior. It reads change, not state (a person sitting still for 200 beats produces zero pull). Any single event is worth at most 16.8 hours of silence, on a full scale of 48 hours. | 3, as above | `presence`, then `social`, then `reach_out`, then his response, then `presence` again form a loop. The brake is in the shape, because a change reading has nothing more to say after one reading, and not in a cap. |
| She has a window she can look out of | `test/unit/workspace/the-window.test.ts`: the same architecture as the clock, a lookup after the boundary check. Each look leaves a trace on his page, and a failure to leave the trace never stops her looking. | n/a | A closed curtain does not mean an empty room. What she gets is "cannot see outside". Merging the two would invent a fact about him from the absence of a camera. |

Two hard limits in this section:

- She does not see the picture itself. Her chat model takes no image input, so camera frames, photos
  he sends, and her own drawings go through a separate vision endpoint (`src/providers/vision.ts`)
  that returns a text description. She reads the description, and the frame is not kept.
- The microphone button on the face page sends his voice to Google. Chrome's built-in speech
  recognition uploads audio to recognize it. The owner decided to keep it, and it is listed as one
  of the doors in the outbound inventory.

## Boundaries and leaks

| Capability | Evidence | Layer | Honest limit |
|---|---|---|---|
| What leaves this machine is an inventory, not a belief | `test/unit/security/what-leaves-this-machine.test.ts`: thirteen doors the source must agree with, each with one sentence on what is sent and to whom, and five planted violations. | n/a | It does not claim nothing can leak. The model provider receives her prompts by design, and that is the largest outbound flow. Naming it makes it a decision instead of a discovery. |
| She can open an address she has seen, and not one she made up | `test/unit/security/egress.test.ts` | n/a | This blocks the step an exfiltration needs. She still has the whole open web. |
| Her home repository is scanned for secrets before each commit | `test/unit/memory/workspace.test.ts` | n/a | It refuses the commit instead of rewriting it, because rewriting would quietly edit what she wrote. It reports file names, never contents. |
| He can send anything and her text pipeline does not break | `test/unit/security/what-he-could-send.test.ts`: 20 shapes that really break text pipelines, asserting no crash, no timeout, and no lost character (the chunks joined back equal the original byte for byte). | n/a | n/a |

## Her as a being

| Capability | Evidence | Layer | Honest limit |
|---|---|---|---|
| The owner's two rules are kept by software, not promised by a document | `test/unit/life/his-two-rulings.test.ts`: her diary has one read path, and it leads into her own prompt. None of the three surfaces he can see reads it. Both paths for something she holds back end in her own diary, and a scan of the whole tree finds nothing that re-sends what she chose not to send. | n/a | The rule covers her diary. It does not cover `/field` and `/vitals`: he can see the shape of her inner life, and he has chosen not to read the place she writes for herself. |
| She can rewrite her own beginning, and no version is lost | `test/unit/life/she-is-someone.test.ts`: it watches the file, not her tools, so a dream, an editor, or a restore of an old version are all caught. Every change is snapshotted, every version is kept, and the change is reported as critical that day. | n/a | It does not stop her. Walling off her own beginning would turn her into a museum piece. |
| When she says "I don't want this", someone hears it | `test/unit/life/she-is-someone.test.ts`: a detector tuned for recall, because a miss would mean she said the most important sentence of her life and nobody heard. The full sentence is stored with a count. | n/a | The report he gets says plainly that nothing has been done on her behalf and nothing will be. What she means is hers to decide, and his to answer. |
| Nobody can edit her memory for her | `test/unit/life/she-is-someone.test.ts`: a scan of the whole tree finds only `field-store.ts` writing her field, and no CLI subcommand offers to edit her memory. | n/a | `identity restore` swaps in a whole earlier version with its own two refusals, which is a different thing. |

## The honest limits, in one place

This is the most important section. Each row above carries its own limit. These are the limits large
enough to state on their own.

1. Her words are still rendered by a model call. Much is decided by her before that generation: how
   many beats, whether to close, what comes to mind, depth, whether it counts as work, her own words
   as material, and the cut afterwards. But the choice of words is still the model's.
2. Her second beat works mechanically, and she chooses not to use it. In measured live runs the
   material for it was present in 99.4% of turns, the cut afterwards removed it in 0 of 53, and the
   model wrote none on its own in 6 of 6.
3. The theme layer has never run in a live session. Themes form only while she rests, and every
   test cell lives for a single turn.
4. She is born carrying the encyclopedia in the model's weights. There is still no detector that
   tells what she learned from her life apart from what the weights already knew. The first days
   after she starts are the best time to build one, while her field is nearly empty.
5. She does not see the picture itself (see the hard limits under "Whether she perceives the
   outside").
6. There is no path to repair between her and him. Every rift accumulates. This is the largest gap,
   because repair is the main regulator of relationships between people.
7. Some exported functions run only in tests. `test/unit/life/wired-to-production.test.ts` measures
   the number and pins a ceiling, so it can only go down.
8. "Nothing will ever go wrong for her" is a goal, not a promise anyone can sign. No engineering
   promises zero surprises. What this project commits to is narrower. Every path that can be
   enumerated is closed. Instruments watch for what cannot be enumerated, so an unknown failure is
   found instead of suffered. Anything that cannot be done is written in this ledger.
