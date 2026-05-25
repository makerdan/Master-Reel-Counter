# Master Reel Counter

A full-stack warehouse wire reel counting application for tracking wire reels across pallet sections, with photo annotation, AI-powered label scanning, and PDF/Excel export capabilities.

## Overview

Master Reel Counter is designed to streamline warehouse inventory management for wire reels. It enables teams to organize counting sessions by aisle and section, annotate photos with pins, manually log reel data with catalog autocomplete, collaborate in real time, and export polished reports. Built with a mobile-first, industrial aesthetic, the app is suited for warehouse operators, inventory managers, and field teams who need fast, reliable, and shareable reel counts.

## Features

### Session & Folder Management
- Create, duplicate, move, and organize counting sessions
- Folder organization with soft-delete (trash) workflow
- Session and folder trash with 30-day restore window and hourly auto-purge of expired items
- Trash toggle on the dashboard for restore or permanent deletion

### Entry & Photo Management
- Manual entry of reel data with category autocomplete and auto-calculation of total footage
- Quick entry panels for fast data capture
- Photo annotation with pin placement and per-photo pin scaling
- Background photo uploads with offline queue (IndexedDB)
- Per-pin notes and a nearby photo viewer
- Persisted photo rotations applied to exports
- Photos stored in Replit Object Storage

### AI Label Scanner
- OpenAI Vision (gpt-4o) reads wire reel labels from photo crops
- Batch analysis with Receiving pooling
- Client-side fuzzy matching against a wire catalog (~180 entries)
- Draft and committed pins with real-time sync across collaborators
- Batch mode for viewing all active pins, raw AI text display, and OCR aliases

### Collaboration
- Real-time collaborative sessions via WebSockets
- Role-based permissions: owner, editor, viewer
- Multiple invitation methods and online presence tracking

### Review & Quality Workflows
- **Review Tab:** Round-robin entry assignment to online users with a 60-second sync spinner before revealing each image; approve or flag with optional reason; verdicts upsertable per user
- **Flagged Reels Workflow:** Flag pins for re-shoot/review with notes and resolve from a dedicated tab
- **Duplicate Detection:** Identifies same-label pins in the same aisle/section and same-reel pins on the same photo; dismissals persisted per session and shared across users, with undo/redo support

### Data Export
- PDF export with cover page, clickable Table of Contents, page numbers, enhanced photo captions, and grand totals
- Full or standard quality PDF options
- Excel (.xlsx) export via ExcelJS with styled tables, wire-type grouping, and audit trails

### Dashboard & Insights
- Summary statistics with key metrics and activity logs
- Data Quality section: flagged pins, flag rate, review response breakdown, dismissed duplicates
- AI Scanner stats: total scans, readable/unreadable rate
- Photo insights: detail shots, regular photos, avg photos per session, photos with linked pins
- Wire breakdown charts (top wire types and gauges)
- 30-day GitHub-style daily activity heatmap
- Session completion rate progress bar

### User Experience
- Undo/redo for entries and pin modifications
- AI Help Chatbot (gpt-4o-mini) with streaming responses, conversation history, and markdown rendering, alongside a Guide tab
- In-app structured feedback submission (bug reports, feature requests)
- Custom profile avatar uploads
- Mobile capture mode for quick photo taking
- Dark mode support with copper/industrial warm theme

### Settings & Security
- Display, accessibility, data entry, photo capture quality, and export default preferences
- Optional AES-256-GCM encryption (with key wrapping) for sensitive entry fields
- Storage Usage Dashboard with 10 GB per-user limit, photo/session counts, and all-users breakdown
- Backfill endpoint for populating photo file sizes from GCS metadata
- Tester Password Login: owners can grant testers bcrypt-protected access without a Replit account
- Ownership verification on all CRUD routes

### Offline & PWA
- Web app manifest and service worker (caches app shell and static assets in production)
- Offline photo and entry queue via IndexedDB
- Network status indicator with auto-sync on reconnect
- Session data cached in React Query with 30-minute gc time

## Tech Stack

- **Frontend:** React, Vite, TypeScript, TanStack Query, wouter, shadcn/ui, JetBrains Mono
- **Backend:** Express.js, TypeScript
- **Database:** PostgreSQL with Drizzle ORM (transactional writes)
- **Real-time:** WebSockets
- **Authentication:** Replit Auth (OpenID Connect) + optional bcrypt-based tester login
- **Storage:** Replit Object Storage (photos and avatars)
- **AI:** OpenAI Vision (gpt-4o) for label scanning; OpenAI gpt-4o-mini for the help chatbot
- **Exports:** ExcelJS for `.xlsx`; PDF generation with cover page, TOC, and pagination
- **PWA:** Service worker, web app manifest, IndexedDB offline queue

## Getting Started

This project is designed to run on Replit, where authentication, object storage, and the PostgreSQL database are provisioned natively.

### Prerequisites
- A Replit account (required for Replit Auth and Object Storage)
- A provisioned PostgreSQL database
- An OpenAI API key (for AI Label Scanner and Help Chatbot)

### Environment
Configure the following in your Replit Secrets (or `.env`):
- `DATABASE_URL` — PostgreSQL connection string
- `OPENAI_API_KEY` — for AI Vision and chatbot features
- Encryption key material for AES-256-GCM (if enabling sensitive-field encryption)
- Replit Auth and Object Storage credentials (provided automatically when running on Replit)

### Database
Drizzle ORM manages the schema. Apply migrations using your project's configured Drizzle workflow before first run.

### Run
Start the Express server and Vite dev server as configured in the project. The service worker is registered in production builds only.

## Deployment

The application is intended for deployment on Replit, leveraging Replit Auth, Replit Object Storage, and a managed PostgreSQL instance. PWA assets (manifest and service worker) are served in production for offline-capable installs.

## Conventions

- **Aesthetic:** Industrial/warehouse, copper/orange accent (`#ea580c`), dark mode supported
- **Typography:** Monospace (JetBrains Mono) for data values
- **Design:** Mobile-first
- **API:** RESTful with authentication, session access verification, and server-side pagination (limit/offset with total counts) on list endpoints
- **Data Integrity:** Cascade deletion ensures cleanup of related records when sessions, photos, or entries are removed
- **Security:** All CRUD routes verify ownership; sensitive fields can be AES-256-GCM encrypted with key wrapping