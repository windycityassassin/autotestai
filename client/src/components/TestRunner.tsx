import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { GeneratedTest, TestRun } from "@shared/schema";
import {
  Play, ChevronDown, ChevronUp, CheckCircle2, XCircle,
  Clock, Loader2, Trash2, Code2, Wand2, X, ShieldCheck, ShieldAlert,
  Zap, Bot, ChevronRight, Database, Cpu, Wrench, WifiOff,
} from "lucide-react";

const G = "#0DFF82";

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
        style={{ background: "rgba(251,191,36,0.12)", color: "#FBbf24" }}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Running
      </span>
    );
  }
  if (status === "passed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
        style={{ background: `${G}14`, color: G }}>
        <CheckCircle2 className="w-3 h-3" />
        Passed
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
        style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}>
        <XCircle className="w-3 h-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
      <Clock className="w-3 h-3" />
      {status}
    </span>
  );
}

function HealedBadge({ via }: { via?: string | null }) {
  const isGoose = via === "goose" || via === "goose-fallback";
  const isPassmark = via === "passmark";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
      style={{
        background: isGoose
          ? "rgba(6,182,212,0.15)"
          : isPassmark
          ? "rgba(139,92,246,0.15)"
          : "rgba(139,92,246,0.15)",
        color: isGoose ? "#22D3EE" : isPassmark ? "#A78BFA" : "#A78BFA",
      }}
      data-testid="badge-healed"
    >
      {isGoose ? <Bot className="w-3 h-3" /> : isPassmark ? <Wrench className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
      {isGoose ? "Healed via Goose" : isPassmark ? "Healed via Passmark" : "Healed"}
    </span>
  );
}

function formatTime(dateStr: string | Date) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RunOutputPanel({ lines, isStreaming }: { lines: string[]; isStreaming: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  const colorLine = (line: string) => {
    if (/✓|passed|ok/i.test(line)) return G;
    if (/✗|×|failed|error/i.test(line)) return "#EF4444";
    if (/\d+ passed/.test(line)) return G;
    if (/\d+ failed/.test(line)) return "#EF4444";
    return "rgba(255,255,255,0.7)";
  };

  return (
    <div
      className="rounded-lg p-4 font-mono text-xs overflow-y-auto max-h-72"
      style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid="panel-test-output"
    >
      {lines.length === 0 && isStreaming && (
        <span style={{ color: "rgba(255,255,255,0.3)" }}>Starting test run...</span>
      )}
      {lines.map((line, i) => (
        <div key={i} style={{ color: colorLine(line), whiteSpace: "pre-wrap", lineHeight: "1.6" }}>
          {line}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function DiffView({ original, patched }: { original: string; patched: string }) {
  const originalLines = original.split("\n");
  const patchedLines = patched.split("\n");

  const diffLines: { type: "same" | "removed" | "added"; text: string }[] = [];

  let oi = 0;
  let pi = 0;

  while (oi < originalLines.length || pi < patchedLines.length) {
    const ol = originalLines[oi];
    const pl = patchedLines[pi];

    if (oi >= originalLines.length) {
      diffLines.push({ type: "added", text: pl });
      pi++;
    } else if (pi >= patchedLines.length) {
      diffLines.push({ type: "removed", text: ol });
      oi++;
    } else if (ol === pl) {
      diffLines.push({ type: "same", text: ol });
      oi++;
      pi++;
    } else {
      diffLines.push({ type: "removed", text: ol });
      diffLines.push({ type: "added", text: pl });
      oi++;
      pi++;
    }
  }

  const changedLines = diffLines.filter((l) => l.type !== "same");
  if (changedLines.length === 0) {
    return <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>No changes detected.</p>;
  }

  return (
    <div
      className="rounded-lg overflow-hidden font-mono text-xs"
      style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid="panel-diff-view"
    >
      <div className="px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>Diff — {changedLines.length} line{changedLines.length !== 1 ? "s" : ""} changed</span>
      </div>
      <div className="overflow-y-auto max-h-64" style={{ background: "rgba(0,0,0,0.3)" }}>
        {diffLines.map((line, i) => {
          if (line.type === "same") return null;
          return (
            <div
              key={i}
              className="px-4 py-0.5"
              style={{
                background: line.type === "added" ? "rgba(13,255,130,0.08)" : "rgba(239,68,68,0.08)",
                color: line.type === "added" ? G : "#EF4444",
                whiteSpace: "pre-wrap",
              }}
            >
              {line.type === "added" ? "+" : "-"} {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface GooseActivityEntry {
  timestamp: number;
  message: string;
  activityType: "info" | "action" | "result" | "error";
}

function GooseActivityPanel({ activities, targetUrl, isStreaming }: {
  activities: GooseActivityEntry[];
  targetUrl?: string;
  isStreaming: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities.length]);

  const colorForType = (type: string) => {
    if (type === "result") return "#0DFF82";
    if (type === "error") return "#EF4444";
    if (type === "action") return "#22D3EE";
    return "rgba(255,255,255,0.6)";
  };

  return (
    <div
      className="rounded-lg overflow-hidden mt-3"
      style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(6,182,212,0.04)" }}
      data-testid="panel-goose-activity"
    >
      <button
        className="w-full flex items-center justify-between px-3 py-2"
        style={{ background: "rgba(6,182,212,0.06)" }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="w-3 h-3 animate-spin" style={{ color: "#22D3EE" }} />
          ) : (
            <Bot className="w-3 h-3" style={{ color: "#22D3EE" }} />
          )}
          <span className="text-xs font-semibold" style={{ color: "#22D3EE" }}>
            {targetUrl ? `Goose is inspecting ${targetUrl}` : "Goose Agent Activity"}
          </span>
          {activities.length > 0 && (
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
              ({activities.length} events)
            </span>
          )}
        </div>
        <ChevronRight
          className="w-3 h-3 transition-transform"
          style={{ color: "rgba(255,255,255,0.3)", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}
        />
      </button>
      {!collapsed && (
        <div
          className="px-3 py-2 font-mono text-xs overflow-y-auto max-h-48 space-y-1"
          style={{ background: "rgba(0,0,0,0.3)" }}
        >
          {activities.length === 0 && isStreaming && (
            <span style={{ color: "rgba(255,255,255,0.3)" }}>Initializing agent...</span>
          )}
          {activities.map((act, i) => (
            <div key={i} className="flex items-start gap-2">
              <span style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>
                {new Date(act.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span style={{ color: colorForType(act.activityType) }}>{act.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

interface HealPanelProps {
  testId: number;
  runId: number;
  failureOutput: string;
  originalCode: string;
  targetUrl?: string;
  onClose: () => void;
  onHealed: () => void;
}

function HealPanel({ testId, runId, failureOutput, originalCode, targetUrl, onClose, onHealed, initialMode }: HealPanelProps & { initialMode?: "quick" | "deep" }) {
  const [phase, setPhase] = useState<"idle" | "healing" | "done" | "exhausted">("idle");
  const [attempts, setAttempts] = useState(0);
  const [diagnosisText, setDiagnosisText] = useState("");
  const [codeText, setCodeText] = useState("");
  const [preflightResult, setPreflightResult] = useState<{ safe: boolean; reason: string } | null>(null);
  const [rerunOutput, setRerunOutput] = useState<string[]>([]);
  const [finalStatus, setFinalStatus] = useState<"passed" | "failed" | null>(null);
  const [finalDiagnosis, setFinalDiagnosis] = useState("");
  const [patchedCode, setPatchedCode] = useState("");
  const [healError, setHealError] = useState("");
  const [gooseOffline, setGooseOffline] = useState(false);
  const [gooseActivities, setGooseActivities] = useState<GooseActivityEntry[]>([]);
  const [healMode, setHealMode] = useState<"quick" | "deep">(initialMode || "quick");
  const [healedVia, setHealedVia] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const diagnosisBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    diagnosisBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [diagnosisText, rerunOutput.length]);

  function startHeal(mode: "quick" | "deep" = healMode) {
    setHealMode(mode);
    setPhase("healing");
    setAttempts(0);
    setDiagnosisText("");
    setCodeText("");
    setPreflightResult(null);
    setRerunOutput([]);
    setFinalStatus(null);
    setFinalDiagnosis("");
    setPatchedCode("");
    setHealError("");
    setGooseOffline(false);
    setGooseActivities([]);
    setHealedVia(null);

    let aborted = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const controller = new AbortController();
    abortRef.current = () => {
      aborted = true;
      controller.abort();
      reader?.cancel();
    };

    (async () => {
      try {
        const resp = await fetch(`/api/tests/${testId}/heal`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, failureOutput, mode }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          setHealError("Failed to start heal: " + resp.statusText);
          setPhase("done");
          return;
        }

        reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let latestCode = "";
        let codeAccumulator = "";

        while (true) {
          if (aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const json = JSON.parse(dataLine.slice(5).trim());
              const { type } = json;

              if (type === "goose_status") {
                if (json.status === "down") setGooseOffline(true);
              } else if (type === "goose_activity") {
                setGooseActivities((prev) => [...prev, {
                  timestamp: json.timestamp as number,
                  message: json.message as string,
                  activityType: (json.activityType || "info") as GooseActivityEntry["activityType"],
                }]);
              } else if (type === "heal_attempt") {
                setAttempts(json.attempt as number);
                setDiagnosisText("");
                setCodeText("");
                setPreflightResult(null);
                setRerunOutput([]);
                codeAccumulator = "";
              } else if (type === "diagnosis_chunk") {
                setDiagnosisText((prev) => prev + (json.text as string));
              } else if (type === "diagnosis") {
                setDiagnosisText(json.text as string);
              } else if (type === "code_chunk") {
                const chunk = json.text as string;
                codeAccumulator += chunk;
                latestCode = codeAccumulator;
                setCodeText(codeAccumulator);
              } else if (type === "patch_complete") {
                const cleanCode = json.code as string;
                latestCode = cleanCode;
                codeAccumulator = cleanCode;
                setCodeText(cleanCode);
              } else if (type === "code_saved") {
                latestCode = codeAccumulator;
                setPatchedCode(latestCode);
              } else if (type === "preflight_result") {
                setPreflightResult({ safe: json.safe as boolean, reason: json.reason as string });
              } else if (type === "rerun_output") {
                setRerunOutput((prev) => [...prev, ...(json.text as string).split("\n")]);
              } else if (type === "heal_success") {
                setFinalStatus("passed");
                setPatchedCode(latestCode);
                setHealedVia((json.via as string) || null);
                onHealed();
                setPhase("done");
              } else if (type === "heal_exhausted") {
                setFinalDiagnosis(json.finalDiagnosis as string);
                setPhase("exhausted");
              } else if (type === "heal_cancelled") {
                setPhase("done");
                setHealError("Healing cancelled.");
              } else if (type === "heal_error") {
                setHealError(json.message as string);
              }
            } catch (_) {}
          }
        }

      } catch (err: unknown) {
        if (!aborted) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setHealError("Connection error: " + msg);
          setPhase("done");
        }
      }
    })();
  }

  function cancel() {
    abortRef.current?.();
    abortRef.current = null;
    setPhase("done");
    setHealError("Healing cancelled.");
  }

  return (
    <div
      className="rounded-xl overflow-hidden mt-4"
      style={{ border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.05)" }}
      data-testid="panel-heal"
    >
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(139,92,246,0.15)" }}>
        <div className="flex items-center gap-2">
          {healMode === "deep" ? (
            <Bot className="w-4 h-4" style={{ color: "#22D3EE" }} />
          ) : (
            <Wand2 className="w-4 h-4" style={{ color: "#A78BFA" }} />
          )}
          <span className="text-sm font-semibold" style={{ color: healMode === "deep" ? "#22D3EE" : "#A78BFA" }}>
            {healMode === "deep" ? "Deep Heal" : "Auto-Heal"}
          </span>
          {phase === "healing" && healMode !== "deep" && (
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              Attempt {attempts} / 3
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase === "healing" && (
            <button
              onClick={cancel}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: "rgba(239,68,68,0.1)",
                color: "#EF4444",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
              data-testid="button-cancel-heal"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          )}
          {phase !== "healing" && (
            <button
              onClick={onClose}
              className="p-1 rounded"
              style={{ color: "rgba(255,255,255,0.3)" }}
              data-testid="button-close-heal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              {initialMode === "deep"
                ? "Deep Heal uses Goose to inspect the live app DOM before patching — more accurate for structural changes."
                : "Claude will analyze the failure, patch the test code, and re-run it automatically. Up to 3 attempts will be made."}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => startHeal("quick")}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all"
                style={{
                  background: "rgba(139,92,246,0.2)",
                  color: "#A78BFA",
                  border: "1px solid rgba(139,92,246,0.3)",
                }}
                data-testid="button-start-heal"
              >
                <Wand2 className="w-4 h-4" />
                Quick Heal
              </button>
              <button
                onClick={() => startHeal("deep")}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all"
                style={{
                  background: "rgba(6,182,212,0.12)",
                  color: "#22D3EE",
                  border: "1px solid rgba(6,182,212,0.3)",
                }}
                data-testid="button-start-deep-heal"
              >
                <Bot className="w-4 h-4" />
                Deep Heal (Goose)
              </button>
            </div>
          </div>
        )}

        {(phase === "healing" || phase === "done" || phase === "exhausted") && (
          <div className="space-y-4">
            {gooseOffline && (
              <div
                className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#FBbf24" }}
                data-testid="text-goose-offline"
              >
                <Bot className="w-3.5 h-3.5 flex-shrink-0" />
                Goose offline — using enhanced Claude fallback
              </div>
            )}

            {(healMode === "deep" && (gooseActivities.length > 0 || phase === "healing")) && (
              <GooseActivityPanel
                activities={gooseActivities}
                targetUrl={targetUrl}
                isStreaming={phase === "healing"}
              />
            )}

            {diagnosisText && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(139,92,246,0.7)" }}>
                  Diagnosis
                </p>
                <div
                  className="rounded-lg p-3 text-xs leading-relaxed"
                  style={{ background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.06)" }}
                  data-testid="text-diagnosis"
                >
                  {diagnosisText}
                  {phase === "healing" && !diagnosisText.endsWith(".") && (
                    <span className="animate-pulse" style={{ color: "#A78BFA" }}>▊</span>
                  )}
                </div>
              </div>
            )}

            {codeText && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(139,92,246,0.7)" }}>
                  Patched Code
                  {phase === "healing" && <span className="ml-1 animate-pulse" style={{ color: "#A78BFA" }}>▊</span>}
                </p>
                <div
                  className="rounded-lg p-3 font-mono text-xs overflow-y-auto max-h-48"
                  style={{ background: "rgba(0,0,0,0.4)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.06)" }}
                  data-testid="panel-patched-code"
                >
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{codeText}</pre>
                </div>
              </div>
            )}

            {preflightResult && (
              <div
                className="rounded-lg px-3 py-2 flex items-center gap-2 text-xs"
                style={{
                  background: preflightResult.safe ? "rgba(13,255,130,0.06)" : "rgba(239,68,68,0.08)",
                  border: `1px solid ${preflightResult.safe ? "rgba(13,255,130,0.2)" : "rgba(239,68,68,0.2)"}`,
                  color: preflightResult.safe ? G : "#EF4444",
                }}
                data-testid="panel-preflight"
              >
                {preflightResult.safe
                  ? <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  : <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />}
                <span>{preflightResult.safe ? "Safety check passed" : "Safety check failed"}</span>
                {preflightResult.reason && (
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>— {preflightResult.reason}</span>
                )}
              </div>
            )}

            {rerunOutput.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(139,92,246,0.7)" }}>
                  Re-run Output
                </p>
                <RunOutputPanel lines={rerunOutput} isStreaming={phase === "healing"} />
              </div>
            )}

            {patchedCode && (phase === "done" || phase === "exhausted") && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(139,92,246,0.7)" }}>
                  Changes Made
                </p>
                <DiffView original={originalCode} patched={patchedCode} />
              </div>
            )}

            {healError && (
              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
                data-testid="text-heal-error"
              >
                {healError}
              </div>
            )}

            {phase === "done" && finalStatus === "passed" && (
              <div
                className="rounded-lg px-4 py-3 flex items-center gap-3"
                style={{ background: `${G}0d`, border: `1px solid ${G}30` }}
                data-testid="panel-heal-success"
              >
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: G }} />
                <div>
                  <p className="text-sm font-semibold text-white">Test healed successfully!</p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                    {healedVia === "goose"
                      ? "Healed via Goose — the test now passes with Goose-inspected selectors."
                      : healedVia === "goose-fallback"
                      ? "Healed via Goose (fallback mode) — test code updated and passing."
                      : "The test code has been updated and all tests now pass."}
                  </p>
                </div>
              </div>
            )}

            {phase === "exhausted" && (
              <div
                className="rounded-lg px-4 py-3 space-y-2"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
                data-testid="panel-heal-exhausted"
              >
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#EF4444" }} />
                  <p className="text-sm font-semibold" style={{ color: "#EF4444" }}>Couldn't heal after 3 attempts</p>
                </div>
                {finalDiagnosis && (
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)", marginLeft: "1.5rem" }}>
                    {finalDiagnosis.slice(0, 500)}
                  </p>
                )}
              </div>
            )}

            <div ref={diagnosisBottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function RunHistoryItem({
  run,
  testCode,
  testId,
  framework,
  targetUrl,
  onHealComplete,
}: {
  run: TestRun;
  testCode: string;
  testId: number;
  framework: string | null;
  targetUrl?: string;
  onHealComplete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showHeal, setShowHeal] = useState(false);
  const [healInitMode, setHealInitMode] = useState<"quick" | "deep">("quick");

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid={`run-history-item-${run.id}`}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
        style={{ background: "rgba(255,255,255,0.03)" }}
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-run-${run.id}`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={run.status} />
          {run.healed && <HealedBadge via={(run as any).healedVia} />}
          {run.trigger && run.trigger !== "manual" && (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: "rgba(99,102,241,0.12)", color: "#818CF8" }}
              data-testid={`badge-trigger-${run.id}`}
            >
              <Clock className="w-2.5 h-2.5" />
              {run.trigger === "scheduled" ? "Scheduled" : "Webhook"}
            </span>
          )}
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            {formatTime(run.startedAt)}
          </span>
          {run.totalCount != null && run.totalCount > 0 && (
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              <span style={{ color: G }}>{run.passedCount}</span>
              <span style={{ color: "rgba(255,255,255,0.3)" }}>/</span>
              {run.totalCount} passed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {run.status === "failed" && !showHeal && framework === "playwright" && (
            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setHealInitMode("quick");
                  setShowHeal(true);
                  setExpanded(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-l-lg transition-all"
                style={{
                  background: "rgba(139,92,246,0.15)",
                  color: "#A78BFA",
                  border: "1px solid rgba(139,92,246,0.3)",
                  borderRight: "none",
                }}
                data-testid={`button-auto-heal-${run.id}`}
              >
                <Wand2 className="w-3 h-3" />
                Auto-Heal
              </button>
              <button
                onClick={() => {
                  setHealInitMode("deep");
                  setShowHeal(true);
                  setExpanded(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-r-lg transition-all"
                style={{
                  background: "rgba(6,182,212,0.12)",
                  color: "#22D3EE",
                  border: "1px solid rgba(6,182,212,0.3)",
                }}
                data-testid={`button-deep-heal-${run.id}`}
                title="Deep Heal with Goose"
              >
                <Bot className="w-3 h-3" />
              </button>
            </div>
          )}
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2" style={{ background: "rgba(0,0,0,0.2)" }}>
          {run.output && (
            <RunOutputPanel lines={run.output.split("\n")} isStreaming={false} />
          )}
          {showHeal && run.output && (
            <HealPanel
              testId={testId}
              runId={run.id}
              failureOutput={run.output}
              originalCode={testCode}
              targetUrl={targetUrl}
              initialMode={healInitMode}
              onClose={() => setShowHeal(false)}
              onHealed={() => {
                onHealComplete();
                setShowHeal(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface LiveRunPanelProps {
  testId: number;
  onComplete: () => void;
}

interface PassmarkEvent {
  type: "cache_hit" | "cache_miss" | "auto_heal" | "redis_warning" | "assertion";
  label: string;
}

function PassmarkEventsBadge({ events }: { events: PassmarkEvent[] }) {
  if (events.length === 0) return null;
  const hits = events.filter((e) => e.type === "cache_hit").length;
  const misses = events.filter((e) => e.type === "cache_miss").length;
  const heals = events.filter((e) => e.type === "auto_heal").length;
  const noRedis = events.some((e) => e.type === "redis_warning");

  return (
    <div className="flex flex-wrap gap-1.5 items-center" data-testid="panel-passmark-events">
      {(hits > 0 || misses > 0) && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ background: "rgba(13,255,130,0.1)", color: G, border: `1px solid ${G}30` }}
          data-testid="badge-passmark-cache-hits"
          title={`${hits} cached steps replayed, ${misses} resolved via AI`}
        >
          <Database className="w-2.5 h-2.5" />
          {hits} cached · {misses} AI
        </span>
      )}
      {heals > 0 && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ background: "rgba(139,92,246,0.12)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.3)" }}
          data-testid="badge-passmark-auto-heal"
          title="Passmark auto-healed a cached step inline"
        >
          <Wrench className="w-2.5 h-2.5" />
          Auto-healed
        </span>
      )}
      {noRedis && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
          style={{ background: "rgba(234,179,8,0.1)", color: "#FBBF24", border: "1px solid rgba(234,179,8,0.25)" }}
          data-testid="badge-passmark-no-redis"
          title="Redis not configured — step caching disabled"
        >
          <WifiOff className="w-2.5 h-2.5" />
          No Redis cache
        </span>
      )}
    </div>
  );
}

function LiveRunPanel({ testId, onComplete }: LiveRunPanelProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [passmarkEvents, setPassmarkEvents] = useState<PassmarkEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    passed: number;
    failed: number;
    total: number;
    status: string;
    passmarkAutoHealed?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/tests/${testId}/run`, {
      method: "POST",
      credentials: "include",
    }).then(async (resp) => {
      if (!resp.ok || !resp.body) {
        setRunError("Failed to start test run. Please try again.");
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const json = JSON.parse(dataLine.slice(5).trim());
            if (json.type === "output" && json.text) {
              setLines((prev) => [...prev, ...json.text.split("\n")]);
            } else if (json.type === "complete") {
              setSummary({
                passed: json.passed,
                failed: json.failed,
                total: json.total,
                status: json.status,
                passmarkAutoHealed: json.passmarkAutoHealed,
              });
              onComplete();
            } else if (json.type === "error") {
              const errMsg = json.text ?? json.message ?? "An error occurred during the test run.";
              setRunError(errMsg);
              setLines((prev) => [...prev, errMsg]);
              onComplete();
            } else if (json.type === "passmark_cache_hit") {
              setPassmarkEvents((prev) => [...prev, { type: "cache_hit", label: json.step || "Cached step replayed" }]);
            } else if (json.type === "passmark_cache_miss") {
              setPassmarkEvents((prev) => [...prev, { type: "cache_miss", label: json.step || "Step resolved via AI" }]);
            } else if (json.type === "passmark_auto_heal") {
              setPassmarkEvents((prev) => [...prev, { type: "auto_heal", label: json.message || "Auto-healed" }]);
            } else if (json.type === "passmark_redis_warning") {
              setPassmarkEvents((prev) => [
                ...prev.filter((e) => e.type !== "redis_warning"),
                { type: "redis_warning", label: json.message || "Redis not configured" },
              ]);
            } else if (json.type === "passmark_assertion") {
              setPassmarkEvents((prev) => [...prev, { type: "assertion", label: json.assertion || "Assertion" }]);
            }
          } catch (_) {}
        }
      }
    }).catch((err) => {
      setLines(["Connection error: " + err.message]);
    });

    return () => {};
  }, [testId]);

  return (
    <div className="space-y-3">
      {runError && (
        <div
          className="rounded-lg px-4 py-3 flex items-start gap-2"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#EF4444" }}
          data-testid="panel-run-error"
        >
          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{runError}</p>
        </div>
      )}
      {passmarkEvents.length > 0 && !summary && (
        <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
          <Cpu className="w-3 h-3 animate-pulse" style={{ color: G }} />
          <span>Passmark executing steps…</span>
          <PassmarkEventsBadge events={passmarkEvents} />
        </div>
      )}
      {summary ? (
        <div className="space-y-2">
          <div
            className="rounded-lg px-4 py-3 flex items-center gap-3"
            style={{
              background: summary.status === "passed" ? `${G}0d` : "rgba(239,68,68,0.08)",
              border: `1px solid ${summary.status === "passed" ? `${G}30` : "rgba(239,68,68,0.3)"}`,
            }}
            data-testid="panel-run-summary"
          >
            {summary.status === "passed" ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: G }} />
            ) : (
              <XCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#EF4444" }} />
            )}
            <div>
              <p className="text-sm font-semibold text-white">
                {summary.status === "passed" ? "All tests passed!" : "Some tests failed"}
                {summary.passmarkAutoHealed && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full align-middle"
                    style={{ background: "rgba(139,92,246,0.15)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.3)" }}
                    data-testid="badge-passmark-healed"
                  >
                    <Wrench className="w-2.5 h-2.5" />
                    Passmark healed
                  </span>
                )}
              </p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                {summary.passed} passed · {summary.failed} failed · {summary.total} total
              </p>
            </div>
          </div>
          {passmarkEvents.length > 0 && (
            <PassmarkEventsBadge events={passmarkEvents} />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: G }} />
          Running tests in headless browser...
        </div>
      )}
      <RunOutputPanel lines={lines} isStreaming={!summary} />
    </div>
  );
}

interface TestRunnerProps {
  test: GeneratedTest;
  projectId: number;
}

export function TestRunner({ test, projectId }: TestRunnerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [runKey, setRunKey] = useState(0);

  const { data: runs = [], refetch: refetchRuns } = useQuery<TestRun[]>({
    queryKey: ["/api/tests", test.id, "runs"],
    queryFn: async () => {
      const resp = await fetch(`/api/tests/${test.id}/runs`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed to fetch runs");
      return resp.json();
    },
  });

  const { data: liveTest } = useQuery<GeneratedTest>({
    queryKey: ["/api/tests", test.id],
    queryFn: async () => {
      const resp = await fetch(`/api/tests/${test.id}`, { credentials: "include" });
      if (!resp.ok) throw new Error("Failed to fetch test");
      return resp.json();
    },
    initialData: test,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/tests/${test.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", String(projectId), "tests"] });
    },
  });

  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  const currentCode = liveTest?.code ?? test.code;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
      data-testid={`test-runner-${test.id}`}
    >
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h3 className="text-sm font-semibold text-white" data-testid={`text-test-title-${test.id}`}>
            {test.title}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
            Generated {formatTime(test.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCode(!showCode)}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
            data-testid={`button-toggle-code-${test.id}`}
          >
            <Code2 className="w-3.5 h-3.5" />
            {showCode ? "Hide code" : "View code"}
          </button>
          <button
            onClick={() => {
              setIsRunning(true);
              setRunKey((k) => k + 1);
            }}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
            style={{
              background: isRunning ? "rgba(255,255,255,0.05)" : G,
              color: isRunning ? "rgba(255,255,255,0.3)" : "#000",
              border: "none",
              cursor: isRunning ? "not-allowed" : "pointer",
            }}
            data-testid={`button-run-test-${test.id}`}
          >
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isRunning ? "Running..." : "Run Test"}
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "rgba(255,255,255,0.25)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#EF4444")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}
            data-testid={`button-delete-test-${test.id}`}
            title="Delete test"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {showCode && (
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}
            data-testid={`panel-test-code-${test.id}`}
          >
            <div className="px-3 py-2 flex items-center gap-2"
              style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>test.spec.ts</span>
            </div>
            <pre
              className="p-4 text-xs font-mono overflow-x-auto"
              style={{ background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.75)", margin: 0 }}
            >
              {currentCode}
            </pre>
          </div>
        )}

        {isRunning && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: "rgba(255,255,255,0.3)" }}>
              Live Output
            </h4>
            <LiveRunPanel
              key={runKey}
              testId={test.id}
              onComplete={() => {
                setIsRunning(false);
                refetchRuns();
              }}
            />
          </div>
        )}

        {sortedRuns.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: "rgba(255,255,255,0.3)" }}>
              Run History
            </h4>
            <div className="space-y-2" data-testid="panel-run-history">
              {sortedRuns.map((run) => (
                <RunHistoryItem
                  key={run.id}
                  run={run}
                  testCode={currentCode}
                  testId={test.id}
                  framework={test.framework ?? null}
                  targetUrl={test.url || undefined}
                  onHealComplete={() => {
                    refetchRuns();
                    queryClient.invalidateQueries({ queryKey: ["/api/tests", test.id] });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {sortedRuns.length === 0 && !isRunning && (
          <p className="text-xs text-center py-2" style={{ color: "rgba(255,255,255,0.2)" }}>
            No runs yet. Click "Run Test" to execute.
          </p>
        )}
      </div>
    </div>
  );
}
