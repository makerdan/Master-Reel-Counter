# Threat Model

## Project Overview

Master Reel Counter is a warehouse inventory application for tracking wire reels across counting sessions with photos, annotations, exports, collaboration, review workflows, AI label scanning, and tester access. The production stack is a React/Vite client, an Express API server, PostgreSQL via Drizzle ORM, Replit Auth (OIDC) for primary authentication, Replit Object Storage for files, WebSockets for realtime collaboration, and OpenAI APIs for OCR/chat features.

This threat model is production-scoped. Only code paths reachable in a production deployment are in scope. Mockup or dev-only code is out of scope unless production reachability is demonstrated. Traffic encryption is provided by the deployment platform.

## Assets

- **User accounts and authenticated sessions** — Replit Auth sessions, tester sessions, approval state, and collaboration roles. Compromise enables impersonation and unauthorized access to warehouse session data.
- **Warehouse counting data** — sessions, entries, pins, comments, review responses, exports, and activity history. This is the core business data and may include operationally sensitive inventory details.
- **Uploaded media and derived artifacts** — session photos, avatars, logos, OCR crops/results, and exported files. These may contain facility layouts, labels, inventory identifiers, and employee annotations.
- **Application secrets and integration credentials** — database credentials, session secret, object-storage credentials, and OpenAI API credentials. Exposure would expand compromise beyond a single user account.
- **Service availability and storage budget** — OCR, export, upload, and storage-heavy endpoints can be abused to consume CPU, memory, third-party quotas, or object-storage capacity.

## Trust Boundaries

- **Browser to Express API** — all client input is untrusted. Authentication, authorization, and input validation must be enforced server-side.
- **Browser to WebSocket server** — realtime messages cross a separate protocol boundary and must not trust client-supplied identity or room membership claims.
- **Express to PostgreSQL** — the API has broad access to persistent application data; query scoping and authorization checks are critical.
- **Express to Object Storage** — the backend can create upload URLs and serve private files; object ownership and ACL enforcement are required.
- **Express to external AI services** — OCR/chat routes send selected content to OpenAI and consume paid API resources.
- **Public to authenticated to admin** — login and a small set of public endpoints exist alongside authenticated business routes and owner-only admin functionality.
- **Primary users to testers** — tester access is intentionally weaker than full account ownership and must not permit settings/admin actions or lateral movement beyond the owner’s data.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/routes.ts`, `server/replit_integrations/auth/replitAuth.ts`, `server/replit_integrations/auth/routes.ts`, `server/replit_integrations/object_storage/routes.ts`, `server/storage.ts`
- **Highest-risk areas:** websocket collaboration in `server/routes.ts`; upload/download and object-storage helpers; tester login and collaboration/invite flows; export and AI-processing endpoints
- **Public surfaces:** `/api/login`, `/api/callback`, `/api/logout`, `/api/auth/tester-login`, `/api/auth/tester-logout`, `/api/uploads/request-url`, `/ws`
- **Authenticated/admin surfaces:** most `/api/*` routes in `server/routes.ts`; `/uploads/:filename`; `/objects/{*objectPath}`; `/api/admin/*`
- **Usually out of scope unless reachability is proven:** `.agents/`, `attached_assets/`, mockup/dev-only code, and unregistered route modules under `server/replit_integrations/chat/*`, `audio/*`, and `image/*`

## Threat Categories

### Spoofing

The application relies on Replit Auth for primary users and a custom tester-login path for delegated access. The server must bind every protected HTTP and WebSocket action to the authenticated server-side identity rather than trusting client-supplied usernames, IDs, or role hints. Tester sessions must remain clearly separated from owner/admin capabilities.

Required guarantees:
- All protected HTTP endpoints MUST derive actor identity from the authenticated session on the server.
- WebSocket connections and room joins MUST be authenticated and authorized server-side before session data is exposed.
- Tester login MUST use strong password hashing and bounded online guessing resistance.

### Tampering

Clients can create and modify sessions, entries, pins, comments, reviews, and collaboration state. The backend must prevent unauthorized modification, server-calculate sensitive state transitions, and validate uploaded content metadata instead of trusting client claims.

Required guarantees:
- Session, photo, pin, entry, comment, and review mutations MUST verify access against the target session on the server.
- Role checks (owner/editor/viewer/tester) MUST be enforced server-side for every state-changing action.
- Upload and object-storage flows MUST validate file type/size and constrain where data can be written.

### Information Disclosure

The app stores photos, comments, review data, activity trails, collaborator identities, and exportable warehouse records. Leakage can occur through IDORs, websocket subscriptions, object-storage reads, overbroad API responses, or logging. Realtime and file-serving paths are especially sensitive because they can bypass the normal REST authorization model if not checked carefully.

Required guarantees:
- Session-scoped data MUST only be returned to authorized owners/collaborators/testers for that session.
- Private object storage paths MUST enforce object-level access control before files are served.
- Logs and error responses MUST avoid exposing secrets, plaintext sensitive data, or unnecessary internals to unauthorized parties.

### Denial of Service

The application exposes upload, OCR, export, and realtime features that can be computationally or financially expensive. Public or weakly protected routes could be abused to consume storage, API quotas, or server resources.

Required guarantees:
- Public and expensive endpoints MUST have authentication where appropriate, plus rate and size limits.
- File uploads MUST enforce bounded request sizes and avoid granting arbitrary large direct-to-storage writes to anonymous callers.
- External API calls and export workloads MUST remain bounded enough that one user cannot easily degrade service for others.

### Elevation of Privilege

The most likely privilege-escalation risks are broken object- or session-level authorization, trusting client-controlled identity fields on realtime channels, and improper separation between regular users, collaborators, testers, and the app owner.

Required guarantees:
- Authorization decisions MUST be based on server-owned session state and database lookups, not client assertions.
- Session IDs, object paths, invite tokens, and other references MUST not be sufficient on their own to grant access.
- Admin routes MUST remain restricted to the configured app owner.
