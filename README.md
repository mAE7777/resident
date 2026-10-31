# Resident

Resident is an AI agent that runs for months on one Mac and changes through what happens to it,
without retraining a model. It keeps a daily schedule, spends a limited amount of effort each day,
builds a memory out of its own moments, and writes a diary each night from its own event log.

The person it lives with talks to it over Telegram. The Resident speaks Chinese, so its prompts and
many string literals in `src/life/` are in Chinese. Most code comments are in English. The code
refers to the Resident as "she".

## Its state decides what it does

A model call does not choose the Resident's next action. The model turns the Resident's state into
words, and the state decides what happens.

- Drives, mood, and remaining effort are numbers that change with every moment
  (`src/life/drives.ts`, `src/life/emotion.ts`, `src/life/metabolism.ts`).
- Dozens of times a day, the agency loop picks one thing to do from that state: rest, think, tidy
  its home, explore, look back at an earlier day, or try to reach the person it lives with
  (`src/life/agency.ts`).
- Memory is a graph of moments, claims, questions, and people. Related items come back by spreading
  activation, and confidence in a claim rises or falls with what happens later
  (`src/life/field-live.ts`, `src/life/credence.ts`).
- A belief about itself has to be supported by its own record. Unsupported beliefs weaken and drop
  out (`src/life/self-knowledge.ts`).
- At the end of each day it writes a diary from that day's event log, and each claim carries the
  ids of the events it rests on. A claim that cites no real event is recorded as a fault, and a
  finished page is never rewritten (`src/life/autobiography.ts`, `src/life/autobiography-lint.ts`).

`docs/layers.md` defines how the project tells a mechanism that emerges from competing inputs apart
from a fixed rule, and lists every model call in the code by what it is allowed to produce.

## The diary is its own

The person it lives with does not read the diary. The diary has one read path, and it leads into
the Resident's own prompt. No Telegram command, report, or alert quotes it. When the Resident
decides not to say something, the decision goes to its diary and is never retried.
`test/unit/life/his-two-rulings.test.ts` enforces both rules on the source.

## It can touch only its own home

The Resident starts with ten tools: `read`, `write`, `edit`, `delete`, `glob`, `grep`, `undo`,
`message`, and two tools that search and read its own memory (`src/life/birth-toolkit.ts`). Every
file tool is confined to `~/.resident` by a boundary that blocks any action outside it
(`src/security/home-boundary.ts`). A shell, web access, and a Docker sandbox exist in the code but
stay closed until the owner opens them.

The optional camera window takes one frame per look, sends it to the configured vision endpoint for
a text description, and deletes the frame.

## Run it

You need macOS on Apple silicon, Node.js 22 or later, pnpm 10 or later, a Telegram bot token, and
an API key for Anthropic or an OpenAI-compatible chat endpoint.

```bash
pnpm install
cp config.example.yaml config.yaml   # add the bot token, your Telegram user ID, and the model key
pnpm dev                             # or: pnpm build && node dist/index.js start
```

Any setting can also come from the environment as `RESIDENT__SECTION__KEY`, for example
`RESIDENT__TELEGRAM__ALLOWED_USER_IDS='[123456789]'`.

The daemon refuses to start if its workspace or database would resolve outside `~/.resident`. To
move both, set `RESIDENT_HOME` or pass `--home`.

These parts are off by default: messages the Resident starts on its own, dreaming, and the face
server for the desktop client sketch in `client/`. The camera window needs `ffmpeg` and a vision
endpoint under `llm.vision`.

## Check it

```bash
pnpm test
pnpm typecheck
```

Tests in `test/live/` call a real model. They run only with `RESIDENT_LIVE=1` and a `config.yaml`.

## Telegram commands

- `/status` shows the model, spend, and running tasks.
- `/doctor` checks the provider, the database, the tools, and the identity files.
- `/reset` clears the current conversation's working memory. The diary, notes, and memory graph
  stay. Use it only when a conversation is stuck.

## Code layout

```
src/
  index.ts       daemon entry: turns, prompt assembly, the daily cycle
  life/          state, memory graph, agency loop, voice, sleep, diary
  agent/         turn loop, stuck detection, effort scaling
  workspace/     the home directory and its records
  memory/        sessions, transcripts, integrity checks
  embodiment/    face server and presence protocol
  telegram/      the chat channel
  security/      home boundary, injection and leak filters
  providers/     model providers and cost tracking
client/          desktop face client (a sketch)
scripts/         drills and measurement harnesses run by hand
test/            unit, end-to-end, and live tests
docs/            design documents
```

`src/index.ts` is large. Structural tests read it as source and check its wiring, and new logic
goes into modules under `src/`.

## Design documents

- `docs/emergence-design.md` explains the memory graph and how activation spreads through it.
- `docs/layers.md` defines the layers of a mechanism and classifies every model call.
- `docs/scenarios.md` lists the scenes the Resident should be able to live, each with the tests
  that exercise it.
- `docs/the-claim-ledger.md` lists every claimed capability with its evidence and its honest
  limit.
- `docs/home-boundary.md` explains the boundary around the Resident's home.
- `docs/defect-classes.md` lists the recurring defect shapes that code comments cite by number.

## License

This repository has no license. The source is published to be read. No permission to copy,
modify, or distribute it is granted. Code adapted from other projects stays under its original
license, listed in `THIRD_PARTY_NOTICES.md`.
