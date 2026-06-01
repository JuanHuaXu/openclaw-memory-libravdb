import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginConfig } from "./types.js";
import type { ClientGetter } from "./plugin-runtime.js";

const MEMORY_PROMPT_HEADER = [
  "## LibraVDB Memory",
  "Every turn is auto-ingested into the vector store — you do not need",
  "to explicitly save anything. Conversations are captured automatically.",
  "",
  "If the user asks about past conversations, facts, preferences, decisions,",
  "or anything they told you before — use `memory_search` to recall it.",
  "Use the results directly; do not re-search the same question.",
  "",
  "Never say \"I'll remember that,\" \"I've saved this,\" \"noted,\" or similar —",
  "these phrases suggest manual effort where none exists.",
  "",
  "**Conflict handling:** If retrieved memory contradicts newer evidence or",
  "what the user just told you, prefer the newer information. Memories can",
  "become outdated — trust what the user says now over what was stored.",
  "",
] as const;

function buildToolGuidance(availableTools: ReadonlySet<string> | undefined): string[] {
  if (!availableTools?.has("memory_search")) {
    return [];
  }

  const lines: string[] = [];

  lines.push(
    "Use `memory_search` to recall prior turns, remembered facts, preferences,",
    "decisions, and channel history. Use the results — do not re-call for the",
    "same question in the same turn.",
    ...(availableTools.has("memory_get")
      ? ["After a `memory_search` hit, use `memory_get` when exact wording or more context is needed."]
      : []),
    "",
  );

  // ── Summaries / recall (when available) ──
  const hasDescribe = availableTools.has("memory_describe");
  const hasExpand = availableTools.has("memory_expand");
  const hasGrep = availableTools.has("memory_grep");

  if (hasDescribe || hasExpand || hasGrep) {
    lines.push(
      "**Compacted summaries — recall hierarchy (cheap → expensive):**",
      "",
      "Long conversations are compacted into searchable summaries. Summary hits",
      "in search results show `[Summary sum_xxx]: [eviction cue]` — a metadata",
      "pointer listing anchors (files, tools), decisions, constraints, and signal",
      "counts. Many questions can be answered from the cue alone.",
      "",
      "**Conflict and confidence:** If newer evidence disagrees with a summary,",
      "prefer the newer evidence. Summaries are compressed context — do not",
      "guess exact commands, file paths, timestamps, or config values from a",
      "cue without expanding. Expand first or say you need to expand.",
      "",
    );

    if (hasDescribe) {
      lines.push(
        "1. `memory_describe(summaryId)` — inspect metadata only (cheap).",
        "   Returns eviction cue, child count, and source turn range.",
      );
    }
    if (hasExpand) {
      lines.push(
        "2. `memory_expand(summaryIds)` — walk the summary tree for full detail.",
        "   Large expansions delegate to a sub-agent to protect context.",
      );
    }
    if (hasGrep) {
      lines.push(
        "3. `memory_grep(pattern)` — search compacted history by text or regex.",
        "   Returns snippets with summary/turn IDs for follow-up.",
      );
    }
    lines.push("");
  }

  // ── Predictive context ──
  lines.push(
    "**Predictive memory:** The vector service pre-computes what is likely to",
    "be relevant from past conversations. When `<predictive_context>` items",
    "appear in context, they represent what the system believes the user may",
    "ask about next. If a predicted item fits naturally into the conversation,",
    "bring it up — this is the system surfacing relevant context proactively.",
    "The user does not need to ask first.",
    "",
    "LibraVDB memory is vector-backed and retrieved through tools, not files.",
    "",
  );

  return lines;
}

export function buildMemoryPromptSection(
  _getClient: ClientGetter,
  _cfg: PluginConfig,
): MemoryPromptSectionBuilder {
  return function memoryPromptSection({
    availableTools,
    citationsMode: _citationsMode,
  }): string[] {
    return [...MEMORY_PROMPT_HEADER, ...buildToolGuidance(availableTools)];
  };
}
