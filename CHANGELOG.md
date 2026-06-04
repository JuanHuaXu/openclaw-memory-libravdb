# Changelog

## v1.8.10 — 2026-06-03

**Contributor:** xDarkicex — [PR #304](https://github.com/xDarkicex/openclaw-memory-libravdb/pull/304)
**Signed off by:** xDarkicex

### Changed
- `memory_search` and `memory_grep` tool descriptions now instruct models to skip searching when the answer is already visible in the context window (prior turns, `<context_memory>` blocks, or context assembly). Prevents weaker models from firing redundant searches for information that has already been retrieved.
- `<context_memory>` preamble strengthened: explicitly tells the model the content has "ALREADY BEEN RETRIEVED" and forbids re-searching for topics answered there.

---

**Contributor:** computment — [PR #268](https://github.com/xDarkicex/openclaw-memory-libravdb/pull/268)
**Signed off by:** xDarkicex

### Fixed
- Integration test suite now runs in the default `pnpm run check` gate. Previously the gate was green while integration tests were silently broken.
- Added `clean:test` script to purge stale `.ts-build` artifacts so deleted or renamed tests cannot execute from build cache.
- Restored missing `FsDirentLike` type that broke `markdown-ingest.test.ts`.
- Updated `host-flow.test.ts` expectations for current replay-safe prompt-injection behavior.
- Compact result normalization no longer serializes absent fields as `undefined`.

---

**Contributor:** Juan — [PR #306](https://github.com/xDarkicex/openclaw-memory-libravdb/pull/306)
**Signed off by:** xDarkicex

### Security
- Pinned `undici` to 8.3.0 via `pnpm.overrides` to patch transitive vulnerable resolutions.
- Bumped `openclaw` devDependency from 2026.4.11 to 2026.4.23, clearing 9 CVEs:
  - CVE-2026-44109 (critical): Feishu webhook and card-action validation fail-closed
  - CVE-2026-43585 (critical): Gateway HTTP endpoints re-resolve bearer auth after SecretRef rotation
  - CVE-2026-45004 (high): Arbitrary code execution via attacker-controlled `setup-api.js`
  - CVE-2026-43530 (high): Busybox/toybox applet execution weakened exec approval binding
  - CVE-2026-43528 (high): `config.get` redaction bypass through `sourceConfig`/`runtimeConfig` aliases
  - CVE-2026-44110 (high): Matrix room control-command authorization trusted DM pairing-store entries
  - CVE-2026-44118 (high): MCP loopback owner context derived from server-issued bearer tokens
  - CVE-2026-44114 (high): Workspace dotenv could override runtime-control environment variables
  - GHSA-cwj3-vqpp-pmxr (high): Gateway config mutation guard allowed unsafe model-driven config writes
- Raised `minHostVersion` to `>=2026.4.23`.

## v1.8.9 — 2026-06-01

**Contributor:** fuller-stack-dev — [PR #294](https://github.com/xDarkicex/openclaw-memory-libravdb/pull/294)  
**Signed off by:** xDarkicex

### Fixed
- Declared `memory_recall`, `memory_expand`, and `memory_grep` tools in `openclaw.plugin.json` manifest. Tools were functional but missing from the plugin manifest, causing discovery failures in OpenClaw.

---

**Contributor:** JARVIS-Glasses (IWhatsskill) — [PR #297](https://github.com/xDarkicex/openclaw-memory-libravdb/pull/297)  
**Signed off by:** xDarkicex

### Fixed
- Sanitized subagent expansion budgets: `NaN`, `Infinity`, `-Infinity`, and negative config values now fall back to the documented default of 8000 tokens instead of producing unbounded or invalid grants.
- Hardened `consumeSubagentBudget()` to reject non-finite and non-positive requested grants.

---

**Contributor:** xDarkicex — [PR #299](https://github.com/xDarkicex/openclaw-memory-libravdb/pull/299)  
**Signed off by:** xDarkicex

### Fixed
- Session continuity context now uses a three-tier fallback instead of returning `null`: no pointer → no prior session, pointer without `summary_id` → not compacted, `expandSummary` fails → expansion failed. Each fallback directs the LLM to use `memory_search` for recovery.
- Continuity pointer search upgraded to natural language query with wider k to avoid crowding out the exact ID match.
- Guarded against undefined `session_id` in continuity fallback text.
- Reduced exact recall search breadth from 32 to 10.
- Requires daemon v1.8.8.

