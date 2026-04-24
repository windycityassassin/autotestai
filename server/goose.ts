import { spawn, ChildProcess } from "child_process";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

let gooseProcess: ChildProcess | null = null;
let gooseHealthy = false;
let gooseCheckInterval: NodeJS.Timeout | null = null;

const GOOSE_PORT = 9099;
const GOOSE_BASE_URL = `http://localhost:${GOOSE_PORT}`;

async function checkGooseHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${GOOSE_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

export function startGooseSidecar(): void {
  const gooseBin = process.env.GOOSE_BIN || "goose";

  try {
    gooseProcess = spawn(gooseBin, ["server", "--port", String(GOOSE_PORT)], {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "",
      },
      stdio: "pipe",
    });

    gooseProcess.on("error", (err) => {
      console.log(`[goose] Sidecar not available: ${err.message} — falling back to standard mode`);
      gooseHealthy = false;
      gooseProcess = null;
    });

    gooseProcess.on("exit", (code) => {
      console.log(`[goose] Sidecar exited with code ${code}`);
      gooseHealthy = false;
      gooseProcess = null;
    });

    setTimeout(async () => {
      gooseHealthy = await checkGooseHealth();
      if (gooseHealthy) {
        console.log("[goose] Sidecar is up");
      } else {
        console.log("[goose] Sidecar unavailable — deep heal and parallel generation will use fallback mode");
      }
    }, 3000);

    gooseCheckInterval = setInterval(async () => {
      gooseHealthy = await checkGooseHealth();
    }, 30000);
  } catch (err) {
    console.log("[goose] Could not start sidecar — using fallback mode");
    gooseHealthy = false;
  }
}

export function stopGooseSidecar(): void {
  if (gooseCheckInterval) {
    clearInterval(gooseCheckInterval);
    gooseCheckInterval = null;
  }
  if (gooseProcess) {
    gooseProcess.kill("SIGTERM");
    gooseProcess = null;
  }
  gooseHealthy = false;
}

export function isHealthy(): boolean {
  return gooseHealthy;
}

export interface GooseActivity {
  timestamp: number;
  message: string;
  type: "info" | "action" | "result" | "error";
}

export interface HealSessionResult {
  patchedCode: string;
  activities: GooseActivity[];
  success: boolean;
  error?: string;
}

export interface ParallelGenerationResult {
  scenarios: { scenario: string; code: string }[];
  activities: GooseActivity[];
}

async function callGooseAPI(endpoint: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${GOOSE_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Goose API error: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

export async function runHealSession(
  testCode: string,
  errorOutput: string,
  targetUrl: string | null,
  onActivity: (activity: GooseActivity) => void,
  signal?: AbortSignal,
): Promise<HealSessionResult> {
  if (gooseHealthy) {
    return runGooseHealSession(testCode, errorOutput, targetUrl, onActivity, signal);
  }
  return runFallbackHealSession(testCode, errorOutput, targetUrl, onActivity, signal);
}

async function runGooseHealSession(
  testCode: string,
  errorOutput: string,
  targetUrl: string | null,
  onActivity: (activity: GooseActivity) => void,
  signal?: AbortSignal,
): Promise<HealSessionResult> {
  const activities: GooseActivity[] = [];
  const emit = (msg: string, type: GooseActivity["type"] = "info") => {
    const act: GooseActivity = { timestamp: Date.now(), message: msg, type };
    activities.push(act);
    onActivity(act);
  };

  try {
    emit(`Starting deep heal session${targetUrl ? ` for ${targetUrl}` : ""}`, "info");

    const sessionPayload: Record<string, unknown> = {
      task: `You are a Playwright test repair agent. 
${targetUrl ? `Navigate to ${targetUrl} and inspect the DOM to find elements matching the failing test's intent.` : ""}
Analyze the failing test and error output, then produce a fixed version of the test code.

FAILING TEST CODE:
${testCode}

ERROR OUTPUT:
${errorOutput}

Steps:
1. ${targetUrl ? `Browse ${targetUrl} to inspect current DOM structure` : "Analyze the test structure"}
2. Identify what has changed or is broken
3. Propose updated selectors and fixes
4. Return the complete fixed test code in a \`\`\`typescript code fence`,
      tools: targetUrl ? ["browser", "shell"] : ["shell"],
    };

    emit("Sending task to Goose agent...", "action");
    const result = await callGooseAPI("/v1/chat", sessionPayload) as { content?: string; activities?: GooseActivity[] };

    if (signal?.aborted) {
      return { patchedCode: "", activities, success: false, error: "Aborted" };
    }

    const responseText = result?.content || "";
    if (result?.activities) {
      for (const act of result.activities) {
        emit(act.message, act.type);
      }
    }

    emit("Extracting patched code...", "result");

    const match = responseText.match(/```(?:typescript|ts)\n?([\s\S]*?)```/);
    if (!match) {
      return { patchedCode: "", activities, success: false, error: "No code block in Goose response" };
    }

    const patchedCode = match[1].trim();
    emit("Patch ready", "result");
    return { patchedCode, activities, success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const act: GooseActivity = { timestamp: Date.now(), message: `Error: ${msg}`, type: "error" };
    activities.push(act);
    onActivity(act);
    return { patchedCode: "", activities, success: false, error: msg };
  }
}

async function runFallbackHealSession(
  testCode: string,
  errorOutput: string,
  targetUrl: string | null,
  onActivity: (activity: GooseActivity) => void,
  signal?: AbortSignal,
): Promise<HealSessionResult> {
  const activities: GooseActivity[] = [];
  const emit = (msg: string, type: GooseActivity["type"] = "info") => {
    const act: GooseActivity = { timestamp: Date.now(), message: msg, type };
    activities.push(act);
    onActivity(act);
  };

  emit("Goose offline — using enhanced Claude fallback mode", "info");

  if (targetUrl) {
    emit(`Analyzing test for ${targetUrl}`, "action");
    emit("Simulating DOM inspection (Goose would navigate the live app here)", "action");
    emit("Identifying structural patterns from error output...", "action");
  }

  emit("Running deep analysis of test failure...", "action");

  const systemPrompt = `You are a Playwright test repair specialist running in deep-heal mode.
${targetUrl ? `The target application is at: ${targetUrl}` : ""}
Analyze the failing test carefully, considering:
- Selector issues (element moved, renamed, re-nested in DOM)
- Timing/async issues
- API response changes
- Navigation or route changes

Respond with:
1. A detailed analysis of root cause
2. The complete fixed test in a \`\`\`typescript fence`;

  const userMessage = `FAILING TEST:
\`\`\`typescript
${testCode}
\`\`\`

ERROR OUTPUT:
${errorOutput}

Please provide a thorough diagnosis and the complete fixed test code.`;

  try {
    emit("Requesting deep analysis from Claude...", "action");

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }, { signal });

    let fullText = "";
    for await (const event of stream) {
      if (signal?.aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
      }
    }

    if (signal?.aborted) {
      return { patchedCode: "", activities, success: false, error: "Aborted" };
    }

    emit("Analysis complete — extracting patch...", "result");

    const match = fullText.match(/```(?:typescript|ts)\n?([\s\S]*?)```/);
    if (!match) {
      return { patchedCode: "", activities, success: false, error: "No code block in response" };
    }

    const patchedCode = match[1].trim();
    emit("Patch ready", "result");
    return { patchedCode, activities, success: true };
  } catch (err: unknown) {
    if (signal?.aborted) {
      return { patchedCode: "", activities, success: false, error: "Aborted" };
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    emit(`Error: ${msg}`, "error");
    return { patchedCode: "", activities, success: false, error: msg };
  }
}

export async function runParallelGeneration(
  scenarios: string[],
  projectContext: { name: string; url?: string | null; framework: string },
  onActivity: (scenario: string, index: number, message: string) => void,
  signal?: AbortSignal,
): Promise<ParallelGenerationResult> {
  if (gooseHealthy) {
    return runGooseParallelGeneration(scenarios, projectContext, onActivity, signal);
  }
  return runFallbackParallelGeneration(scenarios, projectContext, onActivity, signal);
}

async function runGooseParallelGeneration(
  scenarios: string[],
  projectContext: { name: string; url?: string | null; framework: string },
  onActivity: (scenario: string, index: number, message: string) => void,
  signal?: AbortSignal,
): Promise<ParallelGenerationResult> {
  const activities: GooseActivity[] = [];

  try {
    const sessionPayloads = scenarios.map((scenario, i) => ({
      scenario,
      index: i,
      task: `Generate a complete ${projectContext.framework} test file for: ${scenario}
Project: ${projectContext.name}${projectContext.url ? `\nURL: ${projectContext.url}` : ""}
Return ONLY the test code in a \`\`\`typescript fence.`,
    }));

    const results = await Promise.all(
      sessionPayloads.map(async ({ scenario, index, task }) => {
        onActivity(scenario, index, "Starting agent...");
        try {
          const result = await callGooseAPI("/v1/chat", { task, tools: [] }) as { content?: string };
          onActivity(scenario, index, "Agent complete");
          const match = result?.content?.match(/```(?:typescript|ts)\n?([\s\S]*?)```/);
          return { scenario, code: match ? match[1].trim() : "" };
        } catch (err) {
          onActivity(scenario, index, `Agent error: ${err instanceof Error ? err.message : "Unknown"}`);
          return { scenario, code: "" };
        }
      })
    );

    return { scenarios: results.filter((r) => r.code), activities };
  } catch (err) {
    activities.push({ timestamp: Date.now(), message: `Parallel generation error: ${err}`, type: "error" });
    return { scenarios: [], activities };
  }
}

async function runFallbackParallelGeneration(
  scenarios: string[],
  projectContext: { name: string; url?: string | null; framework: string },
  onActivity: (scenario: string, index: number, message: string) => void,
  signal?: AbortSignal,
): Promise<ParallelGenerationResult> {
  const activities: GooseActivity[] = [];

  const frameworkName = projectContext.framework === "playwright" ? "Playwright" : "Cypress";
  const imports = projectContext.framework === "playwright"
    ? `import { test, expect } from '@playwright/test';`
    : `/// <reference types="cypress" />`;

  const systemPrompt = `You are an expert test automation engineer specializing in ${frameworkName}.
Generate a complete, production-ready ${frameworkName} test file.
Start with: ${imports}
Use proper describe blocks, meaningful assertions, and robust selectors.
${projectContext.url ? `The application is at: ${projectContext.url}` : ""}
Output ONLY the test code in a \`\`\`typescript fence.`;

  const results = await Promise.all(
    scenarios.map(async (scenario, i) => {
      if (signal?.aborted) return { scenario, code: "" };
      onActivity(scenario, i, "Generating test...");
      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: `Generate ${frameworkName} tests for: ${scenario}` }],
        });
        const text = response.content[0].type === "text" ? response.content[0].text : "";
        const match = text.match(/```(?:typescript|ts)\n?([\s\S]*?)```/);
        onActivity(scenario, i, "Done");
        return { scenario, code: match ? match[1].trim() : text };
      } catch (err) {
        onActivity(scenario, i, `Error: ${err instanceof Error ? err.message : "Unknown"}`);
        return { scenario, code: "" };
      }
    })
  );

  return {
    scenarios: results.filter((r) => r.code),
    activities,
  };
}
