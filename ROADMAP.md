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
- [x] **P1.3 — Smart Reschedule + Conflict Intelligence + Deadline Intelligence ("Fix My Day")**:
  - Context canonicalization & high-precision double-djb2 revision fingerprint (`planningContextRevision`).
  - Deterministic Conflict Intelligence (`src/ai/conflict-intelligence.js`) with HARD & SOFT conflict classifications.
  - Schedule Drift Detection (`src/ai/schedule-drift.js`) identifying overdue & late tasks and remaining availability.
  - Deadline Intelligence (`src/ai/deadline-intelligence.js`) with deterministic risk tiers (`safe`, `watch`, `at_risk`, `critical`, `impossible`).
  - Smart Reschedule Engine (`src/ai/reschedule-engine.js`) honoring strict constraint priority, minimum necessary changes (`changeCost`), and multi-day spillover.
  - Plan Quality Evaluator upgraded with `changeCost` metric and before vs after score comparisons.
  - Today Dashboard Attention Center enhanced with prominent `🪄 Fix My Day` action trigger.
  - Review Modal enhanced with Reschedule Diff view (`What Changed`), risk overview, quality delta pill, and per-action live adjustments.
  - Atomic Apply & Notification Reconciliation.
  - 26 tests covering P1.3 mechanics (269/269 tests green across 9 suites).

## Phase 2: Autonomous AI Time Management (UPCOMING)
- [ ] **P2.1 — Conversational Schedule Dialogue**: Multi-turn chat assistant for schedule adjustments.
- [ ] **P2.2 — Study Habit Analytics & Fatigue Awareness**: Dynamic break recommendations based on student focus patterns.
- [ ] **P2.3 — Multi-Modal Audio & Voice Capture**: Direct speech-to-intent quick capture.
