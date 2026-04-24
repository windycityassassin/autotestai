import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "./index";

const PROJECT_ROOT = process.cwd();
const VENV_PATH = join(PROJECT_ROOT, ".venv");
const MEMPALACE_PORT = 7438;
const MEMPALACE_URL = `http://127.0.0.1:${MEMPALACE_PORT}`;

let sidecarProcess: ChildProcess | null = null;
let healthy = false;
let restartCount = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

function getBackoffMs(count: number): number {
  return Math.min(1000 * Math.pow(2, count), 30000);
}

function startSidecar() {
  if (shuttingDown) return;

  const pythonBin = existsSync(join(VENV_PATH, "bin", "python"))
    ? join(VENV_PATH, "bin", "python")
    : existsSync(join(VENV_PATH, "bin", "python3"))
    ? join(VENV_PATH, "bin", "python3")
    : "python3";

  const mempalaceScript = join(VENV_PATH, "bin", "mempalace-server.py");

  log(`[mempalace] Starting sidecar (attempt ${restartCount + 1})`, "mempalace");

  const proc = spawn(
    pythonBin,
    [
      mempalaceScript,
      "--host", "127.0.0.1",
      "--port", String(MEMPALACE_PORT),
      "--chroma-path", join(PROJECT_ROOT, ".chromadb"),
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        VIRTUAL_ENV: VENV_PATH,
        PATH: `${join(VENV_PATH, "bin")}:${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  sidecarProcess = proc;

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) log(`[mempalace] ${text}`, "mempalace");
    if (text.includes("Uvicorn running") || text.includes("Application startup complete") || text.includes("started")) {
      healthy = true;
      restartCount = 0;
      log("[mempalace] MemPalace is healthy", "mempalace");
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) log(`[mempalace] ${text}`, "mempalace");
    if (text.includes("Uvicorn running") || text.includes("Application startup complete") || text.includes("started")) {
      healthy = true;
      restartCount = 0;
      log("[mempalace] MemPalace is healthy", "mempalace");
    }
  });

  proc.on("exit", (code, signal) => {
    healthy = false;
    sidecarProcess = null;

    if (shuttingDown) return;

    log(`[mempalace] Process exited (code=${code}, signal=${signal}). Will restart.`, "mempalace");
    restartCount++;
    const delay = getBackoffMs(restartCount);
    log(`[mempalace] Restarting in ${delay}ms (attempt ${restartCount})`, "mempalace");
    restartTimer = setTimeout(startSidecar, delay);
  });

  proc.on("error", (err) => {
    log(`[mempalace] Failed to start: ${err.message}`, "mempalace");
    healthy = false;
    sidecarProcess = null;

    if (shuttingDown) return;

    restartCount++;
    const delay = getBackoffMs(restartCount);
    restartTimer = setTimeout(startSidecar, delay);
  });

  setTimeout(() => {
    if (!healthy && proc === sidecarProcess) {
      log("[mempalace] Health check timeout — process may not have started correctly", "mempalace");
    }
  }, 10000);
}

export function initMemPalace() {
  if (!existsSync(VENV_PATH)) {
    log("[mempalace] .venv not found — MemPalace sidecar will not start. Run scripts/setup-mempalace.sh first.", "mempalace");
    return;
  }

  startSidecar();

  process.on("SIGTERM", () => {
    shuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (sidecarProcess) sidecarProcess.kill("SIGTERM");
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (sidecarProcess) sidecarProcess.kill("SIGTERM");
  });
}

export function isHealthy(): boolean {
  return healthy;
}

export async function searchMemory(
  projectId: number,
  query: string,
  nResults = 5
): Promise<Array<{ pattern: string; selector: string; confidence: number; tags?: string[] }>> {
  if (!healthy) {
    throw new Error("MemPalace is not available");
  }

  const response = await fetch(`${MEMPALACE_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      n_results: nResults,
      where: { project_id: String(projectId) },
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`MemPalace search failed: ${response.status}`);
  }

  const data = await response.json() as {
    results: Array<{
      document: string;
      metadata: { pattern?: string; selector?: string; confidence?: number; tags?: string };
      distance: number;
    }>;
  };

  return (data.results ?? []).map((r) => ({
    pattern: r.metadata?.pattern ?? r.document,
    selector: r.metadata?.selector ?? "",
    confidence: r.metadata?.confidence ?? (1 - r.distance),
    tags: r.metadata?.tags ? r.metadata.tags.split(",").filter(Boolean) : undefined,
  }));
}

export async function storeMemory(
  projectId: number,
  item: { pattern: string; selector: string; confidence: number; tags?: string[] }
): Promise<void> {
  if (!healthy) {
    throw new Error("MemPalace is not available");
  }

  const id = `project_${projectId}_${Buffer.from(item.pattern + item.selector).toString("base64url").slice(0, 32)}`;

  const response = await fetch(`${MEMPALACE_URL}/store`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      document: `${item.pattern} ${item.selector}`,
      metadata: {
        project_id: String(projectId),
        pattern: item.pattern,
        selector: item.selector,
        confidence: item.confidence,
        tags: item.tags?.join(",") ?? "",
      },
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`MemPalace store failed: ${response.status}`);
  }
}
