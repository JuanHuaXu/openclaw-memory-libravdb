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

## Gating Invariants

Do not weaken the gate invariants casually. The daemon-owned tests in
`libravdbd/compact/gate_test.go` check structural properties:

- empty-memory novelty
- saturation veto
- convex boundedness
- conversational collapse at `T = 0`
- technical collapse at `T = 1`
- non-overfiring conversational structure on code

If you add a new signal, it must preserve those invariants.

## Calibration Coverage

There is not yet a dedicated `gate_calibration_test.go` golden set in this
repository. Current gating correctness is enforced by the invariant suite in
`libravdbd/compact/gate_test.go`.

If you introduce new signals or change weighting behavior, add one of:

- a new invariant if the change alters a structural gate property
- a calibration or golden test if the change adds labeled examples or expected
  decompositions

Do not rewrite expectations just to make regressions disappear.

## PR Expectations

- Keep plugin lifecycle and daemon lifecycle separate.
- Include focused docs updates for user-visible behavior or config changes.
- Keep retrieval math and gating changes reflected in the appropriate design
  notes.
- Do not add install-time daemon bootstrap to the npm/OpenClaw package without
  documenting the security and distribution trade-off.
