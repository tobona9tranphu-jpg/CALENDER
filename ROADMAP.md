# ROADMAP — Smart Study Planner (TB)

## Phase 0: Core Architecture & Foundations (COMPLETED)
- [x] **P0.1 — Authentication & Session Hardening**: HttpOnly cookie session management, client token removal.
- [x] **P0.2 — Vercel Production Auth**: Production-grade cookie authentication on Vercel Serverless + Postgres.
- [x] **P0.3 — Vietnam Date/Time Correctness**: UTC+7 (`Asia/Ho_Chi_Minh`) centralized date math via `src/utils/date.js`.
- [x] **P0.4 — Notification Engine**: Notification store, policy-based deduplication, browser notification abstraction, accessible toast UI.
- [x] **P0.5 — Recurrence System & Data Integrity**: Bounded recurrence expansion, occurrence exceptions, resilient emergency backup and recovery.
- [x] **P0.6 — Security Hardening & Input Safety**: Server-side schema validators, XSS defense, CSP/security headers, sensitive path blocking.

## Phase 1: UX & AI Time Management (CURRENT)
- [x] **Product UX Phase 1**: Today Dashboard (Next Event, Progress, Free Time), Quick Capture NLP modal, Inbox backlog management.
- [x] **P1.1 — AI Time Management Foundation**:
  - Declarative Intent Schema (`src/ai/intent-schema.js`)
  - Privacy-safe Planning Context (`src/ai/planner-context.js`)
  - Deterministic Proposal Validation (`src/ai/planning-proposal.js`)
  - Gemini Server Provider + Deterministic Fallback (`src/ai/ai-provider.js`)
  - Interactive AI Review Modal (`#aiPlanReviewModal`)
- [x] **P1.2 — AI Planner & Smart Scheduling**:
  - Temporal correctness: removed hardcoded dates, server-side date resolution.
  - Multi-Task & Multi-Day Coordinated Engine (`src/ai/planner-engine.js`).
  - Deterministic Plan Quality Evaluator (`src/ai/plan-evaluator.js`).
  - Stale Proposal Protection via `calendarRevision` fingerprint.
  - In-modal per-action date/time adjustments & remove controls with live quality recalculation.
  - Production deployment on Vercel (`calender-jsf2.vercel.app`).
  - 39 automated tests covering all planner mechanics (243/243 tests green).

## Phase 2: Autonomous AI Time Management (UPCOMING)
- [ ] **P2.1 — AI Reschedule & Conflict Resolver**: Smart conflict resolution when real-world delays occur.
- [ ] **P2.2 — Study Habit Analytics & Fatigue Awareness**: Dynamic break recommendations based on student focus patterns.
- [ ] **P2.3 — Natural Language Dialogue & Chat Assistant**: Conversational schedule adjustments and voice/audio capture.
