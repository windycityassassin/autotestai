import cron from "node-cron";
import nodemailer from "nodemailer";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { storage } from "./storage";

function log(message: string, source = "scheduler") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendFailureEmail(
  to: string,
  projectName: string,
  projectId: number,
  failedTests: Array<{ title: string; error?: string }>
): Promise<boolean> {
  const transport = getMailTransport();
  if (!transport) {
    log(`SMTP not configured — skipping email for project ${projectId}`, "scheduler");
    return false;
  }

  const failList = failedTests
    .map((t) => `  • ${t.title}${t.error ? `: ${t.error.slice(0, 120)}` : ""}`)
    .join("\n");

  const appUrl = process.env.APP_URL || "http://localhost:5000";
  const projectUrl = `${appUrl}/dashboard/projects/${projectId}`;

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `${failedTests.length} test${failedTests.length === 1 ? "" : "s"} failed in ${projectName}`,
      text: `Scheduled monitoring detected test failures in "${projectName}".\n\nFailed tests:\n${failList}\n\nView results: ${projectUrl}`,
      html: `
        <h2 style="color:#c0392b">Test Failures Detected</h2>
        <p>Scheduled monitoring detected <strong>${failedTests.length} test failure${failedTests.length === 1 ? "" : "s"}</strong> in <strong>${projectName}</strong>.</p>
        <ul>${failedTests.map((t) => `<li><strong>${t.title}</strong>${t.error ? `<br/><code style="color:#888;font-size:12px">${t.error.slice(0, 200)}</code>` : ""}</li>`).join("")}</ul>
        <p><a href="${projectUrl}" style="background:#0DFF82;color:black;padding:8px 16px;text-decoration:none;border-radius:6px;font-weight:bold">View Results</a></p>
      `,
    });
    return true;
  } catch (err) {
    log(`Email send failed: ${err}`, "scheduler");
    return false;
  }
}

function parsePlaywrightOutput(output: string): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const passedMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+failed/);
  if (passedMatch) passed = parseInt(passedMatch[1], 10);
  if (failedMatch) failed = parseInt(failedMatch[1], 10);
  return { passed, failed };
}

async function runPlaywrightTest(code: string, runId: string): Promise<{ passed: boolean; output: string; passedCount: number; failedCount: number }> {
  return new Promise((resolve) => {
    const projectRoot = process.cwd();
    const tempDir = join(tmpdir(), `scheduled-run-${runId}`);
    mkdirSync(tempDir, { recursive: true });

    const testFile = join(tempDir, "test.spec.ts");
    writeFileSync(testFile, code);

    const configFile = join(projectRoot, `scheduled-${runId}.config.ts`);
    writeFileSync(configFile, `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '${tempDir}',
  timeout: 30000,
  reporter: [['list']],
  use: { headless: true },
  workers: 1,
});
`);

    const nixLibPaths = (process.env.NIX_LDFLAGS || "")
      .split(" ")
      .filter((f) => f.startsWith("-L"))
      .map((f) => f.slice(2))
      .join(":");

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

      const { passed, failed } = parsePlaywrightOutput(output);
      resolve({ passed: code === 0, output, passedCount: passed, failedCount: failed });
    });

    proc.on("error", (err) => {
      resolve({ passed: false, output: `Process error: ${err.message}`, passedCount: 0, failedCount: 0 });
    });
  });
}

async function rankTestsByRisk(
  projectName: string,
  projectUrl: string | null | undefined,
  tests: Array<{ id: number; title: string | null; prompt: string | null; recentRuns: Array<{ status: string }> }>
): Promise<number[]> {
  if (tests.length === 0) return [];

  const testList = tests.map((t) => ({
    id: t.id,
    title: t.title || "Untitled",
    prompt: t.prompt?.slice(0, 100) || "",
    recentPassRate: t.recentRuns.length > 0
      ? t.recentRuns.filter((r) => r.status === "passed").length / t.recentRuns.length
      : null,
  }));

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: `You are a test monitoring assistant. Given a list of tests and their recent pass rates, return a JSON array of test IDs sorted by regression risk (highest risk first). Tests with lower or inconsistent pass rates have higher regression risk. Tests with null pass rate (never run) should be considered high risk.

Return ONLY a JSON array of test IDs, e.g.: [42, 7, 15]`,
      messages: [{
        role: "user",
        content: `Project: ${projectName}${projectUrl ? ` (${projectUrl})` : ""}

Tests:
${JSON.stringify(testList, null, 2)}

Return a JSON array of test IDs ranked by regression risk (highest first).`,
      }],
    });

    const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
    const match = text.match(/\[[\d,\s]+\]/);
    if (match) {
      const ranked = JSON.parse(match[0]) as number[];
      return ranked;
    }
  } catch (err) {
    log(`Claude ranking call failed: ${err}`, "scheduler");
  }

  return tests.map((t) => t.id);
}

async function runScheduledCheck(projectId: number, trigger: "scheduled" | "webhook") {
  log(`Running scheduled check for project ${projectId} (trigger: ${trigger})`, "scheduler");

  const project = await storage.getProjectById(projectId);
  if (!project) {
    log(`Project ${projectId} not found`, "scheduler");
    return;
  }

  const tests = await storage.getGeneratedTestsByProjectId(projectId);
  if (tests.length === 0) {
    await storage.createScheduledRunLog({
      projectId,
      trigger,
      testsEvaluated: [],
      testsRun: 0,
      passed: 0,
      failed: 0,
      notificationSent: false,
    });
    log(`No tests for project ${projectId} — logging empty heartbeat`, "scheduler");
    return;
  }

  const testsWithHistory = await Promise.all(
    tests.map(async (t) => {
      const runs = await storage.getTestRunsByTest(t.id);
      const recent = runs.slice(-5).map((r) => ({ status: r.status }));
      return { ...t, recentRuns: recent };
    })
  );

  const rankedIds = await rankTestsByRisk(project.name, project.url, testsWithHistory);

  const orderedTests = rankedIds
    .map((id) => testsWithHistory.find((t) => t.id === id))
    .filter(Boolean) as typeof testsWithHistory;

  const testsToRun = orderedTests.filter((t) => t.framework === "playwright");

  if (testsToRun.length === 0) {
    await storage.createScheduledRunLog({
      projectId,
      trigger,
      testsEvaluated: rankedIds,
      testsRun: 0,
      passed: 0,
      failed: 0,
      notificationSent: false,
    });
    log(`No runnable tests for project ${projectId}`, "scheduler");
    return;
  }

  const MAX_CONCURRENT = 3;
  const chunks: typeof testsToRun[] = [];
  for (let i = 0; i < testsToRun.length; i += MAX_CONCURRENT) {
    chunks.push(testsToRun.slice(i, i + MAX_CONCURRENT));
  }

  let totalPassed = 0;
  let totalFailed = 0;
  const failedTestDetails: Array<{ title: string; error?: string }> = [];

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (test) => {
        const run = await storage.createTestRun(test.id, trigger);
        const result = await runPlaywrightTest(test.code, `${run.id}`);

        await storage.updateTestRun(run.id, {
          status: result.passed ? "passed" : "failed",
          output: result.output,
          passedCount: result.passedCount,
          failedCount: result.failedCount,
          totalCount: result.passedCount + result.failedCount,
          completedAt: new Date(),
        });

        return { test, result };
      })
    );

    for (const { test, result } of results) {
      totalPassed += result.passedCount;
      totalFailed += result.failedCount;
      if (!result.passed) {
        const errorLine = result.output.split("\n").find((l) => l.includes("Error") || l.includes("failed"));
        failedTestDetails.push({
          title: test.title || `Test #${test.id}`,
          error: errorLine,
        });
      }
    }
  }

  let notificationSent = false;
  if (totalFailed > 0) {
    const owner = await storage.getUserById(project.userId);
    if (owner) {
      notificationSent = await sendFailureEmail(owner.email, project.name, project.id, failedTestDetails);
    }
  }

  await storage.createScheduledRunLog({
    projectId,
    trigger,
    testsEvaluated: rankedIds,
    testsRun: testsToRun.length,
    passed: totalPassed,
    failed: totalFailed,
    notificationSent,
  });

  if (trigger === "scheduled") {
    await storage.updateProjectMonitoring(projectId, { lastScheduledRunAt: new Date() });
  }

  log(
    `Scheduled check done for project ${projectId}: ${totalPassed} passed, ${totalFailed} failed, notification: ${notificationSent}`,
    "scheduler"
  );
}

async function runWeeklyDream() {
  log("Running weekly autoDream consolidation", "scheduler");

  const allProjects = await storage.getProjectsDueForMonitoring();

  for (const project of allProjects) {
    try {
      const logs = await storage.getScheduledRunLogsByProject(project.id, 30);
      const tests = await storage.getGeneratedTestsByProjectId(project.id);

      if (logs.length === 0 && tests.length === 0) continue;

      const totalRuns = logs.reduce((sum, l) => sum + l.testsRun, 0);
      const totalPassed = logs.reduce((sum, l) => sum + l.passed, 0);
      const totalFailed = logs.reduce((sum, l) => sum + l.failed, 0);

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system: `You are a test reliability analyst. Given a project's recent monitoring history, write a concise 2-3 sentence paragraph summarising the reliability trend. Be specific about pass rates and any patterns observed.`,
        messages: [{
          role: "user",
          content: `Project: ${project.name}
URL: ${project.url || "N/A"}
Tests: ${tests.length}
Last 30 monitoring runs:
  - Total test executions: ${totalRuns}
  - Passed: ${totalPassed}
  - Failed: ${totalFailed}
  - Pass rate: ${totalRuns > 0 ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100) : "N/A"}%
  - Runs with failures: ${logs.filter((l) => l.failed > 0).length}

Write a brief reliability trend summary paragraph.`,
        }],
      });

      const summary = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("")
        .trim();

      await storage.createScheduledRunLog({
        projectId: project.id,
        trigger: "dream",
        testsEvaluated: null,
        testsRun: 0,
        passed: 0,
        failed: 0,
        notificationSent: false,
        dreamSummary: summary,
      });

      log(`autoDream completed for project ${project.id}`, "scheduler");
    } catch (err) {
      log(`autoDream failed for project ${project.id}: ${err}`, "scheduler");
    }
  }
}

export function startScheduler() {
  cron.schedule("* * * * *", async () => {
    try {
      const dueProjects = await storage.getProjectsDueForMonitoring();
      for (const project of dueProjects) {
        runScheduledCheck(project.id, "scheduled").catch((err) =>
          log(`Scheduled check error for project ${project.id}: ${err}`, "scheduler")
        );
      }
    } catch (err) {
      log(`Cron tick error: ${err}`, "scheduler");
    }
  });

  cron.schedule("0 0 * * 0", async () => {
    runWeeklyDream().catch((err) => log(`Weekly dream error: ${err}`, "scheduler"));
  });

  log("Scheduler started (heartbeat: every minute, dream: weekly Sunday midnight)", "scheduler");
}

export { runScheduledCheck };
