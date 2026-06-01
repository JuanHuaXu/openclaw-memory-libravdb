# Changelog

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
