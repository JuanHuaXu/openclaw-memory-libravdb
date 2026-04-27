# LibraVDB — Code Analysis

> Date: 2026-04-27
> Source: `https://github.com/JuanHuaXu/openclaw-memory-libravdb`
> Analyst: Clawdius

---

## 1. What Is It

LibraVDB is a **local-first OpenClaw memory plugin** bridging OpenClaw's `memory` and `contextEngine` slots to a Go sidecar daemon (`libravdbd`).

- **TS frontend** — config resolution, plugin registration, lifecycle hooks, markdown ingestion
- **Go sidecar** — vector storage (LibraVDB), ONNX embeddings, compaction, dream collection

---

## 2. Architecture

```
OpenClaw Core (memory/contextEngine slots)
         │
    session lifecycle events
         ▼
LibraVDB Plugin (TypeScript frontend)
         │
    gRPC/JSON-RPC over sidecar socket
         ▼
  libravdbd (Go daemon)
    ├── Vector store (LibraVDB)
    ├── ONNX embeddings
    ├── Compaction
    └── Dream collection
```

---

## 3. Architecture Decisions (ADRs)

| ADR | Decision | Why |
|-----|----------|-----|
| **001** | ONNX over Ollama | Predictable latency, deterministic embeddings, offline-first |
| **002** | LibraVDB over LanceDB | Collection-scoped lifecycle, delete-heavy compaction, no Python deps |
| **003** | Convex gating scalar | Single `G(t)` instead of per-domain thresholds for mixed-content users |
| **004** | Go sidecar over native TS | Process isolation, efficient inference/storage, bounded failure semantics |

---

## 4. Module Breakdown

### 4.1 `plugin-runtime.ts` — Entry point & lifecycle

**Purpose:** Starts the sidecar, manages its lifecycle, handles shutdown.

**Key exports:**
- `createPluginRuntime(cfg, logger)` — factory that lazy-starts the sidecar
- `PluginRuntime` interface — `getRpc()`, `getKernel()`, `emitLifecycleHint()`, `shutdown()`
- `LifecycleHint` type — `before_reset` and `session_end` events
- `enrichStartupError()` — adds provisioning hints on failure

**Key details:**
- Lazy startup: sidecar only starts on first RPC call (`ensureStarted()`)
- Startup health check fails fast if daemon is unhealthy
- Optional gRPC kernel client for `IntelligenceKernel` service (requires `grpcEndpoint` config)
- Auth via `LIBRAVDB_AUTH_SECRET` or `LIBRAVDB_AUTH_SECRET_FILE` env vars
- `DEFAULT_RPC_TIMEOUT_MS = 30000`

---

### 4.2 `rpc.ts` — Binary RPC transport

**Purpose:** Length-prefixed binary frame protocol to sidecar.

**Key class:** `RpcClient`

**Protocol format:**
```
[1 byte magic (optional)] [4-byte BE payload length] [protobuf payload]
```

**Key details:**
- Magic byte `0x02` sent on first connection / reconnect (sidecar provisioning handshake)
- **Reconnection-aware:** in-flight calls survive sidecar restart via `waitForReconnect()`
- **DoS protection:** 64MB frame size limit
- **Buffer compaction:** shrinks receive buffer when remainder < 25% of allocation
- Pending call map keyed by `bigint` sequence number
- Per-call timeouts (default 30s)

---

### 4.3 `rpc-protobuf-codecs.ts` — Type-safe RPC method map

**Purpose:** Maps RPC method names to protobuf encode/decode codecs.

**18 RPC methods:**

| Category | Methods |
|----------|---------|
| **Health/Status** | `health`, `status`, `flush` |
| **Lifecycle** | `session_lifecycle_hint` |
| **Search** | `search_text`, `search_text_collections`, `list_collection` |
| **Admin** | `list_lifecycle_journal`, `export_memory`, `flush_namespace` |
| **Dreams** | `promote_dream_entries` |
| **Markdown** | `ingest_markdown_document`, `delete_authored_document` |
| **Kernel (5)** | `bootstrap_session_kernel`, `ingest_message_kernel`, `after_turn_kernel`, `assemble_context_internal`, `compact_session` |

**Key details:**
- All methods use protobuf binary encoding (via `toBinary()`/`fromBinary()`)
- Response normalization: `normalizeSearchTextResponse()` and `normalizeAssembleContextInternalResponse()` guard against missing arrays/objects
- `excludeByCollection` normalization converts various formats to `StringList`

---

### 4.4 `grpc-client.ts` — Optional kernel transport

**Purpose:** gRPC client for the optional `IntelligenceKernel` service.

**Key class:** `GrpcKernelClient`

**Auth flow:**
1. Call `initializeSession(req)` — gets a `nonce` from sidecar
2. Subsequent calls sign with `HMAC-SHA256(secret, nonce)` → `x-libravdb-auth` header
3. Session is bound to the nonce; auth is per-call

**Proto file:** `api/proto/intelligence_kernel/v1/kernel.proto` (loaded at build time via `@grpc/proto-loader`)

---

### 4.5 `memory-runtime.ts` — OpenClaw memory API bridge

**Purpose:** Implements the `MemorySearchManager` interface expected by OpenClaw's memory slot.

**Key exports:**
- `buildMemoryRuntimeBridge(getRpc, cfg)` — factory
- `createMemorySearchManager()` — the actual search manager

**Collection resolution (3 modes):**

| Config flag | Collection prefix |
|-------------|-------------------|
| *(default)* | `session:{sessionId}` |
| `useSessionRecallProjection` | `session_recall:{sessionId}` |
| `useSessionSummarySearchExperiment` | `session_summary:{sessionId}` |

**All modes also search `user:{userId}` and `global` collections.**

**Search flow:**
1. Resolve query text (supports `query`, `text`, `input`, `q` aliases)
2. Check for dream query signal (pattern-matched)
3. Resolve durable namespace from userId/sessionKey/agentId
4. Normalize k (default 8)
5. Call `search_text` (single) or `search_text_collections` (multi)
6. Filter by `minScore` if set
7. Wrap results with `toMemorySearchResult()` — adds `path`, `score`, `snippet`, `citation`

**Result path encoding:** `encodeURIComponent(collection)::encodeURIComponent(id)`

---

### 4.6 `dream-routing.ts` — Dream collection detection

**Purpose:** Pattern-matches "dream" queries and resolves the dream collection.

**Detection patterns:**
- `\bdream(?:s|ed|ing)?\b` — "dream", "dreams", "dreamed", "dreaming"
- `\btell\s+me\s+about\s+(?:your\s+)?dreams?\b`
- `\bwhat\s+did\s+i\s+dream\s+about\b`
- `\bwhat\s+was\s+i\s+dreaming\s+about\b`

**Collection naming:** `dream:{userId}`

---

### 4.7 `dream-promotion.ts` — Dream diary importer

**Purpose:** Reads a markdown dream diary file and pushes entries to the dream collection.

**Flow:** Parse markdown → validate entries → call `promote_dream_entries` RPC

---

### 4.8 `durable-namespace.ts` — Persistent naming

**Purpose:** Derives durable namespace IDs from userId/sessionKey/agentId triplets.

**Naming patterns:**
- `user:{userId}` — persistent user namespace
- `session_recall:{sessionKey}` — derived session namespace
- `session_summary:{sessionKey}` — derived session summary namespace

---

### 4.9 `lifecycle-hooks.ts` — OpenClaw event hooks

**Purpose:** Bridges OpenClaw lifecycle events to LibraVDB.

**Two hooks:**

| Hook | When | What it does |
|------|------|--------------|
| `before_reset` | Before session reset | Persists current turn state |
| `session_end` | When session terminates | Triggers compaction/summary |

Both call `emitLifecycleHint()` → `session_lifecycle_hint` RPC.

**Error handling:** Non-fatal — logs warning, continues OpenClaw flow.

---

### 4.10 `markdown-ingest.ts` — Markdown ingestion engine

**Purpose:** Watches directories for markdown files and ingests them into the daemon.

**Architecture:**
```
createMarkdownIngestionHandle(cfg)
  ├── DirectoryMarkdownSourceAdapter ("generic") — user-specified roots
  └── DirectoryMarkdownSourceAdapter ("obsidian") — Obsidian vault (if enabled)
```

**Ingestion version:** `v3`, hash backend: `wasm-fnv1a64`

**Per-source config:**

| Field | Purpose |
|-------|---------|
| `roots` | Directories to watch |
| `include` | Glob patterns to include |
| `exclude` | Glob patterns to exclude |
| `debounceMs` | Scan debounce (default 150ms) |

**File detection:**
- `.md` and `.markdown` extensions
- `memory.md` (case-insensitive) always included
- Glob-based include/exclude (simple `*` → `.*`)
- Special handling for Obsidian: frontmatter tags + inline `#tag` detection

**Scan flow:**
1. `walkDirectory()` — recursive traversal with `fs.readdir()`
2. `ensureDirectoryWatcher()` — `fs.watch()` per directory
3. `stat()` + hash comparison — only sync changed files
4. `syncMarkdownFile()` — read file, compute hash, call `ingest_markdown_document` RPC
5. `pruneDeletedFiles()` — delete orphaned docs when files are removed

**Key optimizations:**
- stat-based change detection (no re-read if mtime+size unchanged)
- hash comparison before re-ingestion
- Debounced directory watches (not per-file)
- Buffer compaction guard

---

### 4.11 `markdown-hash.ts` — FNV-1a 64-bit hashing

**Purpose:** Deterministic file content hashing for dedup.

**Two backends:**
1. **WASM** (`wasm-fnv1a64`) — inline WebAssembly module, default
2. **JS fallback** (`js-fnv1a64`) — pure JS if WASM unavailable

**Algorithm:** FNV-1a 64-bit (offset basis `0xcbf29ce484222325`, prime `0x100000001b3`)

**Key detail:** WASM module is embedded as raw bytes in source — zero external deps.

---

### 4.12 `cli.ts` / `cli-descriptors.ts` — CLI interface

**Purpose:** `openclaw memory` subcommand interface.

**Commands:**

| Command | Flags | Description |
|---------|-------|-------------|
| `status` | `--agent`, `--json`, `--deep`, `--index`, `--verbose` | Sidecar health, record counts, thresholds |
| `index` | `--agent`, `--force`, `--verbose` | Refresh delegated index state |
| `search` | `--query`, `--agent`, `--max-results`, `--min-score`, `--json` | Search memory |
| `flush` | `--user-id`, `--session-key`, `--yes` | Wipe durable namespace (destructive) |
| `export` | `--user-id`, `--session-key` | Stream memories as NDJSON |
| `journal` | `--session-id`, `--limit` | View lifecycle hints |
| `dream-promote` | `--user-id`, `--dream-file` | Promote dream diary entries |

**CLI descriptor:** `{ name: "memory", description: "Manage LibraVDB memory", hasSubcommands: true }`

**Mode:** Full mode (runtime available) vs structure-only mode (for `--help` without sidecar)

---

### 4.13 `sidecar.ts` — Sidecar process management

**Purpose:** Spawns and manages the `libravdbd` daemon.

**Key function:** `startSidecar(cfg, logger)` — spawns process, waits for socket, returns handle.

**Error handling:** `enrichStartupError()` adds provisioning hints on failure.

**Config:** `rpcTimeoutMs` (default 30s), `STARTUP_HEALTH_TIMEOUT_MS` (2s).

---

## 5. Config Schema (Full — from openclaw.plugin.json)

> The full schema has many fields my analysis missed. Key corrections below:

| My analysis entry | Actual value | Source |
|-|-|---|
| `embeddingBackend: "onnx" | "ollama" | "remote"` | ~~`embeddingBackend: "onnx" | "ollama" | "remote";`~~ **CORRECTED:** `"bundled" | "onnx-local" | "custom-local"` | plugin schema |
| `summarizerBackend: "onnx" | "ollama" | "none"` | ~~`summarizerBackend: "onnx" | "ollama" | "none";`~~ **CORRECTED:** `"bundled" | "onnx-local" | "ollama-local" | "custom-local"` | plugin schema |

### Additional fields missing from my analysis

#### Embedding extras
- `fallbackProfile` — default `all-minilm-l6-v2`
- `embeddingModelPath` — path to ONNX model dir (for `onnx-local`)
- `embeddingTokenizerPath` — separate tokenizer file
- `embeddingDimensions` — explicit override
- `embeddingNormalize` — normalization toggle
- `embeddingRuntimePath` — ONNX runtime binary

#### Summarizer extras
- `summarizerProfile`, `summarizerRuntimePath`, `summarizerModelPath`, `summarizerTokenizerPath`, `summarizerModel`, `summarizerEndpoint`
- `ollamaUrl` — optional Ollama endpoint for summarization
- `compactModel` — model to use for compaction

#### Gating (detailed weights)
~~`gatingWeights.conversational` / `gatingWeights.technical`~~ **CORRECTED:**
```json
{
  "gatingWeights": {
    "w1c": 0.35, "w2c": 0.4, "w3c": 0.25,  // conversational
    "w1t": 0.4,  "w2t": 0.35, "w3t": 0.25   // technical
  }
}
```
- `gatingTechNorm` — default `1.5`
- `gatingCentroidK` — default `10`

#### Scoring / retrieval
- `alpha`, `beta`, `gamma` — hybrid scoring weights (similarity, scope, recency)
- `recencyLambdaSession`, `recencyLambdaUser`, `recencyLambdaGlobal` — per-scope recency decay
- `tokenBudgetFraction` — fraction of context budget for memory assembly
- `compactThreshold` — explicit compaction trigger
- `compactionThresholdFraction` — default `0.8`
- `compactSessionTokenBudget` — default `2000` tokens
- `compactionQualityWeight` — default `0.5`

#### Section 7 (advanced scoring) — missing from analysis
- `section7CoarseTopK`, `section7SecondPassTopK`, `section7Theta1`, `section7Kappa`
- `section7HopEta`, `section7HopThreshold`, `section7AuthorityRecencyLambda`
- `section7AuthorityRecencyWeight`, `section7AuthorityFrequencyWeight`, `section7AuthorityAuthoredWeight`

#### Memory expansion — missing from analysis
- `summaryExpansionConfidenceThreshold`, `summaryExpansionDepth`
- `summaryExpansionTokenBudget`, `summaryExpansionPenaltyFactor`
- `recoveryFloorScore`, `recoveryMinTopK`, `recoveryMinConfidenceMean`

#### Authored / guidance budgets — missing from analysis
- `authoredHardBudgetFraction`, `authoredSoftBudgetFraction`
- `elevatedGuidanceBudgetFraction`

#### Continuity — missing from analysis
- `continuityMinTurns`, `continuityTailBudgetTokens`, `continuityPriorContextTokens`

#### Session / lifecycle
- `sessionTTL` — session expiry
- `lifecycleJournalMaxEntries` — default `500`
- `dbPath` — custom DB location
- `sidecarPath` — `"auto"` resolves: env → `$HOME/.clawdb/run/libravdb.sock` → Homebrew → `/usr/local` → fallback
- `maxRetries` — RPC retry budget
- `logLevel` — `"debug" | "info" | "warn" | "error"`

#### Dream promotion — missing from analysis
- ~~`dreamPromotionEnabled`~~ — actual field: `dreamPromotionEnabled` (boolean, default false)
- `dreamPromotionDiaryPath`, `dreamPromotionUserId`, `dreamPromotionDebounceMs` (default 150)

> **Note:** The TypeScript `PluginConfig` interface (in `src/types.ts`) adds many fields not yet in the plugin schema JSON. The schema JSON is the canonical config surface; the TS interface may include future fields.

---

## 6. Strengths

1. **Process isolation** — Go sidecar crashes don't kill the chat session
2. **Deterministic file hashing** — WASM FNV-1a64, zero drift
3. **Multi-mode collection scoping** — session, recall, summary, dream via config
4. **Graceful degradation** — health check on startup, fallback on sidecar loss
5. **Obsidian integration** — frontmatter + inline tag detection
6. **Dream collection** — novel episodic/autobiographical memory feature
7. **CLI tooling** — full `openclaw memory` CLI with CRUD + journal/export
8. **Reconnection-aware RPC** — in-flight calls survive sidecar restart
9. **Lazy startup** — sidecar only starts when actually needed

---

## 7. Concerns & Risks

| Issue | Severity | Detail |
|-------|----------|--------|
| **Magic byte `0x02`** | Medium | Undocumented protocol detail, fragile across versions |
| **No TLS** | Low | Local-socket only; HMAC auth for kernel but no encryption |
| **Simple globs** | Low | No brace expansion, no negation patterns |
| **Buffer compaction** | Low | 25% threshold (`>>> 2`) is a magic number |
| **Proto path** | Medium | Build-time path (`dist/proto/`) — runtime fails if built differently |
| **No migration** | Medium | `flush_namespace` is destructive, no soft-delete |
| **Ad-hoc dream detection** | Low | Regex-based, no ML classification |
| **File size** | High | `markdown-ingest.ts` (~500+ lines) — should be split |

---

## 8. Architecture Verdict

LibraVDB is a well-engineered **local-first memory layer** that prioritizes:

- **Determinism** — hashing, ONNX, bounded failure
- **Isolation** — Go sidecar, process boundaries
- **Control** — convex gating, collection scoping, durable namespaces

The main risk is the Go sidecar binary distribution — if `libravdbd` isn't installed, the plugin degrades to a no-op. The TypeScript frontend is solid, but the value proposition hinges entirely on the daemon being available and healthy.

---

## 9. Missing From Initial Analysis

### 9.1 IntelligenceKernel gRPC Service

My initial analysis noted the `grpc-client.ts` but missed the full scope of the **`IntelligenceKernel`** service.

**Proto:** `api/proto/intelligence_kernel/v1/kernel.proto`

**Service definition:**

```protobuf
service IntelligenceKernel {
  rpc InitializeSession(InitializeRequest) returns (InitializeResponse);  // auth via nonce
  rpc AssembleContext(AssembleContextRequest) returns (AssembleContextResponse);
  rpc RankCandidates(RankCandidatesRequest) returns (RankCandidatesResponse);
  rpc IngestMessage(IngestMessageRequest) returns (IngestMessageResponse);
  rpc AfterTurn(AfterTurnRequest) returns (AfterTurnResponse);
  rpc BootstrapSession(BootstrapSessionRequest) returns (BootstrapSessionResponse);
  rpc CompactSession(CompactSessionRequest) returns (CompactSessionResponse);
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
}
```

**Key data structures missed:**

- **`GatingSignals`** — 12 signals: `g`, `t`, `h`, `r`, `d`, `p`, `a`, `dtech`, `gconv`, `gtech`, `input_freq`, `mem_saturation`
- **`TemporalQueryContext`** — temporal pattern detection (HOW_MANY_DAYS, HOW_LONG, BEFORE_OR_AFTER, etc.)
- **`DreamQueryContext`** — dream query scope with collection name
- **`AssemblyConfig`** — 20+ fields including token budgets, authority weights, Hop distances, thresholds
- **`ScoredCandidate`** — combines `SearchHit` with `TemporalCandidateMetrics` and `RecoveryCandidateMetrics`
- **`TemporalCandidateMetrics`** — semantic_score, recency_score, temporal_anchor_density, slot_coverage, comparison_side_witness_score, comparison_slot_precision/specificity
- **`RecoveryCandidateMetrics`** — lexical_coverage, intent_alignment_bonus, RetrievalTrigger enum
- **`ComparisonWitnessPair`** — side_a vs side_b comparison for query disambiguation

**Auth flow (missed detail):**

1. `InitializeSession` → returns `AuthChallenge` nonce in `server_metadata`
2. Client signs with HMAC-SHA256(secret, nonce) → `x-libravdb-auth` header
3. Next state: `CONNECTION_STATE_AUTHENTICATED` → `CONNECTION_STATE_READY`

This is a **significant addition** — the kernel service is a unified replacement for 6-8 separate JSON-RPC calls.

### 9.2 Plugin Manifest (`openclaw.plugin.json`)

- **Package:** `@xdarkicex/openclaw-memory-libravdb`
- **Version:** `1.4.18`
- **Kind:** `["memory", "context-engine"]` — dual-slot owner
- **Activation:** `onCommands: ["memory"]`
- **Config schema:** 70+ properties (see section 5 above)

### 9.3 LongMemEval Benchmark Harness

My analysis missed the **LongMemEval** benchmark system entirely.

**Purpose:** Validates whether assembled prompts still contain the evidence turns after memory retrieval.

**Scripts:**
- `scripts/longmemeval-diagnose.mjs` — diagnose failures
- `scripts/longmemeval-score.mjs` — score against official evaluator

**Usage:**
```bash
LONGMEMEVAL_DATA_FILE=/path/to/oracle.json pnpm run benchmark:longmemeval
LONGMEMEVAL_USE_EXISTING_DAEMON=1 LONGMEMEVAL_SIDECAR_PATH=unix:/path.sock pnpm run benchmark:longmemeval
LONGMEMEVAL_EVAL_REPO=/path/to/LongMemEval LONGMEMEVAL_HYPOTHESIS_FILE=out.jsonl pnpm run benchmark:longmemeval:score
```

**Env controls:** `LONGMEMEVAL_LIMIT`, `LONGMEMEVAL_TOPK`, `LONGMEMEVAL_OUT_FILE`

### 9.4 Resource Specs (from docs/performance-and-tuning.md)

My analysis missed the measured benchmark data:

**Disk:**
- Daemon binary: **7.7M**
- Bundled Nomic model: **523M**
- Bundled MiniLM fallback: **87M**
- Optional T5 summarizer: **371M**
- ONNX Runtime unpacked (macOS arm64): **44M**
- ONNX Runtime archive: **9.5M**

**Vector storage:**
- MiniLM `384d`: **1536 bytes** per vector
- Nomic `768d`: **3072 bytes** per vector
- 10,000 turns: ~15.4 MB (MiniLM) / ~30.7 MB (Nomic)

**Memory (RSS on Apple M2):**
- Nomic embeddings (no T5): **~266 MB**
- Nomic + T5 summarizer: **~503 MB**

**CPU (Apple M2):**
- MiniLM bundled query embedding: **~22.6 ms/op**
- MiniLM onnx-local query: **~16.3 ms/op**
- Nomic onnx-local query: **~43.7 ms/op**
- Nomic query (one-off 40-sample): p50=**18.61ms**, p95=**24.19ms**
- 50-turn extractive compaction: **~3175 ms**

### 9.5 Installation Paths (from docs/install.md & installaton.md)

**Default endpoints:**
| Platform | Endpoint |
|----------|----------|
| macOS user-local | `unix:$HOME/.clawdb/run/libravdb.sock` |
| macOS Homebrew Apple Silicon | `unix:/opt/homebrew/var/clawdb/run/libravdb.sock` |
| Windows | `tcp:127.0.0.1:37421` |

**Default data path:** `$HOME/.clawdb/data.libravdb`

**Endpoint resolution (when `sidecarPath: "auto"`):**
1. `LIBRAVDB_RPC_ENDPOINT` env
2. `$HOME/.clawdb/run/libravdb.sock`
3. `/opt/homebrew/var/clawdb/run/libravdb.sock`
4. `/usr/local/var/clawdb/run/libravdb.sock`
5. Fallback to #2

### 9.6 `index.js` — Package Entry

The repo has `index.js` at root. My analysis didn't check it, but it's the package entry point that re-exports `src/index.ts` (compiled). The `pnpm check` command runs `tsc --noEmit` then `tsc -p tsconfig.tests.json && node --test .ts-build/test/unit/*.test.js`.

### 9.7 Build & Release (from docs/development.md)

**Build pipeline:**
- `npm run build` — TypeScript compile + copy `dist/`
- `make proto` — Go gRPC stub generation
- `bash scripts/build-daemon.sh` — local daemon build

**Generated files (checked in):**
- `src/generated/libravdb/ipc/v1/rpc_pb.js` — protobuf RPC payloads
- `src/generated/libravdb/ipc/v1/rpc_pb.d.ts` — TypeScript types
- **Do not replace** with old `@xdarkicex/libravdb-contracts` path

### 9.8 `sidecarPath` vs `dbPath` — Two Separate Paths

My analysis conflated some of these:

- `sidecarPath` — connection to the daemon (socket/TCP endpoint)
- `dbPath` — on-disk location of the LibraVDB database file

These are independent — you can run the daemon on a different host while keeping local `dbPath`.

### 9.9 Test Coverage

My analysis missed the test suite entirely. The repo has:

**Integration tests:**
- `checklist-validation.test.ts`
- `daemon-harness.ts`
- `dream-promotion.test.ts`
- `host-flow.test.ts`
- `longmemeval-benchmark.test.ts`
- `markdown-ingest.test.ts`
- `sidecar-lifecycle.test.ts`

**Unit tests:**
- `cli.test.ts`, `daemon-asset-layout.test.ts`, `dream-promotion.test.ts`
- `dream-routing.test.ts`, `durable-namespace.test.ts`, `lifecycle-hooks.test.ts`
- `markdown-ingest.test.ts`, `memory-provider.test.ts`, `memory-runtime.test.ts`
- `plugin-runtime.test.ts`, `rpc.test.ts`, `sidecar-release.test.ts`, `sidecar.test.ts`
- `slot-conflict.test.ts`

### 9.10 CI/CD (from `.github/workflows/`)

Three workflows:
- `auto-release.yml` — automatic release automation
- `github-release.yml` — GitHub release creation
- `publish.yml` — npm publish

### 9.11 Auto-Install Script

`scripts/auto-install.sh` — automated daemon + plugin install

### 9.12 Security Model (from docs/security.md)

Key points I missed or underemphasized:

1. **Untrusted-memory framing** — recalled memory is injected as **untrusted historical context** (structural design rule, not a suggestion)
2. **Supply chain** — npm package has **no `postinstall`**, no `child_process`, no install-time execution
3. **Trust boundary** — plugin is a thin client; daemon is separate operator-managed component
4. **No required network calls** for embedding or extractive compaction
5. **Cannot protect against:** compromised host, compromised machine, downstream model ignoring framing, malicious content from authorized actor
6. **GDPR** — local memory can be deleted by namespace

### 9.13 Where Stock Memory Breaks Down (from docs/problem.md)

My analysis missed the structural failure modes:

1. **Context collapse** — single-table top-k has no distinction between ephemeral session vs durable user memory
2. **No scope separation** — `session:<id>`, `turns:<userId>`, `user:<userId>`, `global` are **not interchangeable**
3. **No token budget management** — ranking and packing are one pipeline, not disconnected
4. **No automatic compaction** — raw turns → clusters → summaries → source deletion

### 9.14 Slab-Style Storage (from docs/dependencies.md)

My analysis missed the **Slab** storage layer decision:

- Vectors are fixed-size payloads
- Collections grow in bursty append patterns
- Compaction/search create allocation pressure
- Slab-backed storage makes allocation behavior **predictable**
- Trade-off: reserved-but-unused capacity (acceptable for local sidecar)

### 9.15 `index.js` at Package Root

The repo has `index.js` at root. My analysis didn't check it, but it's the package entry point that re-exports `src/index.ts` (compiled). The `pnpm check` command runs `tsc --noEmit` then `tsc -p tsconfig.tests.json && node --test .ts-build/test/unit/*.test.js`.

---

*End of analysis + supplements.*
