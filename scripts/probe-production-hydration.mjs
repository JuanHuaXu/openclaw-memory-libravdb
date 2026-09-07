import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createPluginRuntime } from "../dist/plugin-runtime.js";
import { TranscriptHydration } from "../dist/hydration-transcript.js";
import { resolveIdentity } from "../dist/identity.js";
import { normalizeKernelContent } from "../dist/context-engine.js";
const host = createRequire(process.env.HOST_PACKAGE);
const { readSessionTranscriptVisibleMessageDelta } = await import(pathToFileURL(host.resolve("openclaw/plugin-sdk/session-transcript-runtime")));
const config = JSON.parse(await fs.readFile(process.env.BENCH_CONFIG, "utf8"));
const cfg = config.plugins.entries["libravdb-memory"].config;
const sessions = JSON.parse(await fs.readFile(process.env.SESSIONS_REPORT, "utf8"));
const session = sessions.sessions.find(s => s.channel === "discord");
if (!session) throw new Error("No test session selected");
const runtime = createPluginRuntime(cfg, { warn() {}, error() {} });
let adapter;
try {
  const client = await runtime.getClient();
  const identity = resolveIdentity({ configUserId: cfg.userId, identityPath: cfg.identityPath, sessionKey: session.key, noAutoPersist: true });
  adapter = new TranscriptHydration({ tenant: identity.userId, session: session.sessionId, audience: session.key }, client, readSessionTranscriptVisibleMessageDelta, s => normalizeKernelContent(s, { retainOpenClawContext: false }));
  const start = performance.now(); await adapter.refresh();
  console.log(JSON.stringify({ captureMs: performance.now() - start }));
  const result = await adapter.hydrate("hello", "probe-only", 16000);
  console.log(JSON.stringify({ status: result.status, frames: result.selectedIds.length, bytes: Buffer.byteLength(result.context), ms: result.elapsedMs }));
  assert.equal(result.context, "", "Greeting must not hydrate research");
  const listed = await client.listCollection({ collection: adapter.collection });
  let removed = 0; let query;
  for (const id of listed.ids) {
    const r = await client.listByMeta({ collection: adapter.collection, key: "frameId", value: id });
    const record = r.results[0]; if (!record) continue;
    const meta = JSON.parse(Buffer.from(record.metadataJson).toString());
    const expectedId = createHash("sha256").update(JSON.stringify([meta.anchor?.entryId, meta.terminal?.entryId, meta.anchor?.cursor, meta.terminal?.cursor, meta.terminalDigest])).digest("hex");
    if (id !== expectedId || !meta.frame?.evidence?.some(ref => ref.kind === "tool-result")) {
      if (process.env.CLEANUP_OLD_HYDRATION === "true") { await client.deleteText({ collection: adapter.collection, id }); removed++; }
    } else query ??= meta.frame.fields.what.value;
  }
  console.log(JSON.stringify({ indexedFrames: listed.ids.length - removed, removedPreflightOnlyFrames: removed }));
  if (!query) throw new Error("No tool-backed frame available for production positive control");
  const hit = await adapter.hydrate(query, "probe-positive", 16000);
  console.log(JSON.stringify({ positiveStatus: hit.status, frames: hit.selectedIds.length, reads: hit.hydratedIds.length, bytes: Buffer.byteLength(hit.context), ms: hit.elapsedMs }));
  assert.ok(hit.hydratedIds.length, "Original research evidence must be recovered");
} finally { await adapter?.close(); await runtime.shutdown(); }
