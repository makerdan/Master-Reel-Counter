---
name: TypeScript test compiler boundary
description: Compiler settings needed to typecheck Node test files that run through tsx/esm in this repository.
---

Use an ES2022 target with ESNext modules and Bundler module resolution for the TypeScript test boundary. The tests run through `tsx/esm` and import application files using the repository's extensionless ESM style; NodeNext resolution rejects those imports and produces unrelated source errors.

**Why:** The runtime test loader accepts the existing application import style, while NodeNext's mandatory extension rules do not.

**How to apply:** Extend the application tsconfig, override its test-file exclusion, include the TypeScript test files that registered validation executes, and keep Node types enabled.