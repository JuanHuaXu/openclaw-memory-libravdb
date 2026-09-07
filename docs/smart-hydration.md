# Smart history hydration: TypeScript serving core

Status: production adapter available behind `historicalToolReplay=smart`.
`recall` remains the immediate configuration rollback.

The adapter uses OpenClaw's scoped, generation-aware transcript SDK, including
SQLite-backed sessions. Background capture stores compact descriptors and original
transcript pointers in a dedicated LibraVDB collection per tenant/session/audience.
It indexes only completed, balanced tool-backed turns. Associated reasoning can
be retrieved alongside tool results; ordinary social reasoning is not indexed.
Original messages are never rewritten. Index writes are idempotent across restart.

Semantic nomination uses `SearchText`, not lexical `RankCandidates`. The initial
conservative score gate is 0.75 (a ranking score, not a probability). A production
calibration corpus is still needed; low-scoring relevant queries can be missed.
Low-information continuation prompts can reuse the active verified frame across
social/no-op turns. Concrete new subjects displace it. Final answers and the
active user/tool exchange remain in the host transcript.

Evidence is explicitly partial: at most eight 1024-character spans, at most two
per block, prioritizing tool results. Retrieval packs at most two frames and four
spans within 16 KB and a two-second serving deadline. Beginning and terminal
transcript anchors are validated, and each returned span is hash checked. A
missing or invalid anchor never causes broad replay. This is bounded source
evidence retrieval, not the full EventFrame forecasting/learning system.

Background catch-up reads at most 256 bounded single-message pages per trigger;
later turns continue catch-up. It does not block the model waiting for ingestion.
The host retains at most 64 session adapters per runtime, evicting idle adapters
after 30 minutes when admitting another session. Post-tool continuations reuse
the same turn's packet; hydration never modifies active tool protocol.

This translates the useful serving concepts from EventFrame into TypeScript.
It neither imports eventframed nor reproduces its forecasting, posterior,
residual-learning, agency, or ontology machinery. Conceptual reference:
https://github.com/JuanHuaXu/eventframe-whitepaper/blob/b74058ab2d7eae80bbf9ef0a93f2ea11603b4127/paper.md

## Implemented

`src/smart-hydration.ts` owns the serving order:

1. Take a query, up to two eligible recent frames, and host-resolved reply IDs.
2. Nominate scoped compact frames, reserve room for one level of typed links.
3. Rerank descriptors, excluding raw tool payloads and recorded analysis.
4. Apply an explicit relevance threshold, frame/read limits, and byte budget.
5. Read only the selected original evidence references.
6. Verify scope, event, revision, byte length, and SHA-256 before injection.
7. Return escaped historical reference context and retrieval diagnostics.

Who/what/when/where/why/how fields carry observed/inferred status and source
references. The caller must supply evidence-backed descriptors; this component
does not invent a person's identity or a causal explanation from prose.
Temporal availability is distinct from the event's described date.

The byte budget includes wrapper and escaping overhead. It is deliberately not
called an exact tokenizer count. A production adapter must budget these bytes
against the actual remaining context, without silently evicting live tool
protocol. Large evidence should have independently addressable, verified spans;
the planner does not select an arbitrary prefix and call it complete evidence.

The planner never accepts or modifies the active provider transcript. Current
and unresolved exchanges stay outside this optimization. Matching similarity
does not confer instruction authority. XML escaping prevents delimiter breakout,
not semantic prompt injection or guaranteed model compliance.

## Serving contracts

### Inactivity window

`HydrationWorkingSet` is an optional RAM-only wrapper owned by one host
conversation scope. It retains at most 100 frame IDs (maximum 4096 characters
each) and their last packed user-turn ordinals. No raw evidence is cached.
The host must serialize calls and provide the same ordinal for tool steps/retries
within one user turn. Older ordinals and mismatched scopes are rejected.

A frame expires before selection on the fifth subsequent turn without packed
reuse. Selection on turn 4 after selection on turn 0 extends availability through
turn 8; it expires on turn 9 unless selected again. Nomination, weak matches, and
failed packets do not renew it. An empty greeting packet does not replay retained
evidence. A bounded dialogue classifier preserves the active frame for exact
social acknowledgements and treats short continuation acts such as "go on" as an
explicit reference. Substantive turns clear or replace that pointer. Transcript
catch-up reconstructs the same state, and a topic epoch prevents late background
capture from reviving displaced work. Repeated assembly within one user turn
reuses one packet and classification decision. Retained IDs are refreshed through
scoped `index.get`; normal nomination retains candidate capacity. Explicit
references can still rediscover expired frames from durable storage.

The host must call `clear()` on reset or dispose the instance on scope/task
replacement. Concurrent calls/reset fail explicitly. The production owner keys
instances by tenant, session and audience; transcript generations are validated
again before evidence can be returned.

- `HydrationIndex`: canonical frame nomination and reranking, with tenant,
  session/audience and as-of filtering BEFORE the candidate limit. Retrieval
  must work for paraphrases as well as exact terms. Rank scores are not assumed
  calibrated probabilities.
- `EvidenceArchive`: scoped access to original immutable records or spans,
  enforcing maximum bytes while reading and aborting underlying I/O on timeout.
- Background frame capture: bounded asynchronous processing, source-versioned
  idempotency, durable source pointers, and no raw evidence in the semantic index.
- Host adapter: resolve reply references from trusted metadata; attach the packet
  as historical context, keep current tool protocol exact, expose deferred/missing
  evidence honestly, and support explicit bounded reads for detailed follow-ups.

Do not back this with a second ad-hoc transcript database in the plugin.
Reuse original session storage and the production backend's supported indexing
contracts after validating their semantics. An unavailable adapter means no
hydrated packet, not unrestricted replay of the entire transcript.

## Evidence and limits

Thirteen focused controls cover: preserved historical analysis, empty irrelevant
selection, scope/time/live exclusion, explicit reply references, pre-read budgets,
exact evidence de-duplication, stale or corrupt references, malformed ranking,
cancellation, delimiter escaping, reranking before packing, linked corrections,
and bounded recent-query context. These test controlled retrieval responses;
they do not establish the quality of the production embedding or ranker.

Read-only production RankCandidates probes found a certificate frame for
"TLS certificates" but returned no frame for
"Why did the secure connection fail?". No fixture was inserted into production.
This falsifies treating that endpoint alone as sufficient semantic nomination;
it does not prove the backend's indexed vector search is broken.

Promotion requires real indexed-frame positive/paraphrase and greeting-negative
controls; why/continue with recent context; exact evidence recovery after restart;
wrong-participant and stale-correction controls; live post-tool continuation; and
held-out answer-quality plus cold/warm latency comparison against full replay and
the deployed rescue. Component benchmarks do not establish live Gateway latency.
