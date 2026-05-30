import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginConfig } from "./types.js";
import type { ClientGetter } from "./plugin-runtime.js";

const MEMORY_PROMPT_HEADER = [
  "## Memory",
  "LibraVDB persistent memory is configured. Every turn is auto-ingested",
  "into the vector store — you do not need to explicitly save anything.",
  "When asked about past conversations, facts, preferences, decisions,",
  "or anything the user might have told you before, call `memory_search`",
  "once per user question. Do not answer from memory until you have",
  "called it. Once you have results, use them — do not re-call.",
  "",
] as const;

function buildToolGuidance(availableTools: ReadonlySet<string> | undefined): string[] {
  if (!availableTools?.has("memory_search")) {
    return [];
  }
  return [
    "Call `memory_search` once per user question for prior turns, remembered",
    "facts, earliest interactions, and channel history. Do not answer memory",
    "questions from prior transcript claims — perform a search every time.",
    "After receiving results, use them directly; do not re-call in the same turn.",
    "For earliest or oldest questions, request enough results and compare timestamps.",
    ...(availableTools.has("memory_get")
      ? ["After a `memory_search` hit, call `memory_get` when exact wording or more context is needed."]
      : []),
    "LibraVDB memory is vector-backed and retrieved through tools, not files.",
    "",
  ];
}

export function buildMemoryPromptSection(
  _getClient: ClientGetter,
  _cfg: PluginConfig,
): MemoryPromptSectionBuilder {
  return function memoryPromptSection({
    availableTools,
    citationsMode: _citationsMode,
  }): string[] {
    // OpenClaw builds the memory prompt section synchronously for embedded runs.
    // Actual retrieval and ranking happen in the context engine during assemble().
    return [...MEMORY_PROMPT_HEADER, ...buildToolGuidance(availableTools)];
  };
}
