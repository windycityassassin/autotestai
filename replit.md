# AutoTestAI — Replit Agent Guide

## Overview

AutoTestAI is a full-stack AI-powered testing platform providing a pre-launch marketing/waitlist landing page and a full authenticated product dashboard. Users can manage projects, generate Playwright or Cypress tests using Claude AI, run tests in a headless Chromium browser, and view real-time results. The platform supports user registration, login, and robust project management including AI test generation, real-time output streaming, and historical run results.

The platform includes a project memory system that intelligently extracts and learns Playwright selectors and testing patterns from successful test runs. This memory is then used to inject context into subsequent AI test generations, improving relevance and efficiency. The system also supports self-healing tests, where broken selectors are identified and updated, further enhancing test reliability.

The user interface features an Awwwards-inspired design, utilizing a dark theme with acid green and hot red accents, animated film grain, a custom cursor, ultra-bold typography, and dynamic elements like ticker strips, floating orbs, and scroll-reveal animations.

Core features include an AI Test Case Generator, Intelligent Edge Case Detection, Self-Healing Test Automation, Natural Language to Code conversion, AI Bug Analyzer, Predictive Failure Analytics, and Multi-Framework Export with CI/CD integration.

The platform has a live Stripe-powered billing system with three tiers: **Free** (1 project, 20 runs/month), **Pro** ($49/month — 5 projects, unlimited runs, self-healing, monitoring), and **Team** ($149/month — unlimited everything + webhooks + autoDream). Users can upgrade via Stripe Checkout and manage subscriptions via the Stripe Customer Portal.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Layout

The project is structured as a monorepo with `client/` (React SPA), `server/` (Express.js API), and `shared/` (TypeScript types and Drizzle schema) to facilitate type and schema sharing.

### Frontend Architecture

The frontend is a React 18 SPA built with TypeScript and Vite. It uses `wouter` for routing, TanStack Query for data fetching with a custom `apiRequest` helper, and React Hook Form with Zod for form validation. UI components are built with `shadcn/ui` based on Radix UI, styled with Tailwind CSS in a dark-mode-only design. Framer Motion is extensively used for animations and scroll effects.

### Backend Architecture

- **Framework:** Express.js v5 on Node.js, run with `tsx` in development
- **Structure:** `server/index.ts` bootstraps the app → `registerRoutes` adds API routes → static serving for production build
- **API routes (active):**
  - `POST /api/waitlist` — validates body with Zod, checks for duplicate email, inserts into DB, returns entry + count
  - `GET /api/waitlist/count` — returns total waitlist sign-up count
  - `POST /api/auth/register` — creates user with bcrypt-hashed password (stored as `password_hash`), sets session
  - `POST /api/auth/login` — validates credentials, sets session
  - `POST /api/auth/logout` — destroys session
  - `GET /api/auth/me` — returns current user (401 if not authenticated)
  - `GET /api/projects` — returns authenticated user's projects (requires session)
  - `POST /api/projects` — creates a new project for the authenticated user
  - `GET /api/projects/:id` — returns a project (must belong to authenticated user)
  - `DELETE /api/projects/:id` — deletes a project (must belong to authenticated user)
  - `GET /api/projects/:id/tests` — returns generated tests for a project
  - `DELETE /api/projects/:id/tests/:testId` — deletes a generated test (project-scoped)
  - `POST /api/projects/:id/generate-test` — SSE streaming, multi-agent tool-use pipeline: (1) Claude runs in a while(tool_use) loop using 4 typed tools (inspect_page, identify_flows, write_test_step, assert), (2) a Reviewer agent returns quality JSON; streams phase events to client
  - `POST /api/projects/:id/tests/generate` — quick template-based Playwright test generation (no prompt required)
  - `GET /api/tests/:testId` — returns a specific generated test
  - `DELETE /api/tests/:testId` — deletes a generated test
  - `GET /api/tests/:testId/runs` — returns all past test runs for a generated test
  - `POST /api/tests/:testId/run` — runs the test in a headless Chromium subprocess; streams output via SSE (text/event-stream)
  - `POST /api/tests/:testId/heal` — auto-heals a failing test using Claude (quick mode) or Goose (deep mode); `mode` body param selects "quick" or "deep"; streams SSE events including `goose_activity` for deep mode
  - `GET /api/health/goose` — returns `{"status": "up" | "down"}` for the Goose sidecar
  - `POST /api/projects/:id/generate-multi` — parallel multi-agent test generation; accepts `scenarios[]`, `framework`, `useGoose` flag; streams SSE events with per-agent progress
  - `GET/PATCH /api/projects/:id/monitoring` — (Task #11) OpenClaw monitoring configuration
  - `POST /api/projects/:id/monitoring/test-notify` — (Task #11) Test OpenClaw notification
  - `POST /api/projects/:id/trigger` — (Task #11) Inbound webhook trigger for test runs
- **Storage layer:** `DatabaseStorage` class behind an `IStorage` interface — makes it easy to swap implementations
- **Development server:** Vite is embedded as Express middleware (via `server/vite.ts`) so the dev server is a single process
- **Production build:** Custom `script/build.ts` runs Vite for the client then esbuild for the server, bundling a selected allowlist of dependencies into a single CJS file (`dist/index.cjs`)

### Database

- **Engine:** PostgreSQL
- **ORM:** Drizzle ORM (`drizzle-orm/node-postgres`) with `drizzle-kit` for migrations
- **Schema location:** `shared/schema.ts` (and `shared/models/chat.ts` for unused chat tables)
- **Active tables:**
  - `waitlist` — `id`, `email` (unique), `name`, `company`, `role`, `created_at`
  - `users` — `id`, `email` (unique), `password_hash`, `name`, `created_at`
  - `projects` — `id`, `user_id` (FK → users, cascade delete), `name`, `url` (optional), `description`, `openclaw_webhook_url`, `alert_email`, `created_at`
  - `generated_tests` — `id`, `project_id` (FK → projects, cascade delete), `title`, `framework`, `prompt`, `url`, `code`, `review` (jsonb — quality review JSON: `{score, flags}`), `created_at`, `updated_at`
  - `test_runs` — `id`, `generated_test_id` (FK → generated_tests, cascade delete), `status`, `output`, `passed_count`, `failed_count`, `total_count`, `started_at`, `completed_at`, `heal_attempts`, `heal_log`, `healed`, `healed_via` (tracks "goose", "goose-fallback", or null for quick heal), `trigger`
  - `scheduled_run_log` — (Task #11/8) logs for automated test runs
  - `session` — auto-created by connect-pg-simple for session storage
- **Unused tables (defined but not migrated by default):**
  - `conversations` and `messages` (in `shared/models/chat.ts`) — for the scaffolded chat integration
- **Validation:** `drizzle-zod` auto-generates Zod schemas from Drizzle table definitions; these schemas are shared across client and server via the `@shared/*` path alias

### Authentication & Authorization

Session-based authentication is implemented using `express-session` and `connect-pg-simple`, storing sessions in a PostgreSQL `session` table. User passwords are hashed with `bcrypt` (12 rounds). A `requireAuth` middleware protects routes, ensuring only authenticated users can access project-related functionalities.

## OpenClaw Multi-Channel Notifications (Task #11)

The platform now supports OpenClaw-based multi-channel notifications for test failure alerts. Users can configure:

- **OpenClaw Webhook URL**: POSTs structured failure alerts (project name, failed count, deeplink) to any OpenClaw instance, enabling Slack, Discord, WhatsApp, Teams, Telegram, etc. delivery.
- **Fallback Email**: If OpenClaw is not configured or fails, alerts fall back to Nodemailer email (requires SMTP env vars).
- **Test Connection**: A "Test connection" button sends a sample ping to validate the webhook URL.
- **Inbound Trigger**: OpenClaw can call `POST /api/projects/:id/trigger` (with `Authorization: Bearer <WEBHOOK_SECRET>`) to trigger test runs from messaging channels.

The Notifications panel is on each project's detail page, below the Memory panel. Settings are stored in `projects.openclaw_webhook_url` and `projects.alert_email`.

**New files**: `server/notifications.ts`  
**New endpoints**: `GET/PATCH /api/projects/:id/monitoring`, `POST /api/projects/:id/monitoring/test-notify`, `POST /api/projects/:id/trigger`

**Optional env vars**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `WEBHOOK_SECRET`

## External Dependencies

### Database
- **PostgreSQL**: Required for data persistence, configured via `DATABASE_URL`.

### AI / Replit Integrations
- **Anthropic Claude**: Powers AI test generation via SSE streaming. Requires `AI_INTEGRATIONS_ANTHROPIC_API_KEY` and `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`.
- **Google Cloud Storage**: Integrated for object storage using `@google-cloud/storage` through a Replit sidecar endpoint.
- **Batch Processing**: Uses `p-limit` and `p-retry` for managing concurrent Anthropic API calls.

### Goose Agent Integration

`server/goose.ts` manages a Goose agent sidecar (optional, graceful degradation):

- **`startGooseSidecar()`** — spawns `goose server --port 9099` on startup (called from `server/index.ts`). If Goose binary isn't installed, logs a message and sets `isHealthy()` to false.
- **`isHealthy()`** — returns `true` if Goose REST API is reachable on port 9099
- **`runHealSession()`** — deep heal mode: if Goose is up, calls its `/v1/chat` API to browse the live app and inspect the DOM before patching. If Goose is down, falls back to an enhanced Claude analysis with structural DOM reasoning.
- **`runParallelGeneration()`** — if Goose is up, runs N sub-agents in parallel (one per scenario). If Goose is down, runs N parallel Claude requests.
- **Fallback behavior** — both features degrade gracefully with a visible "Goose offline" notice in the UI
- **`scripts/setup-goose.sh`** — installs Goose CLI and configures it with the Anthropic API key

### In-Browser Test Runner
- **Playwright + @playwright/test**: Executes generated tests in a headless Chromium browser on the server. Test code is written to temporary files, and output is streamed back to the client via SSE. System dependencies for Chromium are managed via `replit.nix`.

### Frontend Libraries
- **Framer Motion**: Used for advanced UI animations and scroll effects.
- **react-syntax-highlighter**: Provides syntax highlighting for code blocks.
- **Uppy + @uppy/aws-s3**: File upload UI, though not actively used in current pages.
- **Radix UI**: Provides a suite of accessible primitive UI components.
- **Lucide React**: Icon set used across the application.

### Build & Dev Tools
- **Vite**: Frontend bundler and development server.
- **esbuild**: Used for production server bundling.
- **tsx**: TypeScript runner for development.
- **drizzle-kit**: Manages database schema migrations.
- **Replit Vite Plugins**: Specific plugins for Replit development environment.

### Required Environment Variables
- `DATABASE_URL`: PostgreSQL connection string.
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`: Anthropic API key for AI generation.
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`: Anthropic base URL for AI generation.