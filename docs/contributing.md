# Contributing

Use [Development](./development.md) for source setup, local daemon preparation,
generated IPC files, and validation commands. This document covers contribution
expectations.

## Baseline Checks

Before opening a PR:

```bash
pnpm check
npm run test:integration
```

Integration tests require a running daemon or a prepared local daemon binary.
Use:

```bash
bash scripts/build-daemon.sh
```

## Behavioral Changes

If you change retrieval, compaction, or ranking behavior, add or update the
matching validation coverage and avoid weakening checks just to hide a
regression.

## PR Expectations

- Keep plugin lifecycle and daemon lifecycle separate.
- Include focused docs updates for user-visible behavior or config changes.
- Keep internal design changes reflected in the appropriate design notes.
- Do not add install-time daemon bootstrap to the npm/OpenClaw package without
  documenting the security and distribution trade-off.
