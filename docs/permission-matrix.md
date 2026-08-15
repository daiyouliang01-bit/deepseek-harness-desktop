# Permission Matrix — DeepSeek Harness Desktop

> Task 4.1 deliverable. Operation × scope × default decision. Enforced by
> `@dshd/permissions`; approvals surface in the UI; everything is audited.

## Default policy (v1)

| Class | Default | Notes |
|---|---|---|
| `read` | **allow** | file reads, dir listing, settings — safe by default |
| `edit` | **ask** | workspace file writes need one-time/session/workspace approval |
| `execute` | **ask** | shell commands / terminal — approval required, audited |
| `network` | **ask** | external HTTP requests |
| `external-mcp` | **ask** | external MCP tool servers |

Unknown classes → **deny** (default-deny).

## Approval modes

| Mode | Scope | Lifetime |
|---|---|---|
| one-time | the exact scope of the request | until revoked (or TTL) |
| session | the request's scope | until session end (`endSession`) |
| workspace | the whole workspace (`*`) for that class | until revoked / session end |

Explicit TTLs supported for all modes.

## Cost guardrail (ADR-008)

- Per-session token budget cap, configurable.
- `blockNewCalls: true` → once the budget is exhausted, **new** tool calls are
  blocked (in-flight calls are never interrupted).
- `blockNewCalls: false` → informational accounting only.
- Reset per session; audited via the audit log.

## Audit log

Every decision records: actor · action · class · scope · outcome
(`allowed | denied | approved | rejected | blocked`) · detail. Capped at
5,000 entries (configurable); filterable by actor/class.

## Verification

- [x] allow / deny / ask decisions incl. scope matching (unit tests)
- [x] one-time / session / workspace / TTL expiry
- [x] budget block + reset
- [x] audit cap + filters
- [ ] end-to-end: select project → read file → propose edit → approve →
      diff → reject shell → cancel-recover (Task 4.2 verification)
