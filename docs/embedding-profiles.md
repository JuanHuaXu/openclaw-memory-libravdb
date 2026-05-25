# Embedding Profiles

The plugin uses `embeddingProfile` for named local model metadata defaults.

Default selection baseline:

- default embedding profile: `nomic-embed-text-v1.5`
- bundled fallback profile: `bge-small-en-v1.5`

Why:

- Nomic is the default because its Matryoshka-trained embeddings deliver significantly higher retrieval accuracy than MiniLM, with principled dimensionality tiering (`64d → 256d → 768d`) that lets the vector service trade memory for precision without re-embedding.
- bge-small-en-v1.5 is the fallback for resource-constrained systems and is automatically selected when the primary model's dimensions do not match the active collection.
- Intel Macs without reliable Metal/MPS support should set `onnxDevice: "cpu"` to force CPU ONNX execution and bypass CoreML.

Current shipped profile names:

- `nomic-embed-text-v1.5`
  - family: `nomic-embed-text-v1.5`
  - dimensions: `768`
  - normalize: `true`
  - max context tokens: `8192`

- `bge-small-en-v1.5`
  - family: `bge-small-en-v1.5`
  - dimensions: `384`
  - normalize: `true`
  - max context tokens: `512`

How it works:

- `embeddingProfile` supplies metadata defaults like family, dimensions, and normalize behavior.
- `onnx-local` still requires local model assets through `embeddingModelPath`, typically a directory containing `embedding.json`.
- The manifest may override or refine the profile, but explicit dimension mismatches fail closed.
- The vector service store persists an embedding fingerprint, so reopening an existing store with a different effective model profile will fail instead of silently mixing vector spaces.
- `onnxDevice` is passed through as `LIBRAVDB_ONNX_DEVICE` for vector service versions that support execution-provider selection (`auto`, `cpu`, `cuda`, `coreml`, `directml`, `openvino`).

## Store Compatibility and Upgrades

The persisted embedding fingerprint is part of the database compatibility check.
That is intentional: if a vector service opens a store with a different effective model
profile, the safest outcome is to stop before mixing vector spaces.

When updating `libravdbd`, keep the same effective embedding profile unless you
intend to rebuild the store. The effective profile includes the profile family,
dimensions, normalization setting, and any metadata supplied by the model
manifest or vector service defaults.

Legacy local setups can be more fragile than the current packaged profiles. For
example, older `all-minilm-l6-v2` stores may fail to reopen after a vector service update
if the vector service now computes different metadata for that local profile. This does
not imply that current packaged `nomic-embed-text-v1.5` or
`bge-small-en-v1.5` stores are incompatible; it means the old local profile must
be treated as a separate vector space unless a migration path is provided.

If a vector service update reports that the database format or embedding profile is
incompatible:

1. back up both the `.libravdb` file and its `.embedding.json` metadata file;
2. either downgrade to the previous vector service that created the store, or move the
   old store aside and let the new vector service initialize a fresh database;
3. rebuild/reingest memories with the new effective embedding profile.

Do not delete the old store until the replacement has been verified.

Recommended usage:

- `bundled` for the shipped default path, which uses `nomic-embed-text-v1.5`.
- `onnx-local` plus `embeddingProfile` when a power user wants a known model family with local assets.
- treat remote/Ollama providers as future separate backend types, not as overloads of `custom-local`.
