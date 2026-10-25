# Master Reel Counter

A full-stack warehouse **wire reel counting** application for photo-based inventory, collaborative sessions, and rich export workflows. Designed for industrial environments with mobile-first capture, offline support, and AI-assisted label scanning.

## Overview

Master Reel Counter helps warehouse teams track wire reels across pallet sections using a combination of photo annotation, manual data entry, and automated AI label recognition. It is built for operations managers, inventory specialists, and technicians who need accurate, auditable reel counts with real-time collaboration and robust export options.

The application focuses on practical warehouse usage: mobile capture, industrial aesthetic, offline queues, role-based collaboration, and detailed summary statistics to monitor data quality and activity over time.

## Features

- **Session Management**
  - Create, duplicate, move, and organize **counting sessions**.
  - Soft delete (trash) for sessions via a `deletedAt` timestamp.
  - Trashed sessions are restorable within 30 days or permanently deletable.
  - Background interval auto-purges expired trash hourly.
  - Dashboard “Trash” toggle to view, restore, or permanently delete trashed sessions.

- **Folder Management**
  - Folder-level organization for sessions.
  - Soft delete (trash) for folders with a `deletedAt` column.
  - Deleting a folder moves it to trash and returns its sessions to the main list.
  - Trashed folders can be restored or permanently deleted from the existing trash view.
  - `getUserFolders` filters out soft-deleted folders.

- **Entry Management**
  - Manual entry of reel data with **category autocomplete** from a client-side wire catalog (~180 hardcoded entries).
  - Auto-calculation of total footage.
  - Quick entry panels for fast data capture.

- **Photo Management**
  - Photo annotation with **pin placement** on wire reels.
  - Background uploads and **offline photo queue** using IndexedDB.
  - Per-photo pin scaling, notes, and nearby photo viewer.
  - Photos and user avatars stored in **Replit Object Storage**.
  - Photo rotations are persisted and applied to exports.

- **Collaboration**
  - Real-time collaborative sessions using WebSockets.
  - Role-based permissions: **owner**, **editor**, **viewer**.
  - Multiple invitation methods and online presence tracking.
  - Real-time sync of pins and AI Scanner results across collaborators.

- **Data Export**
  - **PDF export** with:
    - Cover page
    - Clickable Table of Contents
    - Page numbers
    - Enhanced photo captions
    - Grand totals
    - Full or standard quality options
  - **Excel (.xlsx) export** via ExcelJS with:
    - Styled tables
    - Wire-type grouping
    - Audit trails

- **AI Label Scanner**
  - Dedicated tab powered by **OpenAI Vision (gpt-4o)** for reading wire reel labels from photo crops.
  - Batch analysis and client-side fuzzy matching against the wire catalog.
  - Draft and committed pins with real-time sync.
  - Receiving pooling for batch analysis and a batch mode to view all active pins.
  - Display of raw AI text and special aliases for OCR results.
  - Review/edit workflow for AI-generated labels.

- **Undo / Redo**
  - Undo/redo capabilities for entry and pin modifications.
  - Includes undo/redo for duplicate dismissal actions.

- **Summary Statistics & Insights**
  - Dashboard for key metrics and activity logs.
  - **Data Quality**: flagged pins, flag rate, review response breakdown, dismissed duplicates.
  - **AI Scanner Stats**: total scans, readable/unreadable rate.
  - **Photo Insights**: detail shots, regular photos, average photos per session, photos with linked pins.
  - **Wire Breakdown** charts: top wire types and gauges by count and footage.
  - **Daily Activity Heatmap** (GitHub-style for last 30 days).
  - **Session Completion Rate** progress bar in Overview.

- **Security**
  - Ownership verification on all CRUD routes.
  - Optional **AES-256-GCM encryption** for sensitive entry fields with key wrapping.
  - Cascade deletion for sessions, photos, and entries to clean up related data.

- **AI Help Chatbot**
  - Help menu with tabbed layout: **Guide** (accordion docs) and **Ask AI**.
  - Chatbot uses OpenAI (gpt-4o-mini) with a comprehensive system prompt covering all app features.
  - Streaming responses, per-session conversation history, clear chat, and basic markdown rendering.

- **In-App Feedback**
  - Structured feedback submission (bug reports, feature requests) directly from the application.

- **Flagged Reels Workflow**
  - Pins can be flagged for **re-shoot/review** with notes.
  - Dedicated tab to view, manage, and resolve flagged pins.

- **Review Tab**
  - Session page includes a **Review** tab for accuracy verification.
  - Round-robin entry assignment to online users.
  - 60-second sync spinner before revealing the image for each entry.
  - AI Scanner entries show a cropped thumbnail at the pin location; other entries show the full section photo.
  - Users can approve or flag entries (with optional reason).
  - Responses stored in `review_responses` table with upsert support for verdict changes.
  - Progress indicator for review completion.

- **Duplicate Detection**
  - Detection of potential duplicate pins based on:
    - Label matching (same label in same aisle/section).
    - Same-reel detection (multiple pins on the same photo for the same physical reel).
  - Dismissed duplicates stored in `dismissed_duplicates` DB table per session and shared across users.
  - Undo/redo supports dismiss/undismiss.
  - Old `localStorage` dismissals automatically migrated to DB on first load.

- **Tester Password Login**
  - Account owners can set a **tester password** in Settings.
  - Testers can log in via `/tester-login` without a Replit account.
  - Passwords are bcrypt-hashed.
  - Testers see the owner’s sessions as editors but cannot modify settings.
  - Logout via `/api/auth/tester-logout`.

- **User Settings**
  - Display: theme (dark mode), thumbnail size.
  - Accessibility options.
  - Data entry: aisle prefix, section advance.
  - Photo capture quality.
  - Export defaults.
  - Data encryption toggle.
  - Tester access password management.
  - **Storage usage dashboard** with per-user consumption and a 10 GB limit.

- **Storage Usage Dashboard**
  - Per-user cloud storage consumption with visual progress bar.
  - Photo and session counts.
  - Collapsible all-users breakdown table.
  - Photo file sizes stored in `photos.fileSize` and populated on upload.
  - Backfill endpoint `POST /api/storage/backfill-sizes` to fetch GCS metadata for existing photos missing sizes.

- **User Profile Avatar**
  - Custom profile photo upload for user avatars stored in Replit Object Storage.

- **PWA & Offline Support**
  - Web app manifest and production-only service worker.
  - Service worker caches the app shell and static assets.
  - Offline photo/entry queue via IndexedDB.
  - Network status indicator with auto-sync on reconnect.
  - Session data cached via React Query with a 30-minute garbage-collection time for offline viewing.

## Tech Stack

- **Frontend**
  - React + Vite
  - TanStack Query for data fetching and caching
  - wouter for client-side routing
  - shadcn/ui for component library
  - Mobile-first UI with industrial/warehouse aesthetic
  - Monospace font (**JetBrains Mono**) for data values
  - Dark mode support with copper/industrial warm tones and orange accent color `#ea580c`

- **Backend**
  - Express.js
  - RESTful API with authentication and session access verification
  - WebSockets for real-time collaborative sessions

- **Database & ORM**
  - PostgreSQL
  - Drizzle ORM
  - Transactions for atomic operations
  - Tables for sessions, folders, photos, entries, review responses, dismissed duplicates, etc.

- **Authentication & Storage**
  - Replit Auth (OIDC) for user authentication
  - Replit Object Storage for photos and avatars

- **AI & Exports**
  - OpenAI Vision (**gpt-4o**) for AI label scanning
  - OpenAI (**gpt-4o-mini**) for the in-app help chatbot
  - ExcelJS for generating Excel (.xlsx) exports
  - Custom PDF export pipeline

- **PWA**
  - Service worker and manifest for offline-capable web app

## Getting Started

> Note: This project is described as a full-stack TypeScript application with React, Express.js, PostgreSQL, and Replit-specific integrations. The following is a high-level setup overview based on the architecture described; consult the repository for exact commands and environment details.

1. **Clone the Repository**
   - Clone the `makerdan/Master-Reel-Counter` repository into your local or Replit workspace.

2. **Install Dependencies**
   - Install Node.js dependencies (e.g., via `npm install` or `pnpm install`, depending on the repo’s configuration).

3. **Configure Environment**
   - Set up environment variables for:
     - **Replit Auth (OIDC)** configuration.
     - **Replit Object Storage** credentials or configuration.
     - **PostgreSQL** connection string.
     - **OpenAI** API keys for gpt-4o and gpt-4o-mini.
     - Optional **AES-256-GCM** encryption keys and key-wrapping configuration.

4. **Database Setup**
   - Ensure a PostgreSQL instance is available.
   - Apply schema migrations using Drizzle ORM tooling as defined in the repo.

5. **Run the Application**
   - Start the **backend** (Express.js server) with the appropriate npm script.
   - Start the **frontend** (React + Vite) development server.
   - In production, ensure the service worker is registered and the app is built and served through the configured deployment pipeline.

6. **Access the App**
   - Open the frontend in a browser.
   - Authenticate via **Replit Auth** or **Tester Password Login** if configured.
   - Create sessions, manage folders, capture photos, and use the AI Scanner and export features as required.

## Project Structure

> The exact directory layout may vary; the following highlights key components mentioned in the system design and validation contract.

- **Frontend**
  - React + Vite application using:
    - `shadcn/ui` components for the copper/industrial themed UI.
    - TanStack Query for API data fetching and caching.
    - wouter for routing.
    - PWA manifest and service worker registration (production only).
    - IndexedDB utilities for offline photo/entry queue.

- **Backend**
  - Express.js API server handling:
    - Session, folder, entry, photo, review, and duplicate detection routes.
    - Replit Auth-based authentication and ownership verification.
    - WebSocket server for collaborative sessions and online presence.
    - Storage backfill endpoint: `POST /api/storage/backfill-sizes`.

- **Database**
  - Drizzle ORM models and migrations for:
    - Sessions and folders (with `deletedAt` for soft delete).
    - Photos (`photos.fileSize` column for storage tracking).
    - Review-related tables: `review_responses`, `dismissed_duplicates`.
    - AI Scanner-related and duplicate detection structures.

- **Scripts & Validation**
  - `scripts/run-locked-tier.mjs` for **task validation** with tier locking.
  - `scripts/run-tier.mjs` for ad-hoc work with `--allow-no-plan`.
  - `scripts/workspace-skill-sync.mjs` for workspace-managed skill projections.
  - Validation-related commands:
    - `npm run new-plan -- --name <slug> --why "<reason>"`
    - `workspace-skill:refresh`
    - `workspace-skill:validate`
    - `workspace-skill:audit`
    - `workspace-skill:load`
    - `workspace-skill:status`
    - `npm run maintain:validation-baseline`
  - Task plan files in `.local/tasks/<name>.md`.
  - Skill mirror projections in `.agents/skills/.workspace-projections/` (ignored from VCS).
  - Runtime mirror in `.local/custom_skills` (platform-owned, repo does not write to it).

- **Docs & Validation Baseline**
  - `docs/validation/failure-baseline.json` for cataloged pre-existing failures.
  - `.workspace-revision` and SHA-256 manifests for skill validation.

## Deployment

The application is designed to run as a full-stack web app, with:

### Managed Clerk release gate

Every Replit production deployment runs `npm run release:build`. That command embeds the canonical production Clerk host, builds the exact candidate, starts the compiled artifact in production mode with a unique build identity, and blocks promotion unless the managed Clerk smoke passes against that artifact. The gate creates and removes a disposable Clerk/local user, verifies the production Clerk proxy, cookie-only authentication, protected Settings and Stats pages, and sign-out. It fails closed when any required managed setting is absent and does not print secret values.

The **Managed Clerk production release gate** GitHub workflow remains available for an additional check against the currently published URL. Configure `PRODUCTION_BASE_URL` as a protected-environment variable and provide `CLERK_SECRET_KEY` and `DATABASE_URL` as protected-environment secrets.

## Conventions

For production deployment:

- Ensure environment variables for Replit Auth, Object Storage, PostgreSQL, and OpenAI are configured.
- Build the frontend and serve it alongside or in front of the backend.
- Verify that the service worker is registered only in production builds.
- Confirm that the background trash purge and storage backfill endpoint are enabled and monitored.

## Contributing / Conventions

This project employs a **task plan and validation** contract, along with workspace-managed skill projections. Contributing changes should respect these conventions:

- **Task Plans & Failure Gate**
  - Every task requires a plan created with:
    - `npm run new-plan -- --name <slug> --why "<reason>"`.
  - Plans must include:
    - `## Pre-existing failures to ignore`
    - `## Validation`
  - Plans may reference only **exact, active, unexpired records** in `docs/validation/failure-baseline.json`.
  - The plan’s registered command is the **validation ceiling**; task validation must not exceed this tier.

- **Task Validation**
  - Run validation using:
    - `TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/run-locked-tier.mjs`.
  - Missing or malformed plans, unregistered tiers, and tier mismatches **fail closed**.
  - No-plan escape hatch:
    - `node scripts/run-tier.mjs <tier> --allow-no-plan` for ad-hoc work.
  - Declarative tiers:
    - `test-light`
    - `test-standard`
    - `test-heavy`
  - Heavy validation includes:
    - `serial-lock.mjs`
    - `free-ports.mjs`
    - Startup smoke tests
    - CI collision checks
    - Playwright controls
  - Task validation and platform completion validation are separate; completion checks are not grounds to escalate the task tier.

- **Failure Classification**
  - Failure classification requires **exact baseline matching**.
  - A passing retry establishes **intermittency** only.
  - Unlisted failures need **two of three provenance factors** before being self-classified as pre-existing.
  - Do not promote a task-local observation directly into the failure catalog.
  - Use:
    - `npm run maintain:validation-baseline`
    - For opt-in review and staleness reporting; maintenance findings do not fail unrelated task validation.

- **Workspace Skills & Mirrors**
  - `scripts/workspace-skill-sync.mjs` implements **Skill Mirror Sync**.
  - Requires explicit `WORKSPACE_SKILLS_SOURCE` for every operation; **no fallback source**.
  - Commands:
    - `workspace-skill:refresh` — generates `.agents/skills/.workspace-projections/` (ignored in VCS, may contain private instructions).
    - `workspace-skill:validate` — uses recursive SHA-256 manifests and `.workspace-revision`; refuses stale or partial projections.
    - `workspace-skill:audit`
    - `workspace-skill:load`
    - `workspace-skill:status -- --skill <slug>` — read-only; reports only `pass`, `mismatch`, `unavailable-source`, or `missing-mirror`.
  - `.local/custom_skills` is a platform-owned, disposable runtime mirror; **the repository never writes** to it or its `.workspace-skill-metadata.json` sidecars.
  - Mirror repair and source publication belong to the **workspace owner**; only projection implementation defects belong in this repository.

By following these conventions, contributors maintain consistent validation, reliable skill projections, and stable CI behavior for Master Reel Counter.