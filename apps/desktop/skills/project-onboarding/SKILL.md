---
name: project-onboarding
description: Understand a local repo from README and manifests before editing. Use when opening a new workspace or when the user asks what this project is.
---

# Project onboarding

Load this skill before making the first edit in an unfamiliar repository.

1. Prefer the injected project-context snapshot if present.
2. Read README and the nearest package/pyproject/go/cargo manifest. Do not re-read AGENTS.md; the runtime already injects it.
3. Summarize: language, scripts, test command, and the smallest file set that matters for the current request.
4. Do not scan `node_modules`, `.git`, `dist`, or `build`.
