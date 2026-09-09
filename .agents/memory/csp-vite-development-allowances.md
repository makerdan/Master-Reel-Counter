---
name: Vite development CSP allowances
description: Vite and Replit development transforms inject inline bootstrap scripts and load the Clerk instance SDK from an accounts.dev origin.
---

Development CSP must allow Vite's inline bootstrap scripts and eval-based client, while production can remove both because the built entry page uses external scripts. The Clerk browser SDK may load from the configured `*.clerk.accounts.dev` instance rather than the proxy target.

**Why:** A strict development script policy made the preview blank and blocked Clerk initialization even though the production build remained external-script-only.

**How to apply:** When changing CSP, verify both the transformed development HTML and the built production HTML, and keep the development allowances conditional rather than broadening production sources.