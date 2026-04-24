import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";
import { startScheduler } from "./scheduler";
import { startGooseSidecar, stopGooseSidecar } from "./goose";
import { initPassmark } from "./passmark-config";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { WebhookHandlers } from "./webhookHandlers";

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id serial PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text,
      company text,
      role text,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      name text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  const colCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password'
  `);
  const hashColCheck = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash'
  `);
  if (colCheck.rows.length > 0 && hashColCheck.rows.length === 0) {
    await pool.query(`ALTER TABLE users RENAME COLUMN password TO password_hash`);
  }

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamp`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      url text,
      description text,
      monitoring_schedule text NOT NULL DEFAULT 'off',
      webhook_secret text,
      monitoring_paused boolean NOT NULL DEFAULT false,
      last_scheduled_run_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS monitoring_schedule text NOT NULL DEFAULT 'off'`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_secret text`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS monitoring_paused boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_scheduled_run_at timestamp`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS generated_tests (
      id serial PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title text,
      framework text,
      prompt text,
      url text,
      code text NOT NULL,
      review jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE generated_tests
      ADD COLUMN IF NOT EXISTS review jsonb;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id serial PRIMARY KEY,
      generated_test_id integer NOT NULL REFERENCES generated_tests(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending',
      output text,
      passed_count integer,
      failed_count integer,
      total_count integer,
      started_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp,
      heal_attempts integer DEFAULT 0,
      heal_log text,
      healed boolean DEFAULT false,
      trigger text NOT NULL DEFAULT 'manual'
    );
  `);

  await pool.query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS heal_attempts integer DEFAULT 0`);
  await pool.query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS heal_log text`);
  await pool.query(`ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS healed boolean DEFAULT false`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_run_log (
      id serial PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      triggered_at timestamp NOT NULL DEFAULT now(),
      trigger text NOT NULL,
      tests_evaluated jsonb,
      tests_run integer NOT NULL DEFAULT 0,
      passed integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      notification_sent boolean NOT NULL DEFAULT false,
      dream_summary text
    );
  `);
  await pool.query(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS openclaw_webhook_url text;
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS alert_email text;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_memory (
      id serial PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type text NOT NULL DEFAULT 'selector',
      pattern text NOT NULL,
      selector text NOT NULL,
      confidence real NOT NULL DEFAULT 1.0,
      tags text[],
      created_at timestamp DEFAULT NOW() NOT NULL,
      updated_at timestamp DEFAULT NOW() NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE project_memory ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'selector'`);
}

function ensureMemPalaceSetup() {
  const venvPath = join(process.cwd(), ".venv");
  if (!existsSync(venvPath)) {
    log("MemPalace .venv not found — running setup script...", "mempalace");
    try {
      execFileSync("bash", [join(process.cwd(), "scripts", "setup-mempalace.sh")], {
        stdio: "inherit",
        timeout: 120000,
      });
    } catch (err) {
      log(`MemPalace setup failed: ${err}. Semantic search will fall back to PostgreSQL.`, "mempalace");
    }
  }
}

const app = express();
const httpServer = createServer(app);

const PgStore = connectPgSimple(session);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    try {
      await WebhookHandlers.processWebhook(req.body, sig);
      res.json({ received: true });
    } catch (err: any) {
      console.error("[stripe-webhook] Error:", err.message);
      res.status(400).json({ error: err.message });
    }
  },
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "autotest-ai-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await runMigrations();

  ensureMemPalaceSetup();

  const { initMemPalace } = await import("./mempalace");
  initMemPalace();

  initPassmark();

  startGooseSidecar();

  process.on("SIGTERM", () => { stopGooseSidecar(); });
  process.on("SIGINT", () => { stopGooseSidecar(); });
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startScheduler();
    },
  );
})();
