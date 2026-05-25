# Contributing

Use [Development](./development.md) for source setup, local vector service preparation,
generated IPC files, and validation commands. This document covers contribution
expectations.

## Baseline Checks

Before opening a PR:

```bash
pnpm check
npm run test:integration
```

Integration tests require a running vector service or a prepared local vector service binary.
Use:

```bash
bash scripts/build-vector service.sh
```

## Behavioral Changes

If you change retrieval, compaction, or ranking behavior, add or update the
matching validation coverage and avoid weakening checks just to hide a
regression.

## PR Expectations

- Keep plugin lifecycle and vector service lifecycle separate.
- Include focused docs updates for user-visible behavior or config changes.
- Keep internal design changes reflected in the appropriate design notes.
- Do not add install-time vector service bootstrap to the npm/OpenClaw package without
  documenting the security and distribution trade-off.
