# Master Reel Counter

## Overview
Master Reel Counter is a full-stack warehouse wire reel counting application designed to track wire reels across pallet sections. It enables photo annotation, manual category entry with catalog autocomplete, and PDF/CSV export capabilities. The application aims to streamline inventory management by providing a comprehensive solution for tracking wire reels, with features like collaborative sessions, real-time updates, offline capabilities, and AI-powered label scanning.

## User Preferences
- Industrial/warehouse aesthetic
- Mobile-first design
- Monospace font (JetBrains Mono) for data values
- Orange accent color (#ea580c)

## System Architecture
The application is built with a React frontend, an Express.js backend, and PostgreSQL as the database. Authentication is handled via Replit Auth (OIDC).

**UI/UX Decisions:**
- **Theme:** Copper/industrial warm tones with dark mode support, using shadcn/ui components.
- **Font:** Monospace font (JetBrains Mono) for data values.
- **Mobile-first:** Dedicated mobile capture mode for quick photo taking.

**Technical Implementations & Feature Specifications:**
- **Session Management:** Users can create, duplicate, move, and organize counting sessions.
- **Entry Management:** Manual entry of reel data with category autocomplete, auto-calculation of total footage, and quick entry panels.
- **Photo Management:** Photo annotation with pin placement, background uploads, offline photo queue (IndexedDB), per-photo pin scaling, notes, and nearby photo viewer. Photos are stored in Replit Object Storage.
- **Collaboration:** Real-time collaborative sessions with role-based permissions (owner, editor, viewer), multiple invitation methods, and online presence tracking via WebSockets.
- **Data Export:** PDF export with cover page, clickable Table of Contents, page numbers, enhanced photo captions, and grand totals. Excel (.xlsx) export via ExcelJS with styled tables, wire-type grouping, and audit trails. PDF exports offer full or standard quality options. Photo rotations are persisted and applied to exports.
- **AI Label Scanner:** A dedicated tab uses OpenAI Vision (gpt-4o) to read wire reel labels from photo crops. It supports batch analysis, client-side fuzzy matching against a wire catalog, and review/editing of results. Draft and committed pins are supported, with real-time sync across collaborators. Includes features like Receiving pooling for batch analysis, a batch mode for viewing all active pins, display of raw AI text, and special aliases for OCR results.
- **Undo/Redo:** Functionality for entry and pin modifications.
- **Summary Statistics:** Dashboard for key metrics and activity logs.
- **Security:** Ownership verification on all CRUD routes and optional AES-256-GCM data encryption for sensitive entry fields.
- **AI Help Chatbot:** The Help menu includes a tabbed layout with "Guide" (existing accordion docs) and "Ask AI" tabs. The AI chatbot uses OpenAI (gpt-4o-mini) with a comprehensive system prompt covering all app features. Supports streaming responses, conversation history within the session, clear chat, and basic markdown rendering.
- **In-App Feedback:** Users can submit structured feedback (bug reports, feature requests) directly from the application.
- **Flagged Reels Workflow:** Pins can be flagged for re-shoot/review with notes, and a dedicated tab allows viewing and resolving flagged pins.
- **Duplicate Detection:** Identifies potential duplicate pins based on label matching (same label in same aisle/section) and same-reel detection (multiple pins on the same photo for the same physical reel). Dismissed duplicates are persisted to the `dismissed_duplicates` DB table (per session), shared across all users. Undo/Redo supports dismiss/undismiss actions. Old localStorage dismissals are auto-migrated to DB on first load.
- **Tester Password Login:** Account owners can set a tester password in Settings to allow testers to log in without a Replit account via `/tester-login`. Passwords are bcrypt-hashed. Testers see the owner's sessions as editors but cannot modify settings. Logout redirects to `/api/auth/tester-logout`.
- **User Settings:** Comprehensive settings for display (theme, thumbnail size), accessibility, data entry (aisle prefix, section advance), photo capture quality, export defaults, data encryption, tester access password, and storage usage dashboard.
- **Storage Usage Dashboard:** Settings page shows per-user cloud storage consumption with a visual progress bar (10 GB limit), photo/session counts, and a collapsible all-users breakdown table. Photo file sizes are stored in the `photos.fileSize` DB column and populated on upload. A backfill endpoint (`POST /api/storage/backfill-sizes`) fetches GCS metadata for existing photos missing sizes.
- **User Profile Avatar:** Users can upload custom profile photos stored in Replit Object Storage.

**System Design Choices:**
- **Frontend:** React + Vite with TanStack Query for data fetching and wouter for routing.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM, using transactions for atomic operations.
- **API:** RESTful API with authentication and session access verification.
- **Real-time Communication:** WebSockets for collaborative sessions with access verification.
- **Data Encoding:** AES-256-GCM encryption with key wrapping for sensitive fields.
- **Cascade Deletion:** Comprehensive cleanup of related data upon deletion of sessions, photos, or entries.

## External Dependencies
- **Replit Auth:** For user authentication (OpenID Connect).
- **Replit Object Storage:** For storing uploaded photos and user avatars.
- **PostgreSQL:** Relational database.
- **Client-side Wire Catalog:** Approximately 180 hardcoded entries for category lookup and autofill.
- **OpenAI Vision (gpt-4o):** Used for AI label scanning.
- **ExcelJS:** For generating Excel (.xlsx) exports.