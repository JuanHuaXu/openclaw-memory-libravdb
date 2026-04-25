import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerMemoryCli } from "./cli.js";
import { buildContextEngineFactory } from "./context-engine.js";
import { createBeforeResetHook, createSessionEndHook } from "./lifecycle-hooks.js";
import { createDreamPromotionHandle } from "./dream-promotion.js";
import { createMarkdownIngestionHandle } from "./markdown-ingest.js";
import { buildMemoryPromptSection } from "./memory-provider.js";
import { buildMemoryRuntimeBridge } from "./memory-runtime.js";
import { createRecallCache } from "./recall-cache.js";
import { createPluginRuntime } from "./plugin-runtime.js";
import type { PluginConfig, SearchResult } from "./types.js";

export default definePluginEntry({
  id: "libravdb-memory",
  name: "LibraVDB Memory",
  description: "Persistent vector memory with three-tier hybrid scoring",
  kind: ["memory", "context-engine"],

  register(api: OpenClawPluginApi) {
    // Gate all heavy runtime work on "full" mode.
    // This prevents sidecar startup, RPC calls, and exclusive API registration
    // from firing during lightweight modes like `openclaw --help` (cli-metadata).
    const isFullMode = (api.registrationMode as string) === "full";
    if (!isFullMode) return;

    const cfg = api.pluginConfig as PluginConfig;

    // Exclusive slot check: refuse to register if another plugin owns the memory slot.
    // plugins.slots.memory is the only configurable slot; context engine exclusivity
    // is enforced by the registry at runtime (no config surface for it).
    const memSlot = api.config?.plugins?.slots?.memory;
    if (memSlot && memSlot !== "libravdb-memory") {
      throw new Error(
        `[libravdb-memory] plugins.slots.memory is "${memSlot}". ` +
        `Set it to "libravdb-memory" before enabling this plugin.`,
      );
    }

    const recallCache = createRecallCache<SearchResult>();
    const runtime = createPluginRuntime(cfg, api.logger ?? console);

    // CLI commands are registered below via registerMemoryCli (calls api.registerCli
    // internally). That call happens here in full mode too, which is fine — CLI
    // registration is cheap and safe to repeat.

    registerMemoryCli(api, runtime, cfg, api.logger ?? console);

    // Migrated from three legacy calls to a single registerMemoryCapability.
    // The underlying builders (buildMemoryPromptSection, buildMemoryRuntimeBridge)
    // return types that structurally match MemoryPluginCapability fields exactly,
    // so zero behavior change — just grouping.
    api.registerMemoryCapability("libravdb-memory", {
      promptBuilder: buildMemoryPromptSection(runtime.getRpc, cfg, recallCache),
      runtime: buildMemoryRuntimeBridge(runtime.getRpc, cfg),
    });

    api.registerContextEngine(
      "libravdb-memory",
      () => buildContextEngineFactory(runtime, cfg, recallCache, api.logger ?? console),
    );

    // Start background services (markdown ingestion + dream promotion).
    // Failures are non-fatal — log and continue so the plugin remains usable.
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
  },
});