# Third-party notices

Parts of this repository are adapted from the open-source projects below. Each project's license
notice is reproduced at the end of this file, as its license requires. The upstream file paths are
the ones the code was adapted from, and some may have moved since.

## Code adapted from other projects

### IronClaw

- Source: https://github.com/nearai/ironclaw
- License: MIT OR Apache-2.0. This repository uses it under the MIT license.
- Files:
  - `src/agent/duplicate.ts`: duplicate tool-call detection and escalation (`src/agent/agentic_loop.rs`)
  - `src/providers/budget-cascade.ts`: cache pricing constants and the cache-aware cost formula (`cost_guard.rs`)
  - `src/sandbox/container.ts`: Docker container lifecycle, network proxy, and fast Docker detection (`sandbox/container.rs`, `sandbox/proxy/`)
  - `src/sandbox/policies.ts`: sandbox policies (`sandbox/config.rs`)
  - `src/security/injection.ts`: literal and regular-expression injection patterns (`sanitizer.rs`)
  - `src/tools/builtin/file-snapshot.ts`: per-tool file snapshots with a 50-snapshot budget (`file_history.rs`)
  - `src/tools/document.ts`: document text extraction and `strip_xml_tags` (`document_extraction`)

### OpenClaw

- Source: https://github.com/openclaw/openclaw
- License: MIT
- Files:
  - `src/security/boundary.ts`: random 16-character hex boundary ids around external content
  - `src/security/homoglyph.ts`: the angle-bracket homoglyph map (`src/security/external-content.ts`)
  - `src/security/injection.ts`: injection patterns (`src/security/external-content.ts`)
  - `src/index.ts`: the cache boundary pattern, which puts volatile content after the cached prefix

### Hermes Agent

- Source: https://github.com/NousResearch/hermes-agent
- License: MIT
- Files:
  - `src/providers/errors.ts`: provider error classification (`agent/error_classifier.py`)
  - `src/sandbox/container.ts`: the order in which the Docker host is resolved
  - `src/security/commands.ts`: dangerous command patterns (`tools/approval.py`)
  - `src/security/injection.ts`: injection patterns (`prompt_builder.py`)
  - `src/security/invisible.ts`: invisible code points (`_CONTEXT_INVISIBLE_CHARS`)
  - `src/security/leak.ts`: the design of the leak filter
  - `src/security/redact.ts`: secret redaction patterns (`agent/redact.py`)
  - `src/security/skill-scanner.ts`: skill scanning patterns (`tools/skills_guard.py`)

### PicoClaw

- Source: https://github.com/sipeed/picoclaw
- License: MIT
- Files:
  - `src/agent/effort-scaling.ts`: weighted-feature classification, after `RuleClassifier`
  - `src/agent/loop.ts`: the silent tool result pattern (`SilentResult`)
  - `src/index.ts`: processing a new message faster by interrupting the current turn
  - `src/providers/errors.ts`: provider error patterns (`pkg/providers/error_classifier.go`)
  - `src/security/commands.ts`: the exact-match shell blocklist
  - `src/tools/builtin/search-backend.ts`: DuckDuckGo result parsing patterns

### nanobot

- Source: https://github.com/HKUDS/nanobot
- License: MIT
- Files:
  - `src/agent/loop.ts`: continuing after a truncated model output
  - `src/security/tool-guard.ts`: the `should_execute_tools` check
  - `src/tools/executor.ts`: catching tool calls that fail silently with an empty result

## License notices

### IronClaw (MIT)

```
MIT License

Copyright (c) 2026 NEAR AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### OpenClaw (MIT)

```
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Hermes Agent (MIT)

```
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### PicoClaw (MIT)

```
MIT License

Copyright (c) 2026 PicoClaw contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### nanobot (MIT)

```
MIT License

Copyright (c) 2025-present Xubin Ren and the nanobot contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
