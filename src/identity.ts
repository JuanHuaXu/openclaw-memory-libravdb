import { userInfo, hostname } from "node:os";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { LoggerLike } from "./types.js";

/**
 * Resolves the identity file path, respecting OpenClaw's state directory conventions.
 *
 * Resolution order:
 *   1. Plugin config `identityPath` override
 *   2. `OPENCLAW_STATE_DIR` env var + `/libravdb-identity.json`
 *   3. `~/.openclaw/libravdb-identity.json` (default)
 */
function resolveIdentityPath(configuredPath?: string): string {
  if (configuredPath) return configuredPath;

  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) return join(stateDir, "libravdb-identity.json");

  const home = userInfo().homedir;
  return join(home, ".openclaw", "libravdb-identity.json");
}

export type IdentitySource = "config" | "file" | "auto" | "session-key";

export type ResolvedIdentity = {
  userId: string;
  source: IdentitySource;
};

type IdentityFile = {
  userId: string;
  derivedFrom?: {
    username: string;
    hostname: string;
    homeHash: string;
    platform: string;
  };
  createdAt: string;
};

function deriveAutoId(): string {
  let username: string;
  let home: string;

  try {
    const info = userInfo();
    username = info.username;
    home = info.homedir;
  } catch {
    username =
      process.env.USER || process.env.USERNAME || process.env.LOGNAME || "anon";
    home = process.env.HOME || process.env.USERPROFILE || "unknown";
  }

  const host = hostname();
  const homeHash = createHash("sha256")
    .update(home.replace(/\\/g, "/").toLowerCase())
    .digest("hex")
    .slice(0, 8);

  return `${username}@${host}#${homeHash}`;
}

function writeIdentityFile(path: string, userId: string): void {
  const identity: IdentityFile = {
    userId,
    derivedFrom: {
      username: userInfo().username,
      hostname: hostname(),
      homeHash: createHash("sha256")
        .update(userInfo().homedir.replace(/\\/g, "/").toLowerCase())
        .digest("hex")
        .slice(0, 8),
      platform: process.platform,
    },
    createdAt: new Date().toISOString(),
  };

  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(identity, null, 2) + "\n");
  renameSync(tmp, path);
}

export function resolveIdentity(params: {
  configUserId?: string;
  identityPath?: string;
  sessionKey?: string;
  logger?: LoggerLike;
}): ResolvedIdentity {
  // 1. Plugin config override (highest priority)
  const configUserId = params.configUserId?.trim();
  if (configUserId) {
    return { userId: configUserId, source: "config" };
  }

  const filePath = resolveIdentityPath(params.identityPath);

  // 2. Identity JSON file (portable, user-editable)
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as IdentityFile;
      if (parsed.userId && typeof parsed.userId === "string") {
        const trimmed = parsed.userId.trim();
        if (trimmed.length > 0) {
          return { userId: trimmed, source: "file" };
        }
      }
    } catch (error) {
      params.logger?.warn?.(
        `LibraVDB: failed to read identity file at ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // 3. Auto-derive and persist
  try {
    const autoId = deriveAutoId();
    writeIdentityFile(filePath, autoId);
    params.logger?.info?.(
      `LibraVDB: auto-derived identity "${autoId}" written to ${filePath}`,
    );
    return { userId: autoId, source: "auto" };
  } catch {
    // 4. Last-resort: sessionKey isolation
    const fallback = params.sessionKey?.trim();
    if (fallback) {
      return { userId: `session-key:${fallback}`, source: "session-key" };
    }
    return { userId: "default", source: "session-key" };
  }
}
