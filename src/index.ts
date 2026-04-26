import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerMemoryCli } from "./cli.js";
import { registerMemoryCliMetadata } from "./cli-descriptors.js";
import { buildContextEngineFactory } from "./context-engine.js";
import { createBeforeResetHook, createSessionEndHook } from "./lifecycle-hooks.js";
import { createDreamPromotionHandle } from "./dream-promotion.js";
import { createMarkdownIngestionHandle } from "./markdown-ingest.js";
import { buildMemoryPromptSection } from "./memory-provider.js";
import { buildMemoryRuntimeBridge } from "./memory-runtime.js";
import { createRecallCache } from "./recall-cache.js";
import { createPluginRuntime } from "./plugin-runtime.js";
import type { PluginConfig, SearchResult } from "./types.js";

export const MEMORY_ID = "libravdb-memory";

export function register(api: OpenClawPluginApi) {
  if (api.registrationMode === "cli-metadata") {
    registerMemoryCliMetadata(api);
    return;
  }

  const isFullMode = (api.registrationMode as string) === "full";
  const cfg = api.pluginConfig as PluginConfig;

  // Null in non-full mode: cli.ts skips action handlers when runtime is null.
  const runtimeOrNull = isFullMode
    ? createPluginRuntime(cfg, api.logger ?? console)
    : null;
  registerMemoryCli(api, runtimeOrNull, cfg, api.logger ?? console);

  if (!isFullMode) return;

  // TypeScript can't narrow through the ternary, so re-bind and guard.
  const runtime = runtimeOrNull;
  if (!runtime) return; // unreachable but satisfies the type checker

  const recallCache = createRecallCache<SearchResult>();

  // Exclusive slot check: refuse to register if another plugin owns the memory slot.
  // plugins.slots.memory is the only configurable slot; context engine exclusivity
  // is enforced by the registry at runtime (no config surface for it).
  // "none" means memory is disabled, not a conflict, allow registration.
  const memSlot = api.config?.plugins?.slots?.memory;
  if (memSlot && memSlot !== MEMORY_ID && memSlot !== "none") {
    throw new Error(
      `[libravdb-memory] plugins.slots.memory is "${memSlot}". ` +
        `Set it to "libravdb-memory" before enabling this plugin.`,
    );
  }

  // Migrated from three legacy calls to a single registerMemoryCapability.
  api.registerMemoryCapability(MEMORY_ID, {
    promptBuilder: buildMemoryPromptSection(runtime.getRpc, cfg, recallCache),
    runtime: buildMemoryRuntimeBridge(runtime.getRpc, cfg),
  });

  api.registerContextEngine(
    MEMORY_ID,
    () => buildContextEngineFactory(runtime, cfg, recallCache, api.logger ?? console),
  );

  const markdownIngestion = createMarkdownIngestionHandle(cfg, runtime.getRpc, api.logger ?? console);
  const dreamPromotion = createDreamPromotionHandle(cfg, runtime.getRpc, api.logger ?? console);

  void markdownIngestion.start().catch((error) => {
    api.logger?.warn?.(`LibraVDB markdown ingestion failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });
  void dreamPromotion.start().catch((error) => {
    api.logger?.warn?.(`LibraVDB dream promotion failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });

  api.on("before_reset", createBeforeResetHook(runtime, api.logger ?? console));
  api.on("session_end", createSessionEndHook(runtime, api.logger ?? console));
  api.on("gateway_stop", async () => {
    await dreamPromotion.stop();
    await markdownIngestion.stop();
    await runtime.shutdown();
  });
}

export default definePluginEntry({
  id: MEMORY_ID,
  name: "LibraVDB Memory",
  description: "Persistent vector memory with three-tier hybrid scoring",
  kind: ["memory", "context-engine"],

  register,
});
