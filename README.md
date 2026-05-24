<div align="center">

# AutoTestAI

**The AI-powered software testing platform that replaces a QA team.**

Self-healing tests · Autonomous monitoring · Project memory · Stripe-native billing

[Live UI demo](https://windycityassassin.github.io/autotestai/) (tour mode, backend stubbed)
· [Run the demo locally](#run-the-demo-locally) (full stack)

</div>

---

## What it does

AutoTestAI takes a one-line prompt like *"test the login flow on app.twenty.com"* and:

1. **Generates** a runnable Playwright test from the natural-language brief.
2. **Executes** it through the [`passmark`](https://github.com/bug0inc/passmark) engine — multi-model assertion consensus, intelligent selector caching, real browser automation.
3. **Self-heals** when the target app's DOM changes — re-derives broken selectors, patches the test, caches the new selector for next time.
4. **Monitors autonomously** — KAIROS, the background scheduler, runs your suite on its own cadence, ranks tests by failure risk, and surfaces a "dream summary" of what changed.
5. **Remembers** — every verified selector, anti-pattern, and Passmark step is persisted into project memory so the next test you generate inherits everything the platform has learned.

It is positioned as a **QA team replacement**, not yet-another-test-runner. The product surface — generation, execution, healing, monitoring, memory, and billing — is end-to-end.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend  (React + Vite + wouter + TanStack Query + shadcn/ui)  │
│  Landing · Dashboard · ProjectDetail · Monitoring · Billing      │
└────────────────────────────┬─────────────────────────────────────┘
                             │  REST + session cookies
┌────────────────────────────▼─────────────────────────────────────┐
│  API  (Express + Drizzle ORM + Postgres)                         │
│  routes.ts (auth · tests · runs · memory · billing · webhooks)   │
└──┬──────────────────┬──────────────────┬───────────────┬─────────┘
   │                  │                  │               │
   ▼                  ▼                  ▼               ▼
┌──────────┐    ┌──────────┐      ┌──────────────┐  ┌──────────┐
│ Anthropic│    │ passmark │      │   KAIROS     │  │  Stripe  │
│ (test    │    │ (browser │      │ (scheduler · │  │ (billing │
│  gen)    │    │  exec)   │      │  risk rank)  │  │  + webhk)│
└──────────┘    └──────────┘      └──────────────┘  └──────────┘
                     │
                     ▼
            ┌────────────────┐
            │  Project       │
            │  Memory (PG)   │
            │  selectors ·   │
            │  anti-patterns │
            │  passmark      │
            │  steps         │
            └────────────────┘
```

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, TypeScript, wouter, TanStack Query v5, shadcn/ui, Tailwind |
| Backend | Express, TypeScript, Drizzle ORM, express-session |
| Database | Postgres (via Neon / Replit) |
| Test execution | [passmark](https://github.com/bug0inc/passmark) (Playwright + multi-model consensus) |
| AI | Anthropic Claude (primary), Gemini (assertion arbiter, optional) |
| Billing | Stripe (Checkout + webhooks) |
| Cache | Redis (passmark step cache, optional but recommended) |

## Quick start

### Prerequisites
- Node.js 20+
- Postgres (any host)
- Anthropic API key
- (Optional) Gemini API key for multi-model assertion consensus
- (Optional) Redis URL for selector caching
- Stripe keys for billing

### Setup

```bash
git clone https://github.com/windycityassassin/autotestai.git
cd autotestai
npm install
cp .env.example .env  # fill in the values
npm run db:push       # sync schema
npm run dev           # boots Express + Vite on the same port
```

### Required environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | random 32+ char string for express-session |
| `ANTHROPIC_API_KEY` | Claude (test generation + step execution) |
| `STRIPE_SECRET_KEY` | server-side Stripe |
| `STRIPE_WEBHOOK_SECRET` | for `/api/billing/webhook` |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM` | price IDs for paid plans |

Optional:

| Var | Purpose |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | enables Gemini as assertion secondary/arbiter |
| `REDIS_URL` | enables passmark step caching (highly recommended for prod) |

## Run the demo locally

```bash
npm install
npm run db:push   # sync schema to your Postgres
npm run dev       # boots Express + Vite
```

Then open `http://localhost:5000/demo`. The endpoint provisions a `demo@autotestai.com` user, seeds a Twenty CRM project with 3 example tests, 7 historical runs (one self-heal recovery), 10 project-memory entries, and 5 KAIROS monitoring cycles, then logs you straight in.

Deep links:
- `/demo`, the demo project overview
- `/demo?section=saved-tests`, the generated tests
- `/demo?section=memory`, learned selectors and anti-patterns
- `/demo?section=monitoring`, KAIROS history + dream summaries
- `/demo?section=activity`, full activity feed

## Pricing

| Plan | Price | Test runs / mo | Notes |
|---|---|---|---|
| Free | $0 | 25 | Single user, single project |
| Pro | $49 | 500 | Unlimited projects, KAIROS monitoring |
| Team | $149 | 2,500 | Team seats, priority healing, audit log |

Live Stripe checkout — fully wired through `/api/billing/checkout` and `/api/billing/webhook`.

## Project structure

```
client/src/
  pages/           Landing, Dashboard, ProjectDetail, Demo, Monitoring, Billing, Activity
  components/      shadcn-derived UI primitives + feature components
  lib/             queryClient, utils
server/
  routes.ts        all REST endpoints
  storage.ts       Drizzle data layer (IStorage interface)
  scheduler.ts     KAIROS autonomous monitoring loop
  passmark-config.ts  multi-model passmark wiring
  stripeService.ts    checkout, webhooks, plan limits
  notifications.ts    email + webhook alerts
shared/
  schema.ts        Drizzle tables + Zod insert/select schemas
scripts/
  push-to-github.mjs  one-shot publisher for this repo
```

## Roadmap

| Status | Item |
|---|---|
| ✅ | AI test generation (Anthropic) |
| ✅ | Self-healing via passmark engine |
| ✅ | Project memory (selectors + anti-patterns + passmark steps) |
| ✅ | KAIROS scheduler (hourly / daily / weekly dream summaries) |
| ✅ | Stripe billing (Free / Pro / Team) with usage metering |
| ✅ | Activity feed + run history |
| 🟡 | Wire run results back into project_memory automatically |
| 🟡 | Real KAIROS risk model (change-detection + recent-failure weighting) |
| 🟡 | Plan-limit enforcement (currently surfaced, not strictly capped) |
| 🔜 | Team seats + invitations |
| 🔜 | CI integration (GitHub Actions, GitLab) |
| 🔜 | Slack / Linear alerting on failed monitoring cycles |

## Design philosophy

- **Black-on-black aesthetic.** Acid green `#0DFF82` for confirmation, hot red `#FF2947` for danger. No gradients, no blur, no chrome.
- **No mocked product surface.** Every panel in the demo is fed by real seed data through real API endpoints. If you see numbers, they came out of Postgres.
- **Boring stack, sharp positioning.** Vite + Express + Drizzle + Stripe is intentionally unremarkable so the differentiation lives in the agent loop and the UX.

## Credits

- Test execution engine: [`bug0inc/passmark`](https://github.com/bug0inc/passmark) (FSL-1.1-ALv2)
- Demo target app: [`twentyhq/twenty`](https://github.com/twentyhq/twenty) (open-source CRM)
- UI primitives: [shadcn/ui](https://ui.shadcn.com)

## License

All rights reserved. This repository is published for portfolio and investor review. Contact for licensing or commercial inquiries.
