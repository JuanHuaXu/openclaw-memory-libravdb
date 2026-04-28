import test from "node:test";
import assert from "node:assert/strict";

import { buildContextEngineFactory } from "../../src/context-engine.js";
import type { PluginConfig, SearchResult, RecallCache } from "../../src/types.js";
import type { PluginRuntime } from "../../src/plugin-runtime.js";
import type { RpcClient } from "../../src/rpc.js";

// ---------------------------------------------------------------------------
// Fake RPC — records every call with method + params so tests can assert
// exactly what the context engine sent to the daemon.
// ---------------------------------------------------------------------------
class FakeRpc {
  public calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    switch (method) {
      case "bootstrap_session_kernel":
        return { ok: true } as T;
      case "ingest_message_kernel":
        return { ingested: true } as T;
      case "after_turn_kernel":
        return { ok: true, turnCount: 1 } as T;
      case "compact_session":
        return { ok: true, didCompact: false } as T;
      case "assemble_context_internal":
        return {
          messages: [],
          estimatedTokens: 0,
          systemPromptAddition: "",
        } as T;
      default:
        throw new Error(`unexpected rpc method: ${method}`);
    }
  }
}

function fakeRecallCache(): RecallCache<SearchResult> {
  const store = new Map<string, unknown>();
  return {
    put(entry) { store.set(entry.userId + entry.queryText, entry); },
    get(key) { return store.get(key.userId + key.queryText) as never; },
    take(key) { return store.get(key.userId + key.queryText) as never; },
    clearUser() { store.clear(); },
  };
}

function fakeRuntime(rpc: FakeRpc): PluginRuntime {
  return {
    getRpc: async () => rpc as unknown as RpcClient,
    getKernel: () => null,
    emitLifecycleHint: async () => {},
    shutdown: async () => {},
  };
}

function makeMessage(role: string, content: string, id?: string) {
  return { role, content, ...(id ? { id } : {}) };
}

// ---------------------------------------------------------------------------
// Conformance: every entrypoint path must converge on the same lifecycle hooks
// with a stable sessionId, sessionKey, and durable userId.
// ---------------------------------------------------------------------------

test("context engine bootstrap resolves config userId and passes it to daemon", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "fixed-user" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.bootstrap({ sessionId: "s1", sessionKey: "sk1" });

  const call = rpc.calls.find((c) => c.method === "bootstrap_session_kernel");
  assert.ok(call, "bootstrap_session_kernel RPC was called");
  assert.equal(call.params.sessionId, "s1");
  assert.equal(call.params.userId, "fixed-user", "userId from config is passed through");
});

test("context engine ingest resolves config userId and passes it to daemon", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "fixed-user" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.ingest({
    sessionId: "s1",
    sessionKey: "sk1",
    message: makeMessage("user", "remember this"),
  });

  const call = rpc.calls.find((c) => c.method === "ingest_message_kernel");
  assert.ok(call, "ingest_message_kernel RPC was called");
  assert.equal(call.params.sessionId, "s1");
  assert.equal(call.params.userId, "fixed-user");
  const msg = call.params.message as { content: string };
  assert.equal(msg.content, "remember this");
});

test("context engine afterTurn resolves config userId and passes it to daemon", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "fixed-user" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.afterTurn({
    sessionId: "s1",
    sessionKey: "sk1",
    messages: [makeMessage("user", "hello"), makeMessage("assistant", "hi there")],
  });

  const call = rpc.calls.find((c) => c.method === "after_turn_kernel");
  assert.ok(call, "after_turn_kernel RPC was called");
  assert.equal(call.params.sessionId, "s1");
  assert.equal(call.params.userId, "fixed-user");
  const msgs = call.params.messages as Array<unknown>;
  assert.equal(msgs.length, 2);
});

test("context engine assemble resolves config userId and passes it to daemon", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "fixed-user" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.assemble({
    sessionId: "s1",
    sessionKey: "sk1",
    messages: [makeMessage("user", "query")],
    tokenBudget: 4000,
  });

  const call = rpc.calls.find((c) => c.method === "assemble_context_internal");
  assert.ok(call, "assemble_context_internal RPC was called");
  assert.equal(call.params.sessionId, "s1");
  assert.equal(call.params.userId, "fixed-user");
});

// ---------------------------------------------------------------------------
// Identity stability: same userId across different sessions
// ---------------------------------------------------------------------------

test("identity is stable across multiple sessions with the same config userId", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "fixed-user" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  // Session A
  await engine.bootstrap({ sessionId: "session-a", sessionKey: "key-a" });
  await engine.ingest({ sessionId: "session-a", sessionKey: "key-a", message: makeMessage("user", "a1") });
  await engine.afterTurn({ sessionId: "session-a", sessionKey: "key-a", messages: [makeMessage("user", "a1")] });

  // Session B
  await engine.bootstrap({ sessionId: "session-b", sessionKey: "key-b" });
  await engine.ingest({ sessionId: "session-b", sessionKey: "key-b", message: makeMessage("user", "b1") });
  await engine.afterTurn({ sessionId: "session-b", sessionKey: "key-b", messages: [makeMessage("user", "b1")] });

  // Every call should have the same userId
  const userIds = rpc.calls
    .filter((c) => c.params.userId !== undefined)
    .map((c) => c.params.userId);
  assert.ok(userIds.length >= 2, "multiple calls with userId");
  for (const uid of userIds) {
    assert.equal(uid, "fixed-user", "userId is stable across sessions");
  }
});

// ---------------------------------------------------------------------------
// Framework-provided userId takes priority over config
// ---------------------------------------------------------------------------

test("framework-provided userId override takes priority over config userId", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "config-user" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.bootstrap({ sessionId: "s1", sessionKey: "sk1", userId: "framework-user" });

  const call = rpc.calls.find((c) => c.method === "bootstrap_session_kernel");
  assert.ok(call);
  assert.equal(call.params.userId, "framework-user", "framework-provided userId wins over config");
});

// ---------------------------------------------------------------------------
// sessionKey identity fallback: when no config userId and identity derivation
// is unavailable, sessionKey provides isolation.
// ---------------------------------------------------------------------------

test("sessionKey fallback when no config userId is set", async () => {
  const rpc = new FakeRpc();
  // No userId config, no identity file — falls back to sessionKey isolation.
  const cfg: PluginConfig = {};
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.bootstrap({ sessionId: "s1", sessionKey: "fallback-key" });

  const call = rpc.calls.find((c) => c.method === "bootstrap_session_kernel");
  assert.ok(call);
  // When no other identity is available, the resolved userId should be a
  // session-key-prefixed value from resolveIdentity's last-resort path — or
  // the OS-derived auto identity (depending on whether the identity file
  // can be written in this test environment). Either way it must be non-empty.
  const uid = call.params.userId as string;
  assert.equal(typeof uid, "string");
  assert.ok(uid.length > 0, "userId is never empty");
});

// ---------------------------------------------------------------------------
// sessionId is always passed through
// ---------------------------------------------------------------------------

test("sessionId is non-empty in every lifecycle hook across bootstrap/ingest/afterTurn", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "u1" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  const sessionId = "conformance-session-1";
  await engine.bootstrap({ sessionId, sessionKey: "sk" });
  await engine.ingest({ sessionId, sessionKey: "sk", message: makeMessage("user", "m1") });
  await engine.afterTurn({ sessionId, sessionKey: "sk", messages: [makeMessage("user", "m1")] });

  const lifecycleCalls = rpc.calls.filter(
    (c) => c.method === "bootstrap_session_kernel" ||
          c.method === "ingest_message_kernel" ||
          c.method === "after_turn_kernel",
  );
  assert.equal(lifecycleCalls.length, 3, "bootstrap, ingest, and afterTurn all fired");
  for (const call of lifecycleCalls) {
    assert.equal(call.params.sessionId, sessionId);
  }
});

// ---------------------------------------------------------------------------
// Heartbeat messages are forwarded with the flag
// ---------------------------------------------------------------------------

test("ingest forwards isHeartbeat flag to the daemon", async () => {
  const rpc = new FakeRpc();
  const cfg: PluginConfig = { userId: "u1" };
  const engine = buildContextEngineFactory(fakeRuntime(rpc), cfg, fakeRecallCache());

  await engine.ingest({
    sessionId: "s1",
    message: makeMessage("user", "heartbeat check"),
    isHeartbeat: true,
  });

  const call = rpc.calls.find((c) => c.method === "ingest_message_kernel");
  assert.ok(call);
  assert.equal(call.params.isHeartbeat, true);
});
