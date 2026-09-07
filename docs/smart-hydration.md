# Smart history hydration: TypeScript serving core

Status: isolated implementation; not registered, enabled, or deployed.
Production remains on historicalToolReplay=recall.

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

## Required adapters before production

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
the deployed rescue. No performance gain is claimed for this component yet.
