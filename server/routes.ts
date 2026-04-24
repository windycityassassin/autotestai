import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { stripeService, PLAN_LIMITS, type PlanId } from "./stripeService";
import { getStripePublishableKey } from "./stripeClient";
import { insertWaitlistSchema, insertProjectSchema, insertProjectMemorySchema } from "@shared/schema";
import { projects, generatedTests, testRuns, scheduledRunLog, projectMemory } from "@shared/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { TestReview } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcrypt";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { toolDefinitions, executeTool, synthesizeTestCode, sanitizeGeneratedCode, lintFallbackCode, type TestStep, type AssertionStep } from "./tools";
import { runScheduledCheck } from "./scheduler";
import crypto from "crypto";
import { isHealthy, runHealSession, runParallelGeneration } from "./goose";
import * as mempalace from "./mempalace";
import { parsePassmarkPhases, hasGeminiKey, hasRedisUrl } from "./passmark-config";
import { sendAlert, sendTestNotification } from "./notifications";

function extractSelectorsFromCode(code: string): Array<{ key: string; value: string }> {
  const selectors: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();

  // Extract getBy* calls
  const getByPattern = /page\.(getByRole|getByText|getByLabel|getByPlaceholder|getByAltText|getByTitle|getByTestId)\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = getByPattern.exec(code)) !== null) {
    const method = m[1];
    const args = m[2].trim();
    const key = `${method}(${args})`;
    if (!seen.has(key)) {
      seen.add(key);
      selectors.push({ key, value: `page.${method}(${args})` });
    }
  }

  // Extract locator() calls
  const locatorPattern = /page\.locator\((['"`][^'"`]+['"`])\)/g;
  while ((m = locatorPattern.exec(code)) !== null) {
    const key = `locator(${m[1]})`;
    if (!seen.has(key)) {
      seen.add(key);
      selectors.push({ key, value: `page.locator(${m[1]})` });
    }
  }

  // Extract data-testid attributes
  const testIdPattern = /\[data-testid=['"]([^'"]+)['"]\]/g;
  while ((m = testIdPattern.exec(code)) !== null) {
    const key = `testid:${m[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      selectors.push({ key, value: `[data-testid="${m[1]}"]` });
    }
  }

  return selectors;
}

async function extractMemoryFromPassedRun(projectId: number, testCode: string): Promise<void> {
  try {
    const selectors = extractSelectorsFromCode(testCode);
    for (const { key, value } of selectors) {
      await storage.upsertMemoryItem(projectId, "selector", key, value, 1);
    }

    // Also extract Passmark step descriptions as patterns (for MemPalace learning)
    const stepPattern = /\{\s*description:\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = stepPattern.exec(testCode)) !== null) {
      const desc = m[1];
      if (desc && desc.length > 5) {
        await storage.upsertMemoryItem(projectId, "pattern", `passmark_step:${desc.slice(0, 80)}`, desc, 1);
      }
    }

    const assertionPattern = /\{\s*assertion:\s*['"`]([^'"`]+)['"`]/g;
    while ((m = assertionPattern.exec(testCode)) !== null) {
      const assertion = m[1];
      if (assertion && assertion.length > 5) {
        await storage.upsertMemoryItem(projectId, "pattern", `passmark_assertion:${assertion.slice(0, 80)}`, assertion, 1);
      }
    }
  } catch (err) {
    console.error("Memory extraction error:", err);
  }
}

async function recordHealMemory(projectId: number, brokenCode: string, fixedCode: string): Promise<void> {
  try {
    const fixedSelectors = extractSelectorsFromCode(fixedCode);
    for (const { key, value } of fixedSelectors) {
      await storage.upsertMemoryItem(projectId, "selector", key, value, 2);
    }

    const brokenSelectors = extractSelectorsFromCode(brokenCode);
    const fixedKeys = new Set(fixedSelectors.map((s) => s.key));
    for (const { key, value } of brokenSelectors) {
      if (!fixedKeys.has(key)) {
        await storage.upsertMemoryItem(projectId, "anti_pattern", `broken:${key}`, value, 1);
      }
    }
  } catch (err) {
    console.error("Heal memory recording error:", err);
  }
}

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

const generateTestSchema = z.object({
  framework: z.enum(["playwright", "cypress"]),
  prompt: z.string().min(1, "Prompt is required"),
  url: z.string().optional(),
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

function buildSystemPrompt(framework: string, url?: string, memoryContext?: string): string {
  const frameworkName = framework === "playwright" ? "Playwright" : "Cypress";
  const imports = framework === "playwright"
    ? `import { test, expect } from '@playwright/test';`
    : `/// <reference types="cypress" />`;

  const memorySection = memoryContext
    ? `\n\nProject Memory (verified selectors and patterns from previous runs — prefer these selectors, avoid anti_patterns):\n${memoryContext}\n`
    : "";

  return `You are an expert test automation engineer specializing in ${frameworkName}. 
Your task is to generate a complete, production-ready ${frameworkName} test file based on the user's description.

Requirements:
- Start with the correct imports: ${imports}
- Use proper describe blocks to group related tests
- Write multiple specific test cases (at minimum 3-5) covering the described functionality
- Include meaningful assertions that verify real behavior
- Use data-testid attributes where appropriate (e.g., [data-testid="button-submit"])
- Handle async/await properly
- Add comments explaining each test case
- Include edge cases and error states where relevant
- Make selectors robust and maintainable
${url ? `- The application being tested is at: ${url}` : ""}
- AVOID selectors tagged as anti_pattern in the project memory${memorySection}
- Output ONLY the test file code with no markdown code fences, no explanations before or after
- The file should be immediately runnable with ${frameworkName}
- AVOID selectors tagged as anti_pattern in the project memory${memorySection}

Generate a complete, well-structured test file now.`;
}

function generateTestCode(projectUrl: string, projectName: string): string {
  const sanitizedUrl = projectUrl.trim().replace(/\/$/, "");
  return `import { test, expect } from '@playwright/test';
import { runSteps, assert } from 'passmark';

test.describe('${projectName} - Automated Tests', () => {
  test('homepage loads and has visible content', async ({ page }) => {
    test.setTimeout(120_000);
    await runSteps({
      page,
      userFlow: 'Homepage basic checks',
      steps: [
        { description: 'Navigate to ${sanitizedUrl}' },
        { description: 'Wait for the page to fully load' },
      ],
      assertions: [
        { assertion: 'The page has loaded successfully with a status under 400' },
        { assertion: 'The page has a non-empty title' },
        { assertion: 'The page body is visible and has content' },
      ],
      test,
      expect,
    });
    // Multi-model consensus assertion (Claude + Gemini)
    await assert({ page, assertion: 'The homepage has loaded successfully and displays content', test, expect });
  });

  test('page navigation works', async ({ page }) => {
    test.setTimeout(120_000);
    await runSteps({
      page,
      userFlow: 'Navigation check',
      steps: [
        { description: 'Navigate to ${sanitizedUrl}' },
      ],
      assertions: [
        { assertion: 'The page has at least one clickable link or navigation element' },
      ],
      test,
      expect,
    });
  });

  test('page is responsive on mobile', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 667 });
    await runSteps({
      page,
      userFlow: 'Mobile responsiveness check',
      steps: [
        { description: 'Navigate to ${sanitizedUrl}' },
      ],
      assertions: [
        { assertion: 'The page renders correctly on a mobile viewport (375x667)' },
        { assertion: 'The main content is visible and not broken' },
      ],
      test,
      expect,
    });
  });
});
`;
}

function parsePlaywrightOutput(output: string): {
  passed: number;
  failed: number;
  total: number;
  passmarkPhases?: { cacheHits: number; cacheMisses: number; autoHealTriggered: boolean; redisDisabled: boolean };
} {
  let passed = 0;
  let failed = 0;

  const passedMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+failed/);

  if (passedMatch) passed = parseInt(passedMatch[1], 10);
  if (failedMatch) failed = parseInt(failedMatch[1], 10);

  const total = passed + failed;

  const isPassmarkTest = /from ['"]passmark['"]/.test(output) ||
    /Executing Cached Step:|Executing Step:|passmark-ai/.test(output) ||
    /runSteps/.test(output);

  const passmarkPhases = isPassmarkTest ? parsePassmarkPhases(output) : undefined;

  return { passed, failed, total, passmarkPhases };
}

function cleanupTempFiles(runId: number) {
  const projectRoot = process.cwd();
  const configFile = join(projectRoot, `playwright-tmp-${runId}.config.ts`);
  const tempDir = join(tmpdir(), `playwright-run-${runId}`);
  try { unlinkSync(configFile); } catch (_) {}
  try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
}

function sweepOrphanedTempFiles() {
  try {
    const projectRoot = process.cwd();
    const entries = readdirSync(projectRoot);
    for (const entry of entries) {
      if (/^playwright-tmp-\d+\.config\.ts$/.test(entry)) {
        try { unlinkSync(join(projectRoot, entry)); } catch (_) {}
      }
    }
    const tmp = tmpdir();
    const tmpEntries = readdirSync(tmp);
    for (const entry of tmpEntries) {
      if (/^playwright-run-\d+$/.test(entry)) {
        try { rmSync(join(tmp, entry), { recursive: true, force: true }); } catch (_) {}
      }
    }
    console.log("[startup] Orphaned temp file sweep complete");
  } catch (err) {
    console.warn("[startup] Temp file sweep error:", err);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  sweepOrphanedTempFiles();

  app.post("/api/waitlist", async (req, res) => {
    try {
      const data = insertWaitlistSchema.parse(req.body);
      const alreadyExists = await storage.isEmailOnWaitlist(data.email);
      if (alreadyExists) {
        return res.status(409).json({ message: "You're already on the waitlist!" });
      }
      const entry = await storage.addToWaitlist(data);
      const count = await storage.getWaitlistCount();
      res.status(201).json({ success: true, entry, count });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      console.error("Waitlist error:", error);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.get("/api/waitlist/count", async (req, res) => {
    try {
      const count = await storage.getWaitlistCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Error fetching count" });
    }
  });

  // Demo auto-login — creates/retrieves sandbox account, sets session, returns project id
  app.get("/api/demo/access", async (req, res) => {
    try {
      const DEMO_EMAIL = "demo@autotestai.com";
      let user = await storage.getUserByEmail(DEMO_EMAIL);
      if (!user) {
        const hash = await bcrypt.hash("DemoAutoTestAI2026!", 12);
        user = await storage.createUser({ email: DEMO_EMAIL, name: "Demo User", passwordHash: hash });
        await storage.createDemoProject(user.id);
      }
      const allProjects = await storage.getProjectsByUser(user.id);
      let demoProject = allProjects.find((p: any) => p.isDemo);
      if (!demoProject) {
        demoProject = await storage.createDemoProject(user.id);
      } else {
        // Backfill seed data on existing demo projects
        await storage.seedDemoData(demoProject.id);
      }
      req.session.userId = user.id;
      await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
      const { passwordHash: _ph, ...safeUser } = user;
      res.json({ user: safeUser, projectId: demoProject.id });
    } catch (err) {
      console.error("[demo/access]", err);
      res.status(500).json({ message: "Demo setup failed" });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = registerSchema.parse(req.body);
      const existing = await storage.getUserByEmail(data.email);
      if (existing) {
        return res.status(409).json({ message: "Email already in use" });
      }
      const passwordHash = await bcrypt.hash(data.password, 12);
      const user = await storage.createUser({
        email: data.email,
        name: data.name,
        passwordHash,
      });
      req.session.userId = user.id;

      // Seed Twenty CRM demo project for every new registration
      let demoSeedFailed = false;
      try {
        await storage.createDemoProject(user.id);
      } catch (seedErr) {
        demoSeedFailed = true;
        console.error("[register] Failed to seed demo project:", seedErr);
      }

      const { passwordHash: _ph, ...safeUser } = user;
      res.status(201).json({ user: safeUser, ...(demoSeedFailed && { warning: "Demo project could not be created. You can add a project manually." }) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      const valid = await bcrypt.compare(data.password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      req.session.userId = user.id;
      const { passwordHash: _ph, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const user = await storage.getUserById(req.session.userId);
      if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ message: "User not found" });
      }
      const { passwordHash: _ph, ...safeUser } = user;
      res.json({ user: safeUser });
    } catch (error) {
      res.status(500).json({ message: "Error fetching user" });
    }
  });

  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      const projects = await storage.getProjectsByUser(req.session.userId!);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Error fetching projects" });
    }
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(req.session.userId!, data);
      res.status(201).json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Create project error:", error);
      res.status(500).json({ message: "Error creating project" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Error fetching project" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteProject(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error deleting project" });
    }
  });

  app.get("/api/projects/:id/tests", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const tests = await storage.getGeneratedTestsByProjectId(project.id);
      res.json(tests);
    } catch (error) {
      console.error("Tests list error:", error);
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.delete("/api/projects/:id/tests/:testId", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const testId = parseInt(String(req.params.testId), 10);
      if (isNaN(id) || isNaN(testId)) return res.status(400).json({ message: "Invalid ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const test = await storage.getGeneratedTestById(testId);
      if (!test) return res.status(404).json({ message: "Test not found" });
      if (test.projectId !== project.id) return res.status(403).json({ message: "Forbidden" });
      await storage.deleteGeneratedTest(test.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete test error:", error);
      res.status(500).json({ message: "Failed to delete test" });
    }
  });

  // SSE streaming AI test generation (multi-agent tool-use pipeline)
  app.post("/api/projects/:id/generate-test", requireAuth, async (req, res) => {
    // Hoist cleanup handles outside try so catch can safely call finishGenerate
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let generationTimeout: ReturnType<typeof setTimeout> | undefined;
    let generationTimedOut = false;
    const generationAbort = new AbortController();

    const finishGenerate = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (generationTimeout) clearTimeout(generationTimeout);
      // Abort any in-flight Anthropic request
      if (!generationAbort.signal.aborted) generationAbort.abort();
    };

    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { framework, prompt, url } = generateTestSchema.parse(req.body);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const sendEvent = (data: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // SSE keep-alive heartbeat every 15 seconds
      heartbeat = setInterval(() => {
        try { res.write(":\n\n"); } catch (_) {}
      }, 15000);

      // 3-minute hard timeout: sets flag AND aborts any in-flight Anthropic request
      generationTimeout = setTimeout(() => {
        generationTimedOut = true;
        if (!generationAbort.signal.aborted) generationAbort.abort();
      }, 3 * 60 * 1000);

      // Build memory context for injection into system prompt
      const memoryItems = await storage.getMemoryByProject(project.id);
      let memoryContextSection = "";
      if (memoryItems.length > 0) {
        const lines = memoryItems
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 30)
          .map((m) => `[${m.type}] ${m.pattern}: ${m.selector} (confidence: ${m.confidence.toFixed(1)})`);
        memoryContextSection = `\n\nProject Memory (verified selectors and anti-patterns from previous runs — use selectors, avoid anti_patterns):\n${lines.join("\n")}`;
      }

      const targetUrl = url || project.url || undefined;

      // Phase 1: Inspecting page
      sendEvent({ phase: "inspecting", phaseLabel: "Inspecting page..." });

      const testSteps: Array<TestStep | AssertionStep> = [];
      const knownSelectors = new Set<string>();

      const frameworkName = framework === "playwright" ? "Playwright" : "Cypress";
      const passmarkImports = framework === "playwright"
        ? `import { test, expect } from '@playwright/test';\nimport { runSteps, assert } from 'passmark';`
        : null;
      const imports = framework === "playwright"
        ? `import { test, expect } from '@playwright/test';\nimport { runSteps, assert } from 'passmark';`
        : `/// <reference types="cypress" />`;

      let pageInspectFailed = false;
      let pageInspectSucceeded = false;

      const passmarkInstructions = framework === "playwright" ? `

PASSMARK FORMAT REQUIRED for Playwright tests:
- Import THREE things: import { test, expect } from '@playwright/test'; AND import { runSteps, assert } from 'passmark';
- Use test.setTimeout(120_000) at the top of each test.
- Instead of raw page.locator().click() calls, use Passmark's runSteps() with natural language step descriptions.
- Each step: { description: "Click the login button" } or { description: "Fill in the email field", data: { value: "{{run.email}}" } }
- For dynamic test data values, use Passmark's {{run.*}} placeholder syntax:
  - Email addresses → data: { value: "{{run.email}}" }
  - Passwords → data: { value: "{{run.password}}" }
  - User names → data: { value: "{{run.name}}" }
  - Usernames → data: { value: "{{run.username}}" }
  - Phone numbers → data: { value: "{{run.phone}}" }
- Put assertions inside the runSteps assertions array AND also call assert() directly for key post-run checks.
- assert() uses Claude + Gemini multi-model consensus for higher accuracy than single-model.
- Example format:
  await runSteps({
    page,
    userFlow: "Login flow",
    steps: [
      { description: "Navigate to https://example.com" },
      { description: "Click the sign in button" },
      { description: "Fill in the email field", data: { value: "{{run.email}}" } },
      { description: "Fill in the password field", data: { value: "{{run.password}}" } },
      { description: "Click the submit button" },
    ],
    assertions: [{ assertion: "The user is logged in and sees the dashboard" }],
    test,
    expect,
  });
  // Multi-model consensus assertion (Claude + Gemini)
  await assert({ page, assertion: "The user dashboard is visible and the user is authenticated", test, expect });` : "";

      const systemPrompt = `You are an expert test automation engineer specializing in ${frameworkName}.

You have access to five tools:
1. get_memory(pattern) — Retrieves past verified selectors and patterns from project memory. Call this FIRST to discover selectors that have already worked for this project.
2. inspect_page(url) — Fetches the real page and returns interactive elements as structured JSON including their verified selectors. ALWAYS call this if a URL is available (after get_memory).
3. identify_flows(elements, prompt) — Identifies testable user flows from the elements.
4. write_test_step(action, selector, value?) — Appends one verified step. The tool will warn you if the selector is not in the verified set from inspect_page. Use ONLY selectors from inspect_page results.
5. assert(selector, expected) — Appends one assertion. The tool will warn you if the selector is not verified.

Instructions:
- FIRST call get_memory with a description of what you're testing (e.g. "login form", "checkout button") to retrieve past successful selectors.
- If a URL is provided, use inspect_page NEXT to get real, verified selectors. Memory selectors from get_memory may also be used if confirmed by inspect_page.
- If inspect_page fails or returns an error, generate tests from the description only using generic selectors like body, h1, a, button — do NOT invent specific class names or IDs.
- Use write_test_step and assert to build the test step by step using verified selectors.
- When all steps are recorded, output the complete final ${frameworkName} test file as plain text (no markdown fences).
- The file MUST start with: ${imports}
- Group tests in describe blocks. Write at least 3-5 meaningful test cases.
- Add comments explaining each test case.
- For each test, use the actual selectors recorded in write_test_step/assert calls wherever possible.${passmarkInstructions}${memoryContextSection}`;

      const userMessage = targetUrl
        ? `Generate ${frameworkName} tests for: ${prompt}\n\nURL to inspect: ${targetUrl}\n\nStart by calling get_memory("${prompt.slice(0, 80)}") to retrieve any past selectors, then call inspect_page("${targetUrl}") to get real selectors.`
        : `Generate ${frameworkName} tests for: ${prompt}\n\nNo URL was provided. Start by calling get_memory("${prompt.slice(0, 80)}") to check for any past selectors. Then immediately use write_test_step and assert with generic selectors (body, h1, a, button, input) to build the test, then output the complete test file.`;

      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: userMessage },
      ];

      let fullCode = "";
      let writingPhaseStarted = false;
      let toolRounds = 0;
      const MAX_TOOL_ROUNDS = 20;

      // Phase 2: Tool-use agent loop
      while (toolRounds < MAX_TOOL_ROUNDS) {
        if (generationTimedOut) {
          sendEvent({ error: "Test generation timed out after 3 minutes. Please try again." });
          finishGenerate();
          res.end();
          return;
        }
        toolRounds++;
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          system: systemPrompt,
          tools: toolDefinitions as Anthropic.Tool[],
          messages,
        }, { signal: generationAbort.signal });

        // Add assistant's response to message history
        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "end_turn") {
          for (const block of response.content) {
            if (block.type === "text") {
              fullCode += block.text;
            }
          }
          break;
        }

        if (response.stop_reason === "tool_use") {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type !== "tool_use") continue;

            if (block.name === "get_memory") {
              sendEvent({ phase: "inspecting", phaseLabel: "Retrieving memory...", tool: block.name, toolStatus: "start" });
            } else if (block.name === "inspect_page") {
              sendEvent({ phase: "inspecting", phaseLabel: "Inspecting page...", tool: block.name, toolStatus: "start" });
            } else if (block.name === "identify_flows") {
              sendEvent({ phase: "inspecting", phaseLabel: "Identifying flows...", tool: block.name, toolStatus: "start" });
            } else if (block.name === "write_test_step" || block.name === "assert") {
              if (!writingPhaseStarted) {
                writingPhaseStarted = true;
                sendEvent({ phase: "writing", phaseLabel: "Writing test...", tool: block.name, toolStatus: "start" });
              }
            }

            let result: unknown;
            if (block.name === "get_memory") {
              const pattern = (block.input as Record<string, unknown>).pattern as string;
              try {
                if (mempalace.isHealthy()) {
                  console.log(`[mempalace] Semantic retrieval for projectId=${project.id}, query="${pattern}"`);
                  const semanticResults = await mempalace.searchMemory(project.id, pattern, 5);
                  console.log(`[mempalace] Semantic path: returned ${semanticResults.length} results`);
                  result = { memories: semanticResults, source: "mempalace" };
                } else {
                  console.warn(`[mempalace] Unavailable — falling back to PostgreSQL text search for "${pattern}"`);
                  const pgResults = await storage.searchMemoryByText(project.id, pattern, 5);
                  result = {
                    memories: pgResults.map((m) => ({
                      pattern: m.pattern,
                      selector: m.selector,
                      confidence: m.confidence,
                      tags: m.tags ?? undefined,
                    })),
                    source: "postgres_fallback",
                  };
                }
              } catch (err) {
                console.warn("[mempalace] get_memory error, falling back to PostgreSQL:", err);
                try {
                  const pgResults = await storage.searchMemoryByText(project.id, pattern, 5);
                  result = {
                    memories: pgResults.map((m) => ({
                      pattern: m.pattern,
                      selector: m.selector,
                      confidence: m.confidence,
                      tags: m.tags ?? undefined,
                    })),
                    source: "postgres_fallback",
                  };
                } catch (pgErr) {
                  result = { memories: [], source: "error", error: String(pgErr) };
                }
              }
            } else {
              result = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                testSteps,
                knownSelectors,
                !!targetUrl
              );
            }

            // Emit post-tool status event
            const toolSucceeded = block.name === "get_memory"
              ? typeof result === "object" && result !== null && !(result as Record<string, unknown>).error
              : typeof result === "object" && result !== null && (result as Record<string, unknown>).success !== false;
            sendEvent({ tool: block.name, toolStatus: toolSucceeded ? "done" : "rejected" });

            // Track inspect_page success/failure for inspection contract enforcement
            if (
              block.name === "inspect_page" &&
              typeof result === "object" &&
              result !== null &&
              "success" in result
            ) {
              if ((result as { success: boolean }).success) {
                pageInspectSucceeded = true;
              } else {
                pageInspectFailed = true;
                sendEvent({
                  phase: "writing",
                  phaseLabel: "Could not inspect page — generating from description only",
                  fallback: true,
                });
              }
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }

          messages.push({ role: "user", content: toolResults });
        } else {
          for (const block of response.content) {
            if (block.type === "text") {
              fullCode += block.text;
            }
          }
          break;
        }
      }

      // Guard: if the loop exited due to MAX_TOOL_ROUNDS, emit a warning and use synthesized code
      if (toolRounds >= MAX_TOOL_ROUNDS && !fullCode) {
        sendEvent({ phase: "writing", phaseLabel: "Tool loop limit reached — using synthesized steps", fallback: true });
        const synthesized = synthesizeTestCode(testSteps, framework, targetUrl, prompt);
        fullCode = synthesized ?? "";
      }

      // Inspection contract: if a URL was provided but inspect_page was never successfully
      // called, the model skipped inspection — force deterministic fallback.
      if (targetUrl && !pageInspectSucceeded && !pageInspectFailed) {
        pageInspectFailed = true;
        sendEvent({
          phase: "writing",
          phaseLabel: "Inspection was skipped — falling back to description-only output",
          fallback: true,
        });
        // Discard any code the model produced without inspecting
        fullCode = "";
      }

      // Clean up markdown fences if present
      fullCode = fullCode
        .replace(/^```[\w]*\n?/m, "")
        .replace(/\n?```\s*$/m, "")
        .trim();

      // Selector enforcement: when we have verified inspected selectors, ensure the code
      // only uses them. This runs regardless of whether testSteps were recorded.
      if (knownSelectors.size > 0 && fullCode.length >= 50) {
        const { hadHallucinations } = sanitizeGeneratedCode(fullCode, knownSelectors, framework);
        if (hadHallucinations) {
          if (testSteps.length > 0) {
            const synthesized = synthesizeTestCode(testSteps, framework, targetUrl, prompt);
            if (synthesized) fullCode = synthesized;
          } else {
            fullCode = "";
          }
        }
      } else if (testSteps.length > 0 && fullCode.length < 50) {
        const synthesized = synthesizeTestCode(testSteps, framework, targetUrl, prompt);
        if (synthesized) fullCode = synthesized;
      }

      // Strict fallback: if code is still empty/short, generate description-only test.
      // When inspection failed, do NOT include the original URL to avoid inventing
      // page-specific selectors. Use only generic selectors.
      if (!fullCode || fullCode.length < 50) {
        if (!writingPhaseStarted) {
          sendEvent({
            phase: "writing",
            phaseLabel: pageInspectFailed
              ? "Could not inspect page — generating from description only"
              : "Writing test...",
            fallback: pageInspectFailed,
          });
        }
        const descriptionOnlySystem = framework === "playwright"
          ? `You are an expert test automation engineer specializing in Playwright with Passmark.
Generate a complete Playwright + Passmark test file from the user's description.
Requirements:
- Start with BOTH imports:
  import { test, expect } from '@playwright/test';
  import { runSteps, assert } from 'passmark';
- Use Passmark's runSteps() with natural language step descriptions — do NOT use page.locator() or raw selectors
- Describe steps in plain English: { description: "Click the submit button" }
- For dynamic values, use {{run.*}} placeholders: data: { value: "{{run.email}}" }, data: { value: "{{run.password}}" }
- Put inline checks in the runSteps assertions array
- After each runSteps block, add: await assert({ page, assertion: "...", test, expect }); for multi-model consensus
- Add test.setTimeout(120_000) in each test
- Write 3-5 test cases in a describe block
- For navigation steps, use descriptions like "Navigate to https://example.com"
- Output ONLY code, no markdown fences`
          : `You are an expert test automation engineer specializing in Cypress.
Generate a complete Cypress test file from the user's description.
Requirements:
- Start with: /// <reference types="cypress" />
- Use ONLY generic, universal selectors: body, h1, h2, h3, p, a, button, input, form, textarea, select, [role="..."]
- Do NOT use any page-specific class names, IDs, or data-testid values — those would be hallucinated since no page was inspected
- Write 3-5 test cases in a describe block
- Include navigation to the page, visibility checks, and interaction tests
- Output ONLY code, no markdown fences`;
        const descriptionOnlyMessage = `Generate ${frameworkName} tests for: ${prompt}
${targetUrl && !pageInspectFailed ? `\nTarget URL (for navigation only — do not invent page-specific selectors): ${targetUrl}` : ""}`;
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          system: descriptionOnlySystem,
          messages: [{ role: "user", content: descriptionOnlyMessage }],
        }, { signal: generationAbort.signal });
        fullCode = "";
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const chunk = event.delta.text;
            if (chunk) fullCode += chunk;
          }
        }
        fullCode = fullCode
          .replace(/^```[\w]*\n?/m, "")
          .replace(/\n?```\s*$/m, "")
          .trim();

        // Strictly enforce generic-selector allowlist on fallback-generated code.
        // If non-generic selectors slipped through despite instructions, discard and
        // replace with a safe deterministic template.
        if (fullCode.length >= 50) {
          const { hasNonGenericSelectors, selectors } = lintFallbackCode(fullCode);
          if (hasNonGenericSelectors) {
            console.warn("Description-only fallback contained non-generic selectors — replacing with safe template:", selectors);
            const navLine = targetUrl && !pageInspectFailed ? targetUrl : null;
            if (framework === "playwright") {
              const safeNav = navLine ? `Navigate to ${navLine}` : "Navigate to the page under test";
              fullCode = `import { test, expect } from '@playwright/test';
import { runSteps, assert } from 'passmark';

test.describe('${prompt.slice(0, 60)}', () => {
  test('page loads', async ({ page }) => {
    test.setTimeout(120_000);
    await runSteps({
      page,
      userFlow: 'Page load check',
      steps: [{ description: '${safeNav}' }],
      assertions: [{ assertion: 'The page body is visible and loaded' }],
      test,
      expect,
    });
  });

  test('contains headings', async ({ page }) => {
    test.setTimeout(120_000);
    await runSteps({
      page,
      userFlow: 'Headings check',
      steps: [{ description: '${safeNav}' }],
      assertions: [{ assertion: 'The page has at least one heading' }],
      test,
      expect,
    });
  });

  test('contains interactive elements', async ({ page }) => {
    test.setTimeout(120_000);
    await runSteps({
      page,
      userFlow: 'Interactive elements check',
      steps: [{ description: '${safeNav}' }],
      assertions: [{ assertion: 'The page has at least one link or button' }],
      test,
      expect,
    });
  });
});`;
            } else {
              fullCode = `${imports}

describe('${prompt.slice(0, 60)}', () => {
  it('page loads', () => {
    ${navLine ? `cy.visit('${navLine}');` : "// cy.visit('/');"}
    cy.get('body').should('be.visible');
  });

  it('contains headings', () => {
    ${navLine ? `cy.visit('${navLine}');` : ""}
    cy.get('h1').should('exist');
  });

  it('contains interactive elements', () => {
    ${navLine ? `cy.visit('${navLine}');` : ""}
    cy.get('a').first().should('exist');
  });
});`;
            }
          }
        }
      }

      if (!writingPhaseStarted) {
        sendEvent({ phase: "writing", phaseLabel: "Writing test..." });
      }

      // Final hard validation: if inspection succeeded but final code still has
      // unverified selectors (e.g., tool loop produced code without using tools),
      // replace with strict generic-only fallback before saving.
      if (knownSelectors.size > 0 && fullCode.length >= 50) {
        const { hadHallucinations } = sanitizeGeneratedCode(fullCode, knownSelectors, framework);
        if (hadHallucinations) {
          if (testSteps.length > 0) {
            const synthesized = synthesizeTestCode(testSteps, framework, targetUrl, prompt);
            if (synthesized) {
              // Second-pass validation: ensure synthesized code doesn't carry any hallucinations
              const secondPass = sanitizeGeneratedCode(synthesized, knownSelectors, framework);
              fullCode = secondPass.hadHallucinations ? "" : synthesized;
            } else {
              fullCode = "";
            }
          } else {
            fullCode = "";
          }
          if (!fullCode || fullCode.length < 50) {
            const descriptionOnlySystem = framework === "playwright"
              ? `You are an expert test automation engineer specializing in Playwright with Passmark.
Generate a complete Playwright + Passmark test file. Use runSteps() with natural language descriptions instead of raw selectors.
Start with BOTH imports:
  import { test, expect } from '@playwright/test';
  import { runSteps, assert } from 'passmark';
Use {{run.email}}, {{run.password}}, {{run.name}} etc. for dynamic values.
After each runSteps block, add: await assert({ page, assertion: "...", test, expect }); for multi-model consensus.
Add test.setTimeout(120_000) in each test. Output ONLY code, no markdown fences.`
              : `You are an expert test automation engineer specializing in Cypress.
Generate a complete Cypress test file using ONLY generic selectors (body, h1, a, button, input) — no page-specific selectors.
Start with: /// <reference types="cypress" />
Output ONLY code, no markdown fences.`;
            const fallbackResp = await anthropic.messages.create({
              model: "claude-sonnet-4-5",
              max_tokens: 4096,
              system: descriptionOnlySystem,
              messages: [{ role: "user", content: `Generate ${frameworkName} tests for: ${prompt}` }],
            }, { signal: generationAbort.signal });
            fullCode = fallbackResp.content
              .filter((b) => b.type === "text")
              .map((b) => (b as Anthropic.TextBlock).text)
              .join("")
              .replace(/^```[\w]*\n?/m, "")
              .replace(/\n?```\s*$/m, "")
              .trim();
          }
        }
      }

      // If code is still empty after all fallbacks, send a visible error and bail
      if (!fullCode || fullCode.length < 50) {
        sendEvent({ error: "AI generation did not produce valid test code. Please try again with a more specific prompt." });
        finishGenerate();
        res.end();
        return;
      }

      sendEvent({ content: fullCode });

      // Save the generated test
      const savedTest = await storage.createGeneratedTest({
        projectId: project.id,
        framework,
        prompt,
        url: targetUrl || null,
        title: `${project.name} — ${frameworkName} tests`,
        code: fullCode,
      });

      // Phase 3: Reviewer agent
      sendEvent({ phase: "reviewing", phaseLabel: "Reviewing quality..." });

      const unverifiedCount = testSteps.filter((s) => !s.isVerified).length;
      const verifiedContext = knownSelectors.size > 0
        ? `The test was generated using real selectors from page inspection. Known verified selectors: ${Array.from(knownSelectors).slice(0, 20).join(", ")}.`
        : pageInspectFailed
        ? "Note: Page inspection failed, so this test was generated from description only without verified selectors."
        : "Note: No URL was provided, so this test was generated from description only.";

      const unverifiedNote = unverifiedCount > 0
        ? ` Additionally, ${unverifiedCount} step(s) used selectors not confirmed during inspection.`
        : "";

      let review: TestReview = { score: 0, flags: [] };
      try {
        const reviewResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          system: `You are a test quality reviewer. Analyze the given ${frameworkName} test file and return a structured quality report as JSON.

${verifiedContext}${unverifiedNote}

Return ONLY valid JSON in this exact format:
{
  "score": <0-100 integer>,
  "flags": [
    { "level": "green" | "yellow" | "red", "message": "description", "line": <optional line number> }
  ]
}

Green flags = good practices found (e.g. uses real verified selectors, has assertions, covers error cases).
Yellow = minor issues (e.g. missing edge cases, could use more specific selectors).
Red = serious problems (e.g. hallucinated class names not on page, no assertions, test will always pass regardless of behavior).
Be specific and actionable. Score 80+ is good, 60-79 is acceptable, below 60 needs work.
If the test was generated from description only (no page inspection), lower the score proportionally and flag that selectors are unverified.`,
          messages: [
            {
              role: "user",
              content: `Review this ${frameworkName} test:\n\n${fullCode}`,
            },
          ],
        }, { signal: generationAbort.signal });

        const reviewText = reviewResponse.content
          .filter((b) => b.type === "text")
          .map((b) => (b as Anthropic.TextBlock).text)
          .join("");

        const reviewSchema = z.object({
          score: z.number().int().min(0).max(100),
          flags: z.array(
            z.object({
              level: z.enum(["green", "yellow", "red"]),
              message: z.string(),
              line: z.number().optional(),
            })
          ),
        });
        const jsonMatch = reviewText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = reviewSchema.safeParse(JSON.parse(jsonMatch[0]));
          if (parsed.success) {
            review = parsed.data;
          } else {
            console.warn("Review JSON failed validation:", parsed.error.issues);
          }
        }
      } catch (reviewError) {
        console.error("Review agent error:", reviewError);
        review = {
          score: 50,
          flags: [{ level: "yellow", message: "Could not complete quality review." }],
        };
      }

      // Update the saved test with the review
      const updatedTest = await storage.updateGeneratedTest(savedTest.id, { review });

      finishGenerate();
      sendEvent({ done: true, test: updatedTest, review });
      res.end();
    } catch (error) {
      finishGenerate();
      const isAbort = generationTimedOut || (error instanceof Error && error.name === "AbortError");
      const errorMsg = isAbort
        ? "Test generation timed out after 3 minutes. Please try again."
        : "Generation failed. Please try again.";
      if (!isAbort) console.error("Generate test error:", error);
      if (res.headersSent) {
        try {
          res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
          res.end();
        } catch (_) {}
      } else {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: error.errors[0]?.message || "Invalid data" });
        }
        res.status(500).json({ message: "Failed to generate test" });
      }
    }
  });

  // Quick template-based generation (no prompt required)
  app.post("/api/projects/:id/tests/generate", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const code = generateTestCode(project.url || "https://example.com", project.name);
      const test = await storage.createGeneratedTest({
        projectId: id,
        title: `${project.name} - Playwright Tests`,
        framework: "playwright",
        code,
      });
      res.status(201).json(test);
    } catch (error) {
      console.error("Generate test error:", error);
      res.status(500).json({ message: "Error generating test" });
    }
  });

  app.get("/api/tests/:testId", requireAuth, async (req, res) => {
    try {
      const testId = parseInt(String(req.params.testId), 10);
      if (isNaN(testId)) return res.status(400).json({ message: "Invalid test ID" });
      const test = await storage.getGeneratedTestById(testId);
      if (!test) return res.status(404).json({ message: "Test not found" });
      const project = await storage.getProjectById(test.projectId);
      if (!project || project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(test);
    } catch (error) {
      res.status(500).json({ message: "Error fetching test" });
    }
  });

  app.delete("/api/tests/:testId", requireAuth, async (req, res) => {
    try {
      const testId = parseInt(String(req.params.testId), 10);
      if (isNaN(testId)) return res.status(400).json({ message: "Invalid test ID" });
      const test = await storage.getGeneratedTestById(testId);
      if (!test) return res.status(404).json({ message: "Test not found" });
      const project = await storage.getProjectById(test.projectId);
      if (!project || project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteGeneratedTest(testId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error deleting test" });
    }
  });

  app.get("/api/tests/:testId/runs", requireAuth, async (req, res) => {
    try {
      const testId = parseInt(String(req.params.testId), 10);
      if (isNaN(testId)) return res.status(400).json({ message: "Invalid test ID" });
      const test = await storage.getGeneratedTestById(testId);
      if (!test) return res.status(404).json({ message: "Test not found" });
      const project = await storage.getProjectById(test.projectId);
      if (!project || project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const runs = await storage.getTestRunsByTest(testId);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Error fetching runs" });
    }
  });

  app.post("/api/tests/:testId/run", requireAuth, async (req, res) => {
    const testId = parseInt(String(req.params.testId), 10);
    if (isNaN(testId)) return res.status(400).json({ message: "Invalid test ID" });

    try {
      const test = await storage.getGeneratedTestById(testId);
      if (!test) return res.status(404).json({ message: "Test not found" });
      const project = await storage.getProjectById(test.projectId);
      if (!project || project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const run = await storage.createTestRun(testId);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (type: string, data: unknown) => {
        res.write(`data: ${JSON.stringify({ type, ...( typeof data === "object" ? data : { message: data }) })}\n\n`);
      };

      // SSE keep-alive heartbeat
      const runHeartbeat = setInterval(() => {
        try { res.write(":\n\n"); } catch (_) {}
      }, 15000);
      const stopRunHeartbeat = () => clearInterval(runHeartbeat);

      sendEvent("start", { runId: run.id, testId });

      const tempDir = join(tmpdir(), `playwright-run-${run.id}`);
      mkdirSync(tempDir, { recursive: true });

      const testFile = join(tempDir, "test.spec.ts");
      writeFileSync(testFile, test.code);

      const projectRoot = process.cwd();
      const configFile = join(projectRoot, `playwright-tmp-${run.id}.config.ts`);
      const configContent = `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '${tempDir}',
  timeout: 30000,
  reporter: [['list']],
  use: { headless: true },
  workers: 1,
});
`;
      writeFileSync(configFile, configContent);

      const nixLibPaths = (process.env.NIX_LDFLAGS || "")
        .split(" ")
        .filter((f) => f.startsWith("-L"))
        .map((f) => f.slice(2))
        .join(":");

      const proc = spawn(
        "npx",
        ["playwright", "test", "--config", configFile],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, ".cache", "ms-playwright"),
            NODE_PATH: join(projectRoot, "node_modules"),
            LD_LIBRARY_PATH: nixLibPaths,
          },
        }
      );

      let fullOutput = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        sendEvent("output", { text });

        // Emit Passmark-specific phase events in real-time
        if (/Executing Cached Step:/.test(text)) {
          const stepMatch = text.match(/Executing Cached Step:\s*(.+)/);
          sendEvent("passmark_cache_hit", { step: stepMatch?.[1]?.trim() || "" });
        }
        if (/Executing Step:/.test(text) && !/Executing Cached Step:/.test(text)) {
          const stepMatch = text.match(/Executing Step:\s*(.+)/);
          sendEvent("passmark_cache_miss", { step: stepMatch?.[1]?.trim() || "" });
        }
        if (/Error executing cached step, falling back to AI execution/.test(text)) {
          sendEvent("passmark_auto_heal", { message: "Passmark auto-healed a cached step inline" });
        }
        if (/Redis not configured|Step caching is disabled/.test(text)) {
          sendEvent("passmark_redis_warning", { message: "Redis not configured — step caching disabled" });
        }
        if (/Running assertion:/.test(text)) {
          const assertMatch = text.match(/Running assertion:\s*(.+)/);
          sendEvent("passmark_assertion", { assertion: assertMatch?.[1]?.trim() || "" });
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        fullOutput += text;
        sendEvent("output", { text });

        // Passmark uses pino logger which can write to stderr
        if (/Executing Cached Step:/.test(text)) {
          const stepMatch = text.match(/Executing Cached Step:\s*(.+)/);
          sendEvent("passmark_cache_hit", { step: stepMatch?.[1]?.trim() || "" });
        }
        if (/Executing Step:/.test(text) && !/Executing Cached Step:/.test(text)) {
          const stepMatch = text.match(/Executing Step:\s*(.+)/);
          sendEvent("passmark_cache_miss", { step: stepMatch?.[1]?.trim() || "" });
        }
        if (/Error executing cached step, falling back to AI execution/.test(text)) {
          sendEvent("passmark_auto_heal", { message: "Passmark auto-healed a cached step inline" });
        }
        if (/Redis not configured|Step caching is disabled/.test(text)) {
          sendEvent("passmark_redis_warning", { message: "Redis not configured — step caching disabled" });
        }
      });

      proc.on("close", async (code) => {
        const { passed, failed, total, passmarkPhases } = parsePlaywrightOutput(fullOutput);
        const status = code === 0 ? "passed" : "failed";

        // Check if Passmark auto-healed a failure inline (test passed after auto-heal)
        const passmarkAutoHealed = status === "passed" && passmarkPhases?.autoHealTriggered === true;

        try {
          await storage.updateTestRun(run.id, {
            status,
            output: fullOutput,
            passedCount: passed,
            failedCount: failed,
            totalCount: total,
            completedAt: new Date(),
            ...(passmarkAutoHealed ? {
              healed: true,
              healedVia: "passmark",
              healLog: "Passmark auto-healed a cached step inline — test passed without Goose deep-heal.",
            } : {}),
          });
        } catch (err) {
          console.error("Failed to update test run:", err);
        }

        // Extract memory from passing runs (background, non-blocking)
        if (status === "passed") {
          extractMemoryFromPassedRun(test.projectId, test.code).catch(() => {});
        }

        stopRunHeartbeat();
        cleanupTempFiles(run.id);

        sendEvent("complete", {
          runId: run.id,
          status,
          passed,
          failed,
          total,
          passmarkPhases,
          passmarkAutoHealed,
        });
        res.end();
      });

      proc.on("error", async (err) => {
        const errorMsg = `Process error: ${err.message}\n`;
        fullOutput += errorMsg;
        sendEvent("error", { text: errorMsg });

        try {
          await storage.updateTestRun(run.id, {
            status: "error",
            output: fullOutput,
            passedCount: 0,
            failedCount: 0,
            totalCount: 0,
            completedAt: new Date(),
          });
        } catch (_) {}

        stopRunHeartbeat();
        cleanupTempFiles(run.id);
        res.end();
      });

      req.on("close", () => {
        proc.kill();
        stopRunHeartbeat();
        cleanupTempFiles(run.id);
      });
    } catch (error) {
      console.error("Run test error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error running test" });
      }
    }
  });

  app.get("/api/health/goose", (req, res) => {
    res.json({ status: isHealthy() ? "up" : "down" });
  });

  app.post("/api/projects/:id/generate-multi", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { scenarios, framework, useGoose } = req.body as {
        scenarios: string[];
        framework: "playwright" | "cypress";
        useGoose?: boolean;
      };

      if (!scenarios || !Array.isArray(scenarios) || scenarios.length === 0) {
        return res.status(400).json({ message: "scenarios array is required" });
      }
      if (!framework) {
        return res.status(400).json({ message: "framework is required" });
      }

      const gooseAvailable = isHealthy();
      const willUseGoose = useGoose && gooseAvailable;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (type: string, data: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      };

      if (useGoose && !gooseAvailable) {
        sendEvent("goose_status", { status: "down", message: "Goose offline — using standard mode" });
      }

      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      sendEvent("generation_start", {
        scenarios,
        framework,
        useGoose: willUseGoose,
        gooseAvailable,
      });

      const result = await runParallelGeneration(
        scenarios,
        { name: project.name, url: project.url, framework },
        (scenario, index, message) => {
          sendEvent("agent_progress", { scenario, index, message });
        },
        abortController.signal,
      );

      if (abortController.signal.aborted) {
        sendEvent("generation_cancelled", {});
        res.end();
        return;
      }

      const savedTests: unknown[] = [];
      const seen = new Set<string>();

      for (const { scenario, code } of result.scenarios) {
        const normalized = code.replace(/\s+/g, " ").trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const saved = await storage.createGeneratedTest({
          projectId: id,
          title: `${project.name} — ${scenario.slice(0, 60)}`,
          framework,
          prompt: scenario,
          url: project.url || null,
          code,
        });
        savedTests.push(saved);
      }

      sendEvent("generation_complete", { tests: savedTests, count: savedTests.length });
      res.end();
    } catch (error) {
      console.error("Multi-agent generation error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error running parallel generation" });
      } else {
        res.end();
      }
    }
  });

  app.post("/api/tests/:testId/heal", requireAuth, async (req, res) => {
    const testId = parseInt(String(req.params.testId), 10);
    if (isNaN(testId)) return res.status(400).json({ message: "Invalid test ID" });

    try {
      const test = await storage.getGeneratedTestById(testId);
      if (!test) return res.status(404).json({ message: "Test not found" });
      const project = await storage.getProjectById(test.projectId);
      if (!project || project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (test.framework !== "playwright") {
        return res.status(400).json({ message: "Auto-heal is only supported for Playwright tests" });
      }

      const { runId, failureOutput, mode } = req.body as { runId: number; failureOutput: string; mode?: "quick" | "deep" };
      if (!runId || !failureOutput) {
        return res.status(400).json({ message: "runId and failureOutput are required" });
      }

      const existingRun = await storage.getTestRunById(Number(runId));
      if (!existingRun || existingRun.generatedTestId !== testId) {
        return res.status(403).json({ message: "Run does not belong to this test" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (type: string, data: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      };

      // SSE keep-alive heartbeat for heal endpoint
      const healHeartbeat = setInterval(() => {
        try { res.write(":\n\n"); } catch (_) {}
      }, 15000);

      const abortController = new AbortController();
      req.on("close", () => {
        clearInterval(healHeartbeat);
        abortController.abort();
      });

      const healMode = mode === "deep" ? "deep" : "quick";
      const gooseAvailable = isHealthy();

      if (healMode === "deep") {
        sendEvent("heal_start", { testId, mode: "deep", gooseAvailable });

        if (!gooseAvailable) {
          sendEvent("goose_status", { status: "down", message: "Goose offline — using enhanced Claude fallback" });
        }

        sendEvent("goose_activity", {
          timestamp: Date.now(),
          message: `Starting deep heal session${project.url ? ` — inspecting ${project.url}` : ""}`,
          activityType: "info",
        });

        const sessionResult = await runHealSession(
          test.code,
          failureOutput,
          project.url || null,
          (activity) => {
            sendEvent("goose_activity", {
              timestamp: activity.timestamp,
              message: activity.message,
              activityType: activity.type,
            });
          },
          abortController.signal,
        );

        if (abortController.signal.aborted) {
          sendEvent("heal_cancelled", { attempts: 1 });
          res.end();
          return;
        }

        if (!sessionResult.success || !sessionResult.patchedCode) {
          sendEvent("heal_error", { message: sessionResult.error || "Deep heal failed to produce a patch" });
          sendEvent("heal_exhausted", { attempts: 1, finalDiagnosis: sessionResult.error || "Deep heal could not produce a patch" });
          res.end();
          return;
        }

        const patchedCode = sessionResult.patchedCode;
        sendEvent("patch_complete", { code: patchedCode });

        const preflight = await (async () => {
          try {
            const response = await anthropic.messages.create({
              model: "claude-haiku-4-5",
              max_tokens: 256,
              system: `You are a code safety validator. Reply with JSON only: {"safe": true|false, "reason": "brief explanation"}.`,
              messages: [{ role: "user", content: `Is this a safe Playwright test?\n\n${patchedCode}` }],
            });
            const text = response.content[0].type === "text" ? response.content[0].text : "";
            const m = text.match(/\{[\s\S]*\}/);
            if (m) {
              const parsed = JSON.parse(m[0]);
              if (typeof parsed.safe === "boolean") return parsed;
            }
            return { safe: false, reason: "Could not parse preflight" };
          } catch {
            return { safe: false, reason: "Preflight failed" };
          }
        })();

        sendEvent("preflight_result", { safe: preflight.safe, reason: preflight.reason });

        if (!preflight.safe) {
          sendEvent("heal_error", { message: `Safety check failed: ${preflight.reason}` });
          sendEvent("heal_exhausted", { attempts: 1, finalDiagnosis: `Safety check failed: ${preflight.reason}` });
          res.end();
          return;
        }

        await storage.updateGeneratedTest(testId, { code: patchedCode });
        sendEvent("code_saved", { attempt: 1 });

        const projectRoot = process.cwd();
        const nixLibPathsDeep = (process.env.NIX_LDFLAGS || "")
          .split(" ")
          .filter((f) => f.startsWith("-L"))
          .map((f) => f.slice(2))
          .join(":");

        sendEvent("rerunning", { attempt: 1 });

        const deepRunResult = await new Promise<{ passed: boolean; output: string; exitCode: number | null }>((resolve) => {
          const tempDir = join(tmpdir(), `playwright-deep-heal-${runId}`);
          mkdirSync(tempDir, { recursive: true });
          const testFile = join(tempDir, "test.spec.ts");
          writeFileSync(testFile, patchedCode);
          const configFile = join(projectRoot, `playwright-deep-heal-${runId}.config.ts`);
          writeFileSync(configFile, `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '${tempDir}',
  timeout: 30000,
  reporter: [['list']],
  use: { headless: true },
  workers: 1,
});
`);
          const proc = spawn("npx", ["playwright", "test", "--config", configFile], {
            cwd: projectRoot,
            env: {
              ...process.env,
              PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, ".cache", "ms-playwright"),
              NODE_PATH: join(projectRoot, "node_modules"),
              LD_LIBRARY_PATH: nixLibPathsDeep,
            },
          });
          let output = "";
          proc.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          proc.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          proc.on("close", (code) => {
            try { unlinkSync(testFile); } catch (_) {}
            try { unlinkSync(configFile); } catch (_) {}
            try { require("fs").rmdirSync(tempDir); } catch (_) {}
            resolve({ passed: code === 0, output, exitCode: code });
          });
          proc.on("error", (err) => {
            resolve({ passed: false, output: `Process error: ${err.message}`, exitCode: -1 });
          });
          abortController.signal.addEventListener("abort", () => { proc.kill(); });
        });

        sendEvent("rerun_output", { text: deepRunResult.output, attempt: 1 });

        if (deepRunResult.passed) {
          const { passed, failed, total } = parsePlaywrightOutput(deepRunResult.output);
          await storage.updateTestRun(runId, {
            status: "passed",
            output: deepRunResult.output,
            passedCount: passed,
            failedCount: failed,
            totalCount: total,
            completedAt: new Date(),
            healAttempts: 1,
            healLog: `Deep heal (Goose${gooseAvailable ? "" : " fallback"}): PASSED`,
            healed: true,
            healedVia: gooseAvailable ? "goose" : "goose-fallback",
          });
          sendEvent("heal_success", { attempt: 1, passed, failed, total, via: gooseAvailable ? "goose" : "goose-fallback" });
        } else {
          await storage.updateTestRun(runId, {
            healAttempts: 1,
            healLog: `Deep heal (Goose${gooseAvailable ? "" : " fallback"}): FAILED\n${deepRunResult.output.slice(-2000)}`,
            healed: false,
          });
          sendEvent("heal_exhausted", {
            attempts: 1,
            finalDiagnosis: "Deep heal produced a patch but tests still failed after re-run.",
          });
        }

        res.end();
        return;
      }

      const projectRoot = process.cwd();
      const nixLibPaths = (process.env.NIX_LDFLAGS || "")
        .split(" ")
        .filter((f) => f.startsWith("-L"))
        .map((f) => f.slice(2))
        .join(":");

      async function runTestCode(code: string, attemptRunId: string): Promise<{ passed: boolean; output: string; exitCode: number | null }> {
        return new Promise((resolve) => {
          const tempDir = join(tmpdir(), `playwright-heal-${attemptRunId}`);
          mkdirSync(tempDir, { recursive: true });
          const testFile = join(tempDir, "test.spec.ts");
          writeFileSync(testFile, code);
          const configFile = join(projectRoot, `playwright-heal-${attemptRunId}.config.ts`);
          writeFileSync(configFile, `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '${tempDir}',
  timeout: 30000,
  reporter: [['list']],
  use: { headless: true },
  workers: 1,
});
`);
          const proc = spawn("npx", ["playwright", "test", "--config", configFile], {
            cwd: projectRoot,
            env: {
              ...process.env,
              PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, ".cache", "ms-playwright"),
              NODE_PATH: join(projectRoot, "node_modules"),
              LD_LIBRARY_PATH: nixLibPaths,
            },
          });
          let output = "";
          proc.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          proc.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          proc.on("close", (code) => {
            try { unlinkSync(testFile); } catch (_) {}
            try { unlinkSync(configFile); } catch (_) {}
            try { require("fs").rmdirSync(tempDir); } catch (_) {}
            resolve({ passed: code === 0, output, exitCode: code });
          });
          proc.on("error", (err) => {
            resolve({ passed: false, output: `Process error: ${err.message}`, exitCode: -1 });
          });
          abortController.signal.addEventListener("abort", () => { proc.kill(); });
        });
      }

      async function haikuPreflight(code: string): Promise<{ safe: boolean; reason: string }> {
        try {
          const response = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 256,
            system: `You are a code safety validator. Determine if the given code is a legitimate Playwright test file that only tests a web application. 
Reply with JSON only: {"safe": true|false, "reason": "brief explanation"}.
A safe test: imports from @playwright/test, uses page/browser fixtures, makes assertions. 
Unsafe: executes shell commands, reads/writes arbitrary files, makes arbitrary network calls outside the test URL, uses eval/require with dynamic strings.`,
            messages: [{ role: "user", content: `Is this code a safe Playwright test?\n\n${code}` }],
          });
          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (typeof parsed.safe === "boolean") return parsed;
          }
          return { safe: false, reason: "Could not parse preflight response" };
        } catch (_) {
          return { safe: false, reason: "Pre-flight check failed" };
        }
      }

      const MAX_ATTEMPTS = 3;
      let currentCode = test.code;
      let lastFailureOutput = failureOutput;
      let attempts = 0;
      const healLog: string[] = [];

      sendEvent("heal_start", { testId, maxAttempts: MAX_ATTEMPTS });

      while (attempts < MAX_ATTEMPTS) {
        if (abortController.signal.aborted) {
          sendEvent("heal_cancelled", { attempts });
          await storage.updateTestRun(runId, { healAttempts: attempts, healLog: healLog.join("\n---\n") });
          res.end();
          return;
        }

        attempts++;
        sendEvent("heal_attempt", { attempt: attempts, maxAttempts: MAX_ATTEMPTS });

        const diagnosisPrompt = `The following Playwright test is failing${attempts > 1 ? " (attempt " + attempts + " — previous fix did not work)" : ""}.

CURRENT TEST CODE:
\`\`\`typescript
${currentCode}
\`\`\`

FAILURE OUTPUT:
${lastFailureOutput}

Respond with:
1. A diagnosis paragraph explaining what is wrong and why${attempts > 1 ? " (and why the previous fix failed)" : ""}
2. The complete fixed test code in a \`\`\`typescript fence

Only fix the broken mechanics (wrong selectors, timing issues, incorrect assertions). Do not change what the test is testing.`;

        let diagnosis = "";
        let patchedCode = "";

        try {
          const stream = anthropic.messages.stream({
            model: "claude-sonnet-4-5",
            max_tokens: 8192,
            system: `You are an expert Playwright test repair engineer. You diagnose and fix broken Playwright tests.
Your response MUST follow this exact format:
1. Start with a diagnosis paragraph (plain text, no code)
2. Then output the complete fixed test in a typescript code fence

Never truncate the test code. Always output the full, complete test file.`,
            messages: [{ role: "user", content: diagnosisPrompt }],
          }, { signal: abortController.signal });

          let fullText = "";
          let diagStreamedUpTo = 0;
          let passedCodeFence = false;

          for await (const event of stream) {
            if (abortController.signal.aborted) break;
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              const chunk = event.delta.text;
              if (!chunk) continue;
              fullText += chunk;

              if (!passedCodeFence) {
                const fenceMatch = fullText.match(/```(?:typescript|ts)/);
                if (fenceMatch && fenceMatch.index !== undefined) {
                  passedCodeFence = true;
                  const diagEnd = fenceMatch.index;
                  const newDiag = fullText.slice(diagStreamedUpTo, diagEnd);
                  if (newDiag) sendEvent("diagnosis_chunk", { text: newDiag });
                  diagStreamedUpTo = diagEnd;
                } else {
                  const newDiag = fullText.slice(diagStreamedUpTo);
                  if (newDiag) sendEvent("diagnosis_chunk", { text: newDiag });
                  diagStreamedUpTo = fullText.length;
                }
              } else {
                sendEvent("code_chunk", { text: chunk });
              }
            }
          }

          const fencePattern = /```(?:typescript|ts)\n?([\s\S]*?)```/;
          const match = fullText.match(fencePattern);
          if (match) {
            patchedCode = match[1].trim();
            const fenceIdx = fullText.search(/```(?:typescript|ts)/);
            diagnosis = fullText.slice(0, fenceIdx).trim();
          } else {
            diagnosis = fullText.trim();
          }

          if (diagnosis) sendEvent("diagnosis", { text: diagnosis });
          if (patchedCode) sendEvent("patch_complete", { code: patchedCode });
        } catch (streamErr: unknown) {
          if (abortController.signal.aborted) {
            sendEvent("heal_cancelled", { attempts });
            await storage.updateTestRun(runId, { healAttempts: attempts, healLog: healLog.join("\n---\n") });
            res.end();
            return;
          }
          console.error("Claude stream error:", streamErr);
          sendEvent("heal_error", { message: "Claude stream failed", attempt: attempts });
          break;
        }

        if (!patchedCode) {
          sendEvent("heal_error", { message: "Could not extract patched code from Claude response", attempt: attempts });
          healLog.push(`Attempt ${attempts}: No code extracted from Claude`);
          continue;
        }

        const preflight = await haikuPreflight(patchedCode);
        sendEvent("preflight_result", { safe: preflight.safe, reason: preflight.reason, attempt: attempts });

        if (!preflight.safe) {
          healLog.push(`Attempt ${attempts}: Pre-flight check failed — ${preflight.reason}`);
          sendEvent("heal_error", { message: `Safety check failed: ${preflight.reason}`, attempt: attempts });
          continue;
        }

        await storage.updateGeneratedTest(testId, { code: patchedCode });
        currentCode = patchedCode;
        sendEvent("code_saved", { attempt: attempts });

        sendEvent("rerunning", { attempt: attempts });
        const runResult = await runTestCode(patchedCode, `${runId}-${attempts}`);
        sendEvent("rerun_output", { text: runResult.output, attempt: attempts });

        healLog.push(`Attempt ${attempts}: ${runResult.passed ? "PASSED" : "FAILED"}\n${diagnosis}\n\nOutput: ${runResult.output.slice(-2000)}`);

        if (runResult.passed) {
          const { passed, failed, total } = parsePlaywrightOutput(runResult.output);
          await storage.updateTestRun(runId, {
            status: "passed",
            output: runResult.output,
            passedCount: passed,
            failedCount: failed,
            totalCount: total,
            completedAt: new Date(),
            healAttempts: attempts,
            healLog: healLog.join("\n---\n"),
            healed: true,
          });
          // Record healed selectors and anti-patterns in project memory (background)
          recordHealMemory(test.projectId, test.code, patchedCode).catch(() => {});
          sendEvent("heal_success", { attempt: attempts, passed, failed, total });
          recordHealMemory(test.projectId, test.code, patchedCode).catch(() => {});
          res.end();
          return;
        }

        lastFailureOutput = runResult.output;
        sendEvent("attempt_failed", { attempt: attempts, willRetry: attempts < MAX_ATTEMPTS });
      }

      await storage.updateTestRun(runId, {
        healAttempts: attempts,
        healLog: healLog.join("\n---\n"),
        healed: false,
      });

      sendEvent("heal_exhausted", {
        attempts,
        finalDiagnosis: healLog[healLog.length - 1] ?? "Could not determine root cause after 3 attempts.",
      });
      res.end();
    } catch (error) {
      console.error("Heal error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error starting heal" });
      } else {
        res.end();
      }
    }
  });

  app.get("/api/health/mempalace", (_req, res) => {
    res.json({ status: mempalace.isHealthy() ? "up" : "down" });
  });

  // Memory API routes (Task #7)
  app.get("/api/projects/:id/memory", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const items = await storage.getMemoryByProject(id);
      res.json(items);
    } catch (error) {
      console.error("Get memory error:", error);
      res.status(500).json({ message: "Error fetching memory" });
    }
  });

  app.post("/api/projects/:id/memory", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const data = insertProjectMemorySchema.parse({ ...req.body, projectId: id });
      const item = await storage.upsertMemory(data);
      mempalace.storeMemory(id, {
        pattern: item.pattern,
        selector: item.selector,
        confidence: item.confidence,
        tags: item.tags ?? undefined,
      }).catch((err: unknown) => {
        console.warn("[mempalace] Fire-and-forget storeMemory failed:", err);
      });
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Upsert memory error:", error);
      res.status(500).json({ message: "Error saving memory item" });
    }
  });

  app.delete("/api/projects/:id/memory/:memoryId", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      const memoryId = parseInt(String(req.params.memoryId), 10);
      if (isNaN(id) || isNaN(memoryId)) return res.status(400).json({ message: "Invalid ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteMemory(memoryId);
      res.status(204).send();
    } catch (error) {
      console.error("Delete memory error:", error);
      res.status(500).json({ message: "Error deleting memory item" });
    }
  });

  app.post("/api/projects/:id/memory/compact", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
      const pruned = await storage.compactMemory(id);
      res.json({ success: true, pruned });
    } catch (error) {
      res.status(500).json({ message: "Error compacting memory" });
    }
  });

  // Monitoring API routes (Task #8 + Task #11 — scheduling, heartbeats, and OpenClaw notifications)
  const monitoringSchema = z.object({
    monitoringSchedule: z.enum(["off", "hourly", "daily"]).optional(),
    monitoringPaused: z.boolean().optional(),
    regenerateSecret: z.boolean().optional(),
    openclawWebhookUrl: z.string().url("Must be a valid URL").optional().nullable(),
    alertEmail: z.string().email("Must be a valid email").optional().nullable(),
  });


  app.get("/api/projects/:id/monitoring", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

      const [logs, config] = await Promise.all([
        storage.getScheduledRunLogsByProject(id, 20),
        storage.getOpenclawConfig(id),
      ]);

      let nextRunAt: number | null = null;
      if (project.monitoringSchedule !== "off" && !project.monitoringPaused) {
        const intervalMs = project.monitoringSchedule === "hourly" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const last = project.lastScheduledRunAt ? project.lastScheduledRunAt.getTime() : 0;
        nextRunAt = last + intervalMs;
      }

      const recentRunLogs = logs.filter((l) => l.trigger !== "dream").slice(0, 7);
      const passRate7d = recentRunLogs.length > 0
        ? Math.round(
            (recentRunLogs.reduce((s, l) => s + l.passed, 0) /
              Math.max(1, recentRunLogs.reduce((s, l) => s + l.testsRun, 0))) *
              100
          )
        : null;

      const latestDream = logs.find((l) => l.dreamSummary);

      res.json({
        project: {
          id: project.id,
          monitoringSchedule: project.monitoringSchedule,
          webhookSecret: project.webhookSecret,
          monitoringPaused: project.monitoringPaused,
          lastScheduledRunAt: project.lastScheduledRunAt,
        },
        nextRunAt,
        logs,
        passRate7d,
        latestDreamSummary: latestDream?.dreamSummary || null,
        openclawWebhookUrl: config.openclawWebhookUrl,
        alertEmail: config.alertEmail,
      });
    } catch (error) {
      res.status(500).json({ message: "Error fetching monitoring data" });
    }
  });


  app.patch("/api/projects/:id/monitoring", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });

      const data = monitoringSchema.parse(req.body);
      const updates: {
        monitoringSchedule?: string;
        webhookSecret?: string;
        monitoringPaused?: boolean;
      } = {};

      if (data.monitoringSchedule !== undefined) updates.monitoringSchedule = data.monitoringSchedule;
      if (data.monitoringPaused !== undefined) updates.monitoringPaused = data.monitoringPaused;
      if (data.regenerateSecret || !project.webhookSecret) {
        updates.webhookSecret = crypto.randomBytes(24).toString("hex");
      }
      if (Object.keys(updates).length > 0) {
        await storage.updateProjectMonitoring(id, updates);
      }

      if (data.openclawWebhookUrl !== undefined || data.alertEmail !== undefined) {
        await storage.setOpenclawConfig(id, data.openclawWebhookUrl ?? null, data.alertEmail);
      }

      const [updatedProject, ocConfig] = await Promise.all([
        storage.getProjectById(id),
        storage.getOpenclawConfig(id),
      ]);
      res.json({ ...updatedProject, openclawWebhookUrl: ocConfig.openclawWebhookUrl, alertEmail: ocConfig.alertEmail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Error updating monitoring" });
    }
  });

  // Test OpenClaw connection — sends a sample ping to the configured webhook
  app.post("/api/projects/:id/monitoring/test-notify", requireAuth, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.userId !== req.session.userId) return res.status(403).json({ message: "Forbidden" });
      const ocCfg = await storage.getOpenclawConfig(id);
      if (!ocCfg.openclawWebhookUrl) {
        return res.status(400).json({ success: false, error: "No OpenClaw webhook URL configured" });
      }
      const result = await sendTestNotification(ocCfg.openclawWebhookUrl);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: "Error sending test notification" });
    }
  });

  // Inbound webhook trigger — POSTing to this endpoint with the project's webhook secret queues a full test run
  app.post("/api/projects/:id/trigger", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project ID" });
      const project = await storage.getProjectById(id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.query.token as string;

      if (!project.webhookSecret || token !== project.webhookSecret) {
        return res.status(401).json({ message: "Invalid webhook secret" });
      }

      res.json({ queued: true, projectId: id });

      runScheduledCheck(id, "webhook").catch((err) =>
        console.error("Webhook trigger error:", err)
      );
    } catch (error) {
      res.status(500).json({ message: "Error triggering run" });
    }
  });

  app.get("/api/billing/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/billing/plans", async (_req, res) => {
    try {
      const products = await stripeService.getProductsWithPrices();
      res.json({ products });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/billing/subscription", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById((req.session as any).userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const limits = PLAN_LIMITS[user.plan as PlanId] || PLAN_LIMITS.free;
      const projects = await storage.getProjectsByUser(user.id);
      const runsThisMonth = await storage.getRunCountThisMonth(user.id);
      res.json({
        plan: user.plan,
        limits,
        usage: {
          projects: projects.length,
          runsThisMonth,
        },
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/billing/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById((req.session as any).userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const { priceId } = req.body;
      if (!priceId) return res.status(400).json({ message: "priceId required" });

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user.email, user.id);
        customerId = customer.id;
        await storage.updateUserBilling(user.id, { stripeCustomerId: customerId });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripeService.createCheckoutSession(customerId, priceId, baseUrl);
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/billing/portal", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById((req.session as any).userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      if (!user.stripeCustomerId) {
        return res.status(400).json({ message: "No billing account found. Subscribe first." });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripeService.createPortalSession(user.stripeCustomerId, `${baseUrl}/dashboard`);
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── ACTIVITY FEED ──────────────────────────────────────────────────────────
  app.get("/api/activity", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.session as any).userId;
      const userProjects = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.userId, userId));

      if (userProjects.length === 0) return res.json({ events: [] });

      const projectIds = userProjects.map((p) => p.id);
      const projectMap = Object.fromEntries(userProjects.map((p) => [p.id, p.name]));

      const [recentTests, recentRuns, recentMonitoringLogs] = await Promise.all([
        db
          .select({
            id: generatedTests.id,
            projectId: generatedTests.projectId,
            title: generatedTests.title,
            framework: generatedTests.framework,
            review: generatedTests.review,
            createdAt: generatedTests.createdAt,
          })
          .from(generatedTests)
          .where(inArray(generatedTests.projectId, projectIds))
          .orderBy(desc(generatedTests.createdAt))
          .limit(30),
        db
          .select({
            id: testRuns.id,
            generatedTestId: testRuns.generatedTestId,
            status: testRuns.status,
            passedCount: testRuns.passedCount,
            failedCount: testRuns.failedCount,
            totalCount: testRuns.totalCount,
            healed: testRuns.healed,
            healLog: testRuns.healLog,
            healAttempts: testRuns.healAttempts,
            healedVia: testRuns.healedVia,
            trigger: testRuns.trigger,
            startedAt: testRuns.startedAt,
            completedAt: testRuns.completedAt,
            testTitle: generatedTests.title,
            projectId: generatedTests.projectId,
            framework: generatedTests.framework,
          })
          .from(testRuns)
          .innerJoin(generatedTests, eq(testRuns.generatedTestId, generatedTests.id))
          .where(inArray(generatedTests.projectId, projectIds))
          .orderBy(desc(testRuns.startedAt))
          .limit(50),
        db
          .select()
          .from(scheduledRunLog)
          .where(inArray(scheduledRunLog.projectId, projectIds))
          .orderBy(desc(scheduledRunLog.triggeredAt))
          .limit(20),
      ]);

      const events: any[] = [];

      recentTests.forEach((t) => {
        events.push({
          type: "generation",
          id: `gen-${t.id}`,
          projectId: t.projectId,
          projectName: projectMap[t.projectId] ?? "Unknown",
          title: t.title ?? "Generated test",
          framework: t.framework,
          reviewScore: (t.review as any)?.score ?? null,
          at: t.createdAt,
        });
      });

      recentRuns.forEach((r) => {
        if (r.healed) {
          events.push({
            type: "heal",
            id: `heal-${r.id}`,
            projectId: r.projectId,
            projectName: projectMap[r.projectId] ?? "Unknown",
            title: r.testTitle ?? "Test",
            framework: r.framework,
            healAttempts: r.healAttempts,
            healedVia: r.healedVia,
            at: r.completedAt ?? r.startedAt,
          });
        }
        events.push({
          type: r.status === "failed" ? "run_failed" : r.status === "passed" ? "run_passed" : "run",
          id: `run-${r.id}`,
          projectId: r.projectId,
          projectName: projectMap[r.projectId] ?? "Unknown",
          title: r.testTitle ?? "Test",
          framework: r.framework,
          status: r.status,
          passed: r.passedCount,
          failed: r.failedCount,
          total: r.totalCount,
          trigger: r.trigger,
          at: r.startedAt,
        });
      });

      recentMonitoringLogs.forEach((l) => {
        events.push({
          type: l.dreamSummary ? "dream" : "monitoring",
          id: `mon-${l.id}`,
          projectId: l.projectId,
          projectName: projectMap[l.projectId] ?? "Unknown",
          testsRun: l.testsRun,
          passed: l.passed,
          failed: l.failed,
          trigger: l.trigger,
          notificationSent: l.notificationSent,
          dreamSummary: l.dreamSummary,
          at: l.triggeredAt,
        });
      });

      events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      res.json({ events: events.slice(0, 60) });
    } catch (err: any) {
      console.error("[activity]", err);
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
