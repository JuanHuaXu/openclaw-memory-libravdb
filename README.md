# ♎ LibraVDB - Memory and Context Management

<div align="center">
  <img src="./docs/assets/libravdb-logo.svg" alt="LibraVDB" width="640">
</div>

<div align="center">
  <a href="https://github.com/xDarkicex/libravdbd"><img src="https://img.shields.io/badge/Go-1.25%2B-00ADD8?logo=go&logoColor=white" alt="Go 1.25+"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.x"></a>
  <a href="./openclaw.plugin.json"><img src="https://img.shields.io/badge/OpenClaw-memory%20plugin-111827" alt="OpenClaw memory plugin"></a>
  <a href="https://www.npmjs.com/package/@xdarkicex/openclaw-memory-libravdb"><img src="https://img.shields.io/npm/v/%40xdarkicex%2Fopenclaw-memory-libravdb?label=release&color=5B21B6" alt="Release"></a>
</div>

`@xdarkicex/openclaw-memory-libravdb` is a local-first OpenClaw memory plugin
backed by the `libravdbd` vector service. It replaces the lightweight default memory
path with scoped session, user, and global memory; continuity-aware prompt
assembly; durable recall; and vector-service-owned compaction.

[Install](./docs/install.md) · [Full installation reference](./docs/installation.md) · [Architecture](./docs/architecture.md) · [Security](./docs/security.md) · [Performance and tuning](./docs/performance-and-tuning.md) · [Contributing](./docs/contributing.md)

New install? Start here: [Install guide](./docs/install.md).

## Install

Install `libravdbd` with your system package manager, then install
the OpenClaw plugin.

**macOS (Homebrew)**

```bash
brew tap xDarkicex/homebrew-openclaw-libravdb-memory
brew install libravdbd
brew services start libravdbd
```

> **After upgrades:** Always restart the vector service so the newly installed binary takes effect:
> ```bash
> # macOS (Homebrew)
> brew services restart libravdbd
>
> # Linux (systemd)
> systemctl --user restart libravdbd
>
> # Linux (no systemd — kill and restart manually)
> killall libravdbd && libravdbd &
> ```
> Failing to restart leaves the old process running — it will not auto-replace a live background service. If you see "Protocol error" or connection failures after an upgrade, this is almost always the cause.

**Linux (APT)**

```bash
curl -fsSL https://xDarkicex.github.io/apt-libravdbd/gpg.key | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/libravdbd.gpg
echo "deb https://xDarkicex.github.io/apt-libravdbd stable main" | sudo tee /etc/apt/sources.list.d/libravdbd.list
sudo apt update
sudo apt install libravdbd
systemctl --user enable --now libravdbd
```

**Linux (AUR)**

```bash
yay -S libravdbd-bin
systemctl --user enable --now libravdbd
```

**Plugin (all platforms)**

```bash
openclaw plugins install @xdarkicex/openclaw-memory-libravdb
```

This automatically configures `plugins.slots.memory` and `plugins.slots.contextEngine` to point to `libravdb-memory`, and sets up the plugin entry with defaults.

Then restart the gateway so the plugin loads:

```bash
# macOS/Linux
openclaw daemon restart

# Verify the plugin is loaded
openclaw plugins list | grep libravdb
```

Verify the service and plugin:

```bash
openclaw memory status
```

Healthy output should show `Sidecar=running`, stored memory counts, the active
gate threshold, and the loaded embedding profile.

## Quick Start

Runtime requirements:

- OpenClaw `>= 2026.3.22`
- Node.js `>= 22`
- a separately installed `libravdbd` service

Compatibility note:

- this plugin is currently verified against OpenClaw `2026.5.22`

Default endpoints:

- macOS/Linux user-local service: `unix:$HOME/.libravdbd/run/libravdb.sock`
- Homebrew service on Apple Silicon: `unix:/opt/homebrew/var/libravdbd/run/libravdb.sock`
- Windows service: `tcp:127.0.0.1:37421`

If your service runs elsewhere, set `sidecarPath`:

```json
{
  "plugins": {
    "entries": {
      "libravdb-memory": {
        "enabled": true,
        "config": {
          "sidecarPath": "tcp:127.0.0.1:37421"
        }
      }
    }
  }
}
```

## Highlights

- **Unified Cognitive Scoring** - moves beyond standard semantic search by mathematically blending cosine similarity with frequency, recency, authored salience, and cognitive authority composite weights (`ω(c)`).
- **Topological Causal Graphs** - internally models temporal memory chains via directed acyclic graphs (`WhyIDs`), injecting causal proximity into retrieval scoring to anticipate temporally connected context.
- **Zero-GC Slab Allocation** - manages model tensor and inference data via a custom contiguous slab allocator (`slabby`), completely bypassing Go garbage collection pauses during high-throughput memory assembly.
- **Deontic & Salience Retrieval** - applies structural authority weightings and deontic logic rules to ensure critical behavioral constraints mathematically outrank conversational chatter.
- **Matryoshka Representation Learning** - natively supports dynamically tiered embedding dimensions (e.g., slicing 768d vectors down to 64d) for ultra-fast cascading coarse search followed by precision reranking.
- **Cognitive Routing Circuit Breakers** - strictly monitors remote endpoint health via stateful circuit breakers that trip and safely auto-disable complex ML routing during downstream outages, preserving foundational search uptime.
- **Zero-ML Local Compaction** - evaluates contextual gating thresholds to execute purely localized session summarization and compaction cycles natively within the vector service.
- **True multi-tenancy** - routes multiple OpenClaw agents to strictly isolated, per-agent vector databases within a single lightweight vector service process.
- **Zero-copy caching** - shares a memory-mapped, cross-tenant embedding cache across all active agents to keep hardware utilization incredibly low.
- **Three memory scopes** - keeps active session, durable user, and global memory separate.
- **Local-first inference** - uses local embedding paths by default, with optional remote model configurations.
- **Operational tooling** - provides a dedicated CLI (`libravdbd status`, `migrate`, `tenant evict`) for live observability and safe health management without interrupting active sessions.
- **Explicit service lifecycle** - the npm/OpenClaw package stays connect-only; `libravdbd` is installed and supervised separately over a secure gRPC transport.

## Embedding Backend Providers

The plugin supports multiple embedding backends. Set via `embeddingBackend` in plugin config:

| Backend | Description | Config required |
|---|---|---|
| `gguf` (recommended) | Hardware-native acceleration via llama.cpp. Apple Silicon gets Metal, NVIDIA gets CUDA, everything else falls back to CPU. No ONNX Runtime dependency. | None — just `embeddingBackend: "gguf"` |
| `bundled` | ONNX build of `nomic-embed-text-v1.5`. Full-featured fallback when GGUF is unavailable. | None |
| `onnx-local` | Custom ONNX model from local assets. Requires `embeddingModelPath` and `embeddingRuntimePath`. | `embeddingModelPath`, `embeddingRuntimePath` |
| `custom-local` | Custom ONNX variant with your own assets and runtime. | `embeddingModelPath`, `embeddingRuntimePath`, `embeddingProfile` |
| `remote` | HTTP API embedder (e.g. OpenAI-compatible). Requires `embeddingEndpoint` and `embeddingRemoteModel`. | `embeddingEndpoint`, `embeddingRemoteModel` |

GGUF is the recommended default. It delivers `nomic-embed-text-v1.5` embeddings with hardware-native acceleration and no ONNX Runtime dependency. See [Embedding profiles](./docs/embedding-profiles.md) for full details.

## Security Defaults

Stored memory is treated as untrusted historical context. Retrieved memory is
framed before it reaches the downstream model, memory collections are scoped by
session/user/global namespace, and service installation is outside the npm plugin
package.

Before exposing OpenClaw over remote channels, read [Security](./docs/security.md).

## Operator Quick Refs

```bash
openclaw memory status [--deep] [--json]
openclaw memory index --force
openclaw memory search "prior context"
openclaw memory export --user-id <userId>
openclaw memory flush --user-id <userId>
openclaw memory journal --limit 50
openclaw memory dream-promote --user-id <userId> --dream-file ~/DREAMS.md
```

Use [Install](./docs/install.md) for service lifecycle commands and
[Uninstall](./docs/uninstall.md) for safe shutdown and removal.

## Configuration

All keys are optional. For the full reference, see [Configuration](./docs/configuration.md).

| Key | Type | Default | |
|---|---|---|---|
| `sidecarPath` | string | `auto` | `"auto"` probes standard paths; set `unix:/path` or `tcp:host:port` to override |
| `embeddingBackend` | string | `gguf` | Embedding backend: `gguf` (recommended), `bundled`, `onnx-local`, `custom-local`, `remote` |
| `embeddingProfile` | string | `nomic-embed-text-v1.5` | Primary embedding model |
| `fallbackProfile` | string | `bge-small-en-v1.5` | Fallback profile for dimension mismatches |
| `embeddingRuntimePath` | string | — | Required with `embeddingBackend: "onnx-local"`; path to `libonnxruntime` visible to `libravdbd` |
| `embeddingModelPath` | string | — | Required with `embeddingBackend: "onnx-local"`; directory containing `embedding.json`, `model.onnx`, and `tokenizer.json` |
| `onnxDevice` | string | `cpu` | ONNX execution provider; `cpu` is the default; `auto` lets libravdbd auto-detect |
| `userId` | string | auto-derived | Stable identity for cross-session durable memory |
| `tenantId` | string | auto-derived | Multi-tenant identifier. Resolved as `cfg.tenantId` > `LIBRAVDB_AGENT_ID` env > `userId`. Isolates the agent to a dedicated `.libravdb` file. |
| `crossSessionRecall` | boolean | `true` | When `false`, only session-scoped memories are retrieved |
| `compactSessionTokenBudget` | number | `2000` | Auto-compaction token threshold; `0` disables |

## Multi-Tenant Support

`libravdbd` supports true multi-tenancy, allowing you to run multiple OpenClaw agents on the same machine with completely isolated vector databases. By default, the plugin connects to a single-tenant database named after your `userId`.

If you want to run multiple distinct agents (e.g., a "research-agent" and a "coding-agent"), you can assign each a unique `tenantId` in the OpenClaw configuration:

```json
{
  "plugins": {
    "entries": {
      "libravdb-memory": {
        "enabled": true,
        "config": {
          "tenantId": "research-agent"
        }
      }
    }
  }
}
```

The vector service will seamlessly route the agent's requests to a dedicated, isolated vector database file. It manages all tenant instances efficiently within a single process and automatically shares a centralized, memory-mapped embedding cache to keep hardware usage incredibly low.

### Directory Structure

When running in multi-tenant mode, the vector service automatically scaffolds an isolated directory structure inside your configured `agent_db_root` (or the default profile directory). It scopes databases to the specific embedding model in use:

```text
~/.libravdbd/data_nomic-embed-text-v1_5/
├── _internal:dedupe.libravdb      # Cross-session deduplication state
├── _internal:registry.libravdb    # Tenant registry and health logs
└── agents/
    ├── research-agent.libravdb    # Isolated database for research-agent
    ├── coding-agent.libravdb      # Isolated database for coding-agent
    └── my-default-user.libravdb   # Isolated database for default user
```

### Multi-Tenant Operations

The vector service exposes tenant-aware operational commands:

```bash
# View global vector service health, cache stats, and all active tenant footprints
libravdbd status

# Evict a specific tenant from memory without shutting down the vector service
libravdbd tenant evict <tenantId>

# Safely migrate an old single-tenant DB to a named tenant
libravdbd migrate --from ~/.libravdbd/data.libravdb --tenant <tenantId>
```

## Vector Service Configuration (YAML) & Kubernetes

`libravdbd` is heavily configurable via environment variables or a YAML configuration file. The vector service looks for `config.yaml` in this order:
1. `LIBRAVDB_CONFIG=/path/to/config.yaml`
2. `/etc/libravdbd/config.yaml`
3. `~/.libravdbd/config.yaml`

Example `config.yaml` for a Kubernetes StatefulSet deployment in multi-tenant mode:

```yaml
# /etc/libravdbd/config.yaml
agent_db_root: "/var/lib/libravdbd/agents"
tenant_mode: "auto"
tenant_max_open: 128
grpc_endpoint: "tcp:0.0.0.0:9090"
embedding_backend: "gguf"
embedding_profile: "nomic-embed-text-v1.5"
drain_timeout: "25s" # Must be less than k8s terminationGracePeriodSeconds
```

## Securing gRPC with mTLS

For distributed deployments where `libravdbd` and OpenClaw run on different machines, you must secure the TCP transport using Mutual TLS (mTLS).

**1. Generate Local Certificates:**
```bash
# 1. Generate Certificate Authority (CA)
openssl req -x509 -newkey rsa:4096 -days 3650 -nodes -keyout ca.key -out ca.crt -subj "/CN=LibraVDB-CA"

# 2. Generate Vector Service Server Certificate
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=libravdbd.local"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# 3. Generate Client Certificate (For OpenClaw plugins)
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr -subj "/CN=openclaw-client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365
```

**2. Configure the Vector Service:**
Add the generated TLS paths to your vector service's `config.yaml`:
```yaml
grpc_endpoint: "tcp:0.0.0.0:9090"
grpc_tls_cert: "/etc/libravdbd/certs/server.crt"
grpc_tls_key: "/etc/libravdbd/certs/server.key"
grpc_tls_ca: "/etc/libravdbd/certs/ca.crt" # Enforces mTLS client verification
```

**3. Connect Your Client:**
Add the TLS client certificate paths to your OpenClaw plugin config in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "libravdb-memory": {
        "config": {
          "grpcEndpoint": "tcp:libravdbd.local:9090",
          "grpcEndpointTlsMode": "tls",
          "grpcEndpointTlsClientCert": "/etc/libravdbd/certs/client.crt",
          "grpcEndpointTlsClientKey": "/etc/libravdbd/certs/client.key",
          "grpcEndpointTlsCa": "/etc/libravdbd/certs/ca.crt"
        }
      }
    }
  }
}
```

The `grpcEndpointTlsCa` field is required for mTLS; the plugin will verify the server certificate against this CA. When `grpcEndpointTlsMode` is `"tls"`, plaintext and unauthenticated connections are rejected.

## Optional Features

- **Markdown ingestion** watches OpenClaw-owned markdown roots or Obsidian vaults
  and syncs eligible notes into memory. See [Features](./docs/features.md).
- **Dream promotion** promotes vetted dream diary bullets into an isolated
  `dream:{userId}` collection. See [Features](./docs/features.md).

### Dream Promotion

OpenClaw's dreaming cron writes AI-generated memory reflections to a dream diary
markdown file. The plugin can watch this file and automatically promote vetted
entries into the `dream:{userId}` durable collection managed by the vector service.

Enable by adding these config keys:

```json
{
  "plugins": {
    "entries": {
      "libravdb-memory": {
        "config": {
          "dreamPromotionEnabled": true,
          "dreamPromotionUserId": "<your-user-id>",
          "dreamPromotionDiaryPath": "~/DREAMS.md"
        }
      }
    }
  }
}
```

| Key | Type | Required | Description |
|---|---|---|---|
| `dreamPromotionEnabled` | boolean | yes | Enable the dream diary file watcher |
| `dreamPromotionUserId` | string | yes | User ID whose `dream:` collection receives promoted entries |
| `dreamPromotionDiaryPath` | string | yes | Path to the dream diary markdown file (supports `~`) |
| `dreamPromotionDebounceMs` | number | no | Debounce delay before scanning after a change (default: `150`) |

The diary file is standard markdown. Entries under a `## Deep Sleep` or
`## Dream Promotion` heading are parsed as bullet points with trailing metadata:

```markdown
## Deep Sleep
- A key insight about the user's workflow patterns {score=0.85, recall=4, unique=3}
- Another consolidated observation {score=0.72, recall=2, unique=2}

<!-- or equivalently: -->

## Dream Promotion
- A key insight about the user's workflow patterns {score=0.85, recall=4, unique=3}
- Another consolidated observation {score=0.72, recall=2, unique=2}
```

Entries are promoted to `dream:<userId>` and surfaced when the user asks
dream-related questions (e.g. "what did I dream about?").

You can also promote manually without enabling the watcher:

```bash
openclaw memory dream-promote --user-id <userId> --dream-file ~/DREAMS.md
```
- **Embedding profiles** default to `nomic-embed-text-v1.5` with `bge-small-en-v1.5`
  fallback. See [Embedding profiles](./docs/embedding-profiles.md).

## Docs By Goal

- New install: [Install](./docs/install.md), [Installation reference](./docs/installation.md)
- Understand the design: [Problem](./docs/problem.md), [Architecture](./docs/architecture.md), [ADRs](./docs/architecture-decisions/README.md)
- Configure: [Configuration](./docs/configuration.md), [TLS configuration](./docs/TLS_configuration.md), [mTLS configuration](./docs/mTLS_configuration.md), [Features](./docs/features.md), [Embedding profiles](./docs/embedding-profiles.md), [Models](./docs/models.md)
- Operate safely: [Security](./docs/security.md), [Uninstall](./docs/uninstall.md)
- Advanced operations: [Performance and tuning](./docs/performance-and-tuning.md)
- Work from source: [Development](./docs/development.md), [Contributing](./docs/contributing.md)

## From Source

```bash
pnpm install
pnpm check
bash scripts/build-daemon.sh
```

`scripts/build-daemon.sh` prepares `.daemon-bin/libravdbd` for local plugin
testing when you have a published service binary, a Homebrew service, or a local
service checkout. For the full source workflow, read [Development](./docs/development.md).

## Runtime Facts

- npm package: `@xdarkicex/openclaw-memory-libravdb`
- OpenClaw plugin id: `libravdb-memory`
- plugin kind: `memory`, `context-engine`
- minimum OpenClaw host version: `>= 2026.3.22`
- default data path: `$HOME/.libravdbd/data_nomic-embed-text-v1_5.libravdb`
- default macOS/Linux endpoint: `unix:$HOME/.libravdbd/run/libravdb.sock`
- default Windows endpoint: `tcp:127.0.0.1:37421`
