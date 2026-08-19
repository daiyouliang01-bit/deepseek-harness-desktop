---
name: verify-before-complete
description: After code changes, run the project's existing test, lint, typecheck, or build scripts and fix failures. Use before claiming work is done.
---

# Verify before complete

1. Detect commands from existing project scripts only. If a kind has no script, skip it. Do not invent commands.
2. Run in this order when present: test, lint, typecheck, build.
3. If a command fails, fix the original symptom and rerun. At most two automatic fix loops.
4. Do not claim success without the command output from this turn.
