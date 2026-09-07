import test from "node:test";
import assert from "node:assert/strict";
import { TranscriptHydration, type TranscriptReader } from "../../src/hydration-transcript.js";
import type { LibravDBClient } from "../../src/libravdb-client.js";

const scope = { tenant: "fixture", session: "session", audience: "room" };
function fixture() {
  const rows = new Map<string, any>();
  const entries = [
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
    async searchText(r: any) { return { results: [...rows.values()].map(row => ({ ...row, score: r.text === "hello" ? 0.4 : 0.85 })) }; },
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
