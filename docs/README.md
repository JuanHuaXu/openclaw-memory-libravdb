# LibraVDB Memory Docs

This directory holds the operational and design docs for the LibraVDB Memory
OpenClaw plugin. The root README is the public entry point; these files go
deeper by goal.

## Start Here

- [Install](./install.md) - shortest supported install and daemon lifecycle path.
- [Installation reference](./installation.md) - requirements, activation, verification, and troubleshooting.
- [Uninstall](./uninstall.md) - safe disable, daemon shutdown, package removal, and optional data cleanup.

## Understand The System

- [Problem](./problem.md) - why this plugin replaces the stock memory lifecycle.
- [Architecture](./architecture.md) - plugin, sidecar, storage, retrieval, and compaction overview.
- [Dependency rationale](./dependencies.md) - why LibraVDB and slab-style storage fit this workload.
- [Architecture decisions](./architecture-decisions/README.md) - accepted ADRs.

## Configure And Operate

- [Features](./features.md) - markdown ingestion, Obsidian ingestion, dream promotion, and memory CLI commands.
- [Security](./security.md) - trust boundaries, untrusted-memory framing, collection isolation, and deletion limits.
- [Embedding profiles](./embedding-profiles.md) - shipped embedding profile metadata and defaults.
- [Models](./models.md) - local ONNX model strategy and summarization roles.

## Advanced And Source Docs

- [Performance and tuning](./performance-and-tuning.md) - resource expectations and tuning knobs.
- [Development](./development.md) - source setup, local daemon builds, generated IPC files, and validation commands.
- [Contributing](./contributing.md) - contributor workflow and repository expectations.
