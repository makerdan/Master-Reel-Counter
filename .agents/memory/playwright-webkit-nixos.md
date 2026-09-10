---
name: Playwright WebKit on NixOS
description: Explains why WebKit browser coverage runs in Ubuntu CI rather than by default in the Replit Nix workspace.
---

Playwright's downloaded Ubuntu WebKit browser should run in canonical Ubuntu CI and remain opt-in in the Replit Nix workspace.

**Why:** The browser download expects Ubuntu-specific shared-library sonames and ABIs that the pinned Nix environment does not provide compatibly. Adding a broad `LD_LIBRARY_PATH` introduces further ABI conflicts, so a local compatibility shim is not reliable validation.

**How to apply:** Keep WebKit coverage enabled automatically in canonical Ubuntu CI. Local Nix runs may exercise Chromium by default; enable local WebKit only in an environment that can launch the Playwright-managed browser successfully.