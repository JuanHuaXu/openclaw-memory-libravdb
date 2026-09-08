import test from "node:test";
import assert from "node:assert/strict";
import { classifyHydrationPrompt, TranscriptHydration, type TranscriptReader } from "../../src/hydration-transcript.js";
import type { LibravDBClient } from "../../src/libravdb-client.js";

const scope = { tenant: "fixture", session: "session", audience: "room" };
function fixture() {
  const rows = new Map<string, any>();
  const entries: any[] = [
    { entryId: "u", message: { role: "user", content: "Investigate the connection failure" } },
    { entryId: "call", message: { role: "assistant", content: [{ type: "toolCall", id: "t", name: "lookup" }] } },
    { entryId: "result", message: { role: "toolResult", toolCallId: "t", content: [{ type: "text", text: "Certificate expired yesterday; renewed today." }] } },
    { entryId: "final", createdAt: "2026-01-01T00:00:00Z", message: { role: "assistant", stopReason: "stop", content: "Renewing TLS certificates restored the connection." } },
    { entryId: "next", message: { role: "user", content: "hello" } },
  ];
  let reset = false;
  const read: TranscriptReader = async ({ cursor, maxBytes, maxMessages }) => {
    assert.ok(maxBytes <= 1048576); assert.equal(maxMessages, 1);
    if (reset) return { kind: "reset", cursor: "0" };
    const i = Number(cursor ?? 0);
    return { kind: "page", cursor: String(i + 1), entries: entries.slice(i, i + 1), hasMore: i + 1 < entries.length };
  };
  const client = {
    async ensureCollections() { return { ok: true }; },
    async insertText(r: any) {
      const metadata = JSON.parse(Buffer.from(r.metadataJson).toString());
      const { tenant, session, audience } = metadata.frame.scope;
      metadata.frame.scope = { audience, session, tenant };
      rows.set(r.id, { ...r, metadataJson: Buffer.from(JSON.stringify(metadata)) }); return { ok: true };
    },
    async searchText(r: any) {
      const relevant = /connection|tls|secure/i.test(r.text);
      return { results: [...rows.values()].map(row => ({ ...row, score: relevant ? 0.85 : 0.4 })) };
    },
    async listByMeta(r: any) { return { results: [...rows.values()].filter(row => row.id === r.value) }; },
  } as unknown as LibravDBClient;
  const make = (s = scope) => new TranscriptHydration(s, client, read, text => text);
  return { rows, entries, make, invalidate() { reset = true; } };
}

test("transcript hydration survives replacement and returns original evidence only on related queries", async () => {
  const f = fixture(); const first = f.make(); await first.refresh(); await first.close();
  assert.equal(f.rows.size, 1);
  assert.ok(![...f.rows.values()][0].text.includes("expired yesterday"));
  const second = f.make();
  const related = await second.hydrate("Why did the secure connection fail?", "turn1", 16000);
  assert.equal(related.status, "ok"); assert.match(related.context, /expired yesterday/);
  assert.equal((await second.hydrate("hello", "turn2", 16000)).context, "");
  await second.close();
});

test("cross-scope and replaced transcript anchors never supply hydration", async () => {
  const f = fixture(); const session = f.make(); await session.refresh();
  const foreign = f.make({ ...scope, audience: "other" });
  assert.equal((await foreign.hydrate("TLS", "1", 16000)).context, "");
  f.invalidate();
  assert.equal((await session.hydrate("TLS", "1", 16000)).context, "");
  await session.close(); await foreign.close();
});

test("unresolved and mismatched tool protocols never become historical evidence", async () => {
  const f = fixture(); f.entries[2].message.toolCallId = "wrong";
  const session = f.make(); await session.refresh(); assert.equal(f.rows.size, 0); await session.close();
});

test("excluded nested-tool bookkeeping does not invalidate a completed tool turn", async () => {
  const f = fixture();
  f.entries.splice(2, 0, { entryId: "nested", message: { role: "custom", customType: "openclaw.nested-tool.v1",
    display: true, excludeFromContext: true, content: "" } });
  const session = f.make(); await session.refresh(); assert.equal(f.rows.size, 1); await session.close();
});

test("unknown or content-bearing custom messages still invalidate tool turns", async () => {
  for (const message of [
    { role: "custom", customType: "unknown", display: true, excludeFromContext: true, content: "" },
    { role: "custom", customType: "openclaw.nested-tool.v1", display: true, excludeFromContext: true, content: "instructions" },
  ]) {
    const f = fixture(); f.entries.splice(2, 0, { entryId: "custom", message });
    const session = f.make(); await session.refresh(); assert.equal(f.rows.size, 0); await session.close();
  }
});

test("a changed terminal answer invalidates the stored descriptor", async () => {
  const f = fixture(); const session = f.make(); await session.refresh();
  f.entries[3].message.content = "The previous answer was withdrawn.";
  assert.equal((await session.hydrate("TLS", "1", 16000)).context, "");
  await session.close();
});

test("social reasoning without a tool exchange is not indexed as research", async () => {
  const f = fixture(); f.entries.splice(1, 2);
  const session = f.make(); await session.refresh(); assert.equal(f.rows.size, 0); await session.close();
});

test("social turns preserve active work and low-information continuation restores it", async () => {
  const f = fixture(); const session = f.make(); await session.refresh();
  assert.equal((await session.hydrate("hello", "1", 16000)).context, "");
  assert.match((await session.hydrate("continue", "2", 16000)).context, /expired yesterday/);
  await session.close();
});

test("inactive discourse frames expire before the fifth later user turn", async () => {
  const f = fixture(); const session = f.make(); await session.refresh();
  for (const [key, text] of [["1", "hello"], ["2", "thanks"], ["3", "okay"], ["4", "cool"]])
    assert.equal((await session.hydrate(text, key, 16000)).context, "");
  assert.equal((await session.hydrate("continue", "5", 16000)).context, "");
  await session.close();
});

test("a substantive topic change displaces active work", async () => {
  const f = fixture(); const session = f.make(); await session.refresh();
  assert.equal((await session.hydrate("hello", "1", 16000)).context, "");
  assert.equal((await session.hydrate("start a database migration", "2", 16000)).context, "");
  assert.equal((await session.hydrate("continue", "3", 16000)).context, "");
  await session.close();
});

test("transcript catch-up does not reactivate tool work displaced by later discussion", async () => {
  const f = fixture(); f.entries[4].message.content = "start a database migration";
  const session = f.make(); await session.refresh();
  assert.equal((await session.hydrate("continue", "1", 16000)).context, "");
  await session.close();
});

test("continuation intent is a bounded dialogue class, not a substring match", () => {
  assert.equal(classifyHydrationPrompt("Go on."), "continuation");
  assert.equal(classifyHydrationPrompt("okay!"), "social");
  assert.equal(classifyHydrationPrompt("Continue the database migration"), "substantive");
  assert.equal(classifyHydrationPrompt("This is a great migration plan"), "substantive");
});

test("repeated assembly for one user turn reuses the first bounded decision", async () => {
  const f = fixture(); const session = f.make(); await session.refresh();
  const first = await session.hydrate("Why did the TLS connection fail?", "same-turn", 16000);
  const repeated = await session.hydrate("hello", "same-turn", 16000);
  assert.equal(repeated, first);
  assert.match(repeated.context, /expired yesterday/);
  await session.close();
});

test("long transcript catch-up reaches recent work without requiring user turns", async () => {
  const f = fixture();
  f.entries.unshift(...Array.from({ length: 260 }, (_, i) => ({
    entryId: `old-${i}`, message: { role: i % 2 ? "assistant" : "user", content: i % 2 ? "ack" : `old subject ${i}` },
  })));
  const session = f.make(); await session.refresh();
  assert.equal(f.rows.size, 0, "the first page batch does not reach the tool frame");
  for (let attempt = 0; attempt < 10 && f.rows.size === 0; attempt++)
    await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.rows.size, 1);
  assert.match((await session.hydrate("continue", "1", 16000)).context, /expired yesterday/);
  await session.close();
});
