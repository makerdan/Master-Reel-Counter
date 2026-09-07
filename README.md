# Master Reel Counter

Master Reel Counter is a full-stack warehouse wire reel counting application for tracking wire reels across pallet sections. It combines mobile-first photo capture, manual data entry, AI-assisted label scanning, and export tools to streamline inventory management in industrial environments.

## Overview

This project is designed for warehouse and inventory teams that need an efficient way to count, annotate, review, and export wire reel data. It supports collaborative sessions, real-time updates, offline capture, and structured review workflows so teams can work across the warehouse floor and back office with a shared source of truth.

## Features

- **Session management** for creating, duplicating, moving, organizing, trashing, restoring, and permanently deleting counting sessions.
- **Folder management** with soft-delete behavior that mirrors the session trash flow.
- **Manual entry workflows** with category autocomplete, auto-calculated total footage, and quick-entry panels.
- **Photo management** with pin placement, annotations, notes, per-photo pin scaling, nearby photo viewing, and persisted photo rotations.
- **Offline capture support** using IndexedDB queues for photos and entries.
- **Real-time collaboration** with role-based permissions, invitations, and online presence tracking over WebSockets.
- **AI label scanning** using OpenAI Vision to read wire reel labels from photo crops, including batch analysis and review/edit workflows.
- **Duplicate detection** for potential duplicate pins and same-reel matches, with shared dismissal state.
- **Review workflow** that assigns entries round-robin to online users with approval/flagging and progress tracking.
- **Flagged reels workflow** for marking pins that need reshoot or review.
- **Undo/redo** for entry and pin modifications.
- **PDF export** with cover page, clickable table of contents, page numbers, enhanced captions, photo quality options, and grand totals.
- **Excel export** via ExcelJS with styled tables, grouping, and audit trails.
- **Dashboard statistics** including data quality metrics, AI scan metrics, photo insights, wire breakdowns, activity heatmaps, and session completion progress.
- **User settings** for theme, thumbnail size, data-entry behavior, export defaults, capture quality, encryption, tester access, and storage usage.
- **Storage usage tracking** with per-user consumption, photo/session counts, and organization-wide breakdowns.
- **In-app feedback** for bug reports and feature requests.
- **AI help chatbot** with guided documentation and session-aware conversational support.
- **PWA/offline support** with app-shell caching, service worker support, and network status indicators.
- **User profiles** with custom avatar uploads.

## Tech Stack

- **Frontend:** React, Vite, TanStack Query, wouter
- **Backend:** Express.js
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Authentication:** Replit Auth (OIDC)
- **Storage:** Replit Object Storage
- **Exports:** PDF generation, ExcelJS
- **AI:** OpenAI Vision and OpenAI chat models
- **UI:** shadcn/ui components
- **Styling:** Industrial/copper theme with dark mode support
- **Font:** JetBrains Mono for data values
- **Communication:** WebSockets for real-time collaboration
- **Offline data:** IndexedDB for queued photo and entry sync
- **Encoding/security:** AES-256-GCM encryption for sensitive fields

## Getting Started

The repository snapshot does not include explicit install or run commands, so follow the project’s existing package scripts and environment setup in the repo.

Typical setup will require:

- Installing dependencies from the project’s package manifest
- Configuring PostgreSQL and the Replit Auth/OIDC environment
- Setting up Replit Object Storage for uploads
- Providing OpenAI access for AI scanning and chatbot features
- Applying any required database migrations before running the app

If you are working in the Replit environment, the application is intended to run as a full-stack React/Express project with the frontend and backend wired together through the app’s existing scripts.

## Project Structure

The `replit.md` file identifies the main architectural layers and key areas of the app:

- **Frontend:** React + Vite application with TanStack Query and wouter
- **Backend:** Express.js API and session access verification
- **Database layer:** PostgreSQL with Drizzle ORM and transactional operations
- **Real-time layer:** WebSocket handling for collaborative sessions
- **Exports:** PDF and Excel generation workflows
- **Offline support:** Service worker, PWA assets, and IndexedDB queues
- **Workspace skill sync:** `scripts/workspace-skill-sync.mjs` for tracked skill projection management
- **Validation plans:** `.local/tasks/` for task plans created through the agent validation contract
- **Validation baseline:** `docs/validation/failure-baseline.json` for approved pre-existing failures

## Contributing / Conventions

The project follows a documented agent validation contract:

- Task plans must be created with `npm run new-plan -- --name <slug> --why "<reason>"`.
- Every plan must include `## Pre-existing failures to ignore` and `## Validation`.
- Validation may only reference exact, active, unexpired records in `docs/validation/failure-baseline.json`.
- Task validation is run with `TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/run-locked-tier.mjs`.
- Registered validation tiers are `test-light`, `test-standard`, and `test-heavy`.
- Heavy validation retains serial locking, free-port checks, startup smoke tests, CI collision checks, and Playwright controls.
- The workspace-skill mirror system requires an explicit `WORKSPACE_SKILLS_SOURCE` for every operation and uses the `workspace-skill:*` npm commands for refresh, validation, audit, load, and status.

Project conventions emphasized in `replit.md` include:

- A **mobile-first** warehouse workflow
- An **industrial/copper visual style** with dark mode support
- **Monospace data values** using JetBrains Mono
- Strong **ownership verification** on CRUD routes
- Use of **transactions** for atomic database operations
- **Soft-delete/trash flows** for sessions and folders
- **Real-time collaboration** with role-based access controls