import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
const sessions = JSON.parse(await fs.readFile(process.env.SESSIONS_REPORT, "utf8"));
const channel = process.env.PROBE_CHANNEL ?? "discord";
const session = sessions.sessions.find(s => s.channel === channel);
if (!session) throw new Error("Missing selected session");
const params = { sessionKey: session.key, sessionId: session.sessionId,
  message: process.argv[2] ?? "hello", deliver: false, disableMessageTool: true, timeout: 120, idempotencyKey: randomUUID() };
const start = performance.now();
const { stdout } = await promisify(execFile)(process.execPath, [process.env.GATEWAY_CLI, "gateway", "call", "agent", "--expect-final", "--json", "--timeout", "150000", "--params", JSON.stringify(params)], { maxBuffer: 8 * 1024 * 1024 });
await fs.writeFile(process.env.PROBE_OUTPUT, stdout, { mode: 0o600 });
const response = JSON.parse(stdout);
console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - start), status: response.status, runId: response.runId, resultKeys: Object.keys(response.result ?? {}) }));
