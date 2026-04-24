import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Copy, Download, Loader2, Zap, CheckCircle2, Globe, PenLine, FlaskConical, AlertTriangle, XCircle, Brain, ChevronDown, ChevronRight, Trash2, Sparkles, Activity, Clock, RefreshCw, Pause, Play, Bell, Webhook, Cpu, Database } from "lucide-react";
import { Link } from "wouter";
import type { Project, GeneratedTest, TestReview, ReviewFlag, ProjectMemory, ScheduledRunLog } from "@shared/schema";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { TestRunner } from "@/components/TestRunner";

const G = "#0DFF82";

type GenerationPhase = "idle" | "inspecting" | "writing" | "reviewing" | "done";

function formatDate(dateStr: string | Date) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PhaseChip({
  icon: Icon,
  label,
  status,
}: {
  icon: React.ElementType;
  label: string;
  status: "pending" | "active" | "done";
}) {
  const isActive = status === "active";
  const isDone = status === "done";
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
      style={{
        background: isDone
          ? `${G}18`
          : isActive
          ? `${G}22`
          : "rgba(255,255,255,0.04)",
        border: `1px solid ${isDone ? `${G}50` : isActive ? `${G}80` : "rgba(255,255,255,0.08)"}`,
        color: isDone ? G : isActive ? G : "rgba(255,255,255,0.3)",
      }}
    >
      {isActive ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : isDone ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <Icon className="w-3 h-3" />
      )}
      {label}
    </div>
  );
}

function phaseStatus(currentPhase: GenerationPhase, phaseTarget: GenerationPhase): "pending" | "active" | "done" {
  const order: GenerationPhase[] = ["idle", "inspecting", "writing", "reviewing", "done"];
  const current = order.indexOf(currentPhase);
  const target = order.indexOf(phaseTarget);
  if (current > target) return "done";
  if (current === target) return "active";
  return "pending";
}

function FlagIcon({ level }: { level: ReviewFlag["level"] }) {
  if (level === "red") return <XCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#FF4444" }} />;
  if (level === "yellow") return <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "#FFB800" }} />;
  return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: G }} />;
}

function flagColor(level: ReviewFlag["level"]) {
  if (level === "red") return { bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.2)", text: "#FF6666" };
  if (level === "yellow") return { bg: "rgba(255,184,0,0.08)", border: "rgba(255,184,0,0.2)", text: "#FFB800" };
  return { bg: `${G}10`, border: `${G}30`, text: G };
}

function QualityReviewCard({ review }: { review: TestReview }) {
  const scoreColor =
    review.score >= 80 ? G : review.score >= 60 ? "#FFB800" : "#FF4444";

  const reds = review.flags.filter((f) => f.level === "red");
  const yellows = review.flags.filter((f) => f.level === "yellow");
  const greens = review.flags.filter((f) => f.level === "green");
  const sortedFlags = [...reds, ...yellows, ...greens];

  return (
    <div
      className="rounded-xl border p-5 mb-8"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
      data-testid="quality-review-card"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4" style={{ color: G }} />
          <span className="text-white font-bold text-sm">Quality Review</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>Score</span>
          <span
            className="text-2xl font-black tabular-nums"
            style={{ color: scoreColor }}
            data-testid="review-score"
          >
            {review.score}
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>/100</span>
        </div>
      </div>

      {sortedFlags.length === 0 ? (
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>No findings.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sortedFlags.map((flag, i) => {
            const c = flagColor(flag.level);
            return (
              <div
                key={i}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}
                data-testid={`review-flag-${flag.level}-${i}`}
              >
                <FlagIcon level={flag.level} />
                <span className="text-xs leading-relaxed" style={{ color: c.text }}>
                  {flag.message}
                  {flag.line != null && (
                    <span className="ml-1 opacity-60">line {flag.line}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const MEMORY_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  selector: { label: "Selector", color: "#0DFF82", bg: "rgba(13,255,130,0.08)" },
  pattern: { label: "Pattern", color: "#60a5fa", bg: "rgba(96,165,250,0.08)" },
  strategy: { label: "Strategy", color: "#c084fc", bg: "rgba(192,132,252,0.08)" },
  anti_pattern: { label: "Anti-pattern", color: "#f87171", bg: "rgba(248,113,113,0.08)" },
};

function MemoryPanel({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [compactMsg, setCompactMsg] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: memory, isLoading } = useQuery<ProjectMemory[]>({
    queryKey: ["/api/projects", String(projectId), "memory"],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/memory`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load memory");
        return r.json();
      }),
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (memoryId: number) =>
      apiRequest("DELETE", `/api/projects/${projectId}/memory/${memoryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", String(projectId), "memory"] });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const compactMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/memory/compact`),
    onSuccess: async (res: Response) => {
      const data = await res.json();
      setCompactMsg(`Memory compacted u2014 ${data.pruned} items consolidated`);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", String(projectId), "memory"] });
      setTimeout(() => setCompactMsg(null), 5000);
    },
    onError: () => toast({ title: "Compaction failed", variant: "destructive" }),
  });

  const grouped = (memory ?? []).reduce<Record<string, ProjectMemory[]>>((acc, item) => {
    (acc[item.type] = acc[item.type] ?? []).push(item);
    return acc;
  }, {});

  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => b.confidence - a.confidence);
  }

  const total = memory?.length ?? 0;

  return (
    <div
      className="rounded-xl border mb-8"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
      data-testid="panel-memory"
    >
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid="button-memory-toggle"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4" style={{ color: "#0DFF82" }} />
          <span className="text-white font-bold">Project Memory</span>
          {total > 0 && (
            <span className="text-xs font-normal ml-1" style={{ color: "rgba(255,255,255,0.35)" }}>
              {total} item{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} />
        ) : (
          <ChevronRight className="w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} />
        )}
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="border-t mb-4" style={{ borderColor: "rgba(255,255,255,0.06)" }} />

          {compactMsg && (
            <div
              className="flex items-center gap-2 text-xs mb-4 px-3 py-2 rounded-lg"
              style={{ background: "rgba(13,255,130,0.08)", color: "#0DFF82" }}
              data-testid="text-compact-message"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {compactMsg}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading memory...</span>
            </div>
          ) : total === 0 ? (
            <p className="text-sm py-4" style={{ color: "rgba(255,255,255,0.25)" }} data-testid="text-memory-empty">
              No memory yet. Run a test to start learning selectors and patterns.
            </p>
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => compactMutation.mutate()}
                  disabled={compactMutation.isPending || total < 5}
                  data-testid="button-compact-memory"
                  className="text-xs gap-1.5 border-white/10 bg-transparent text-white/50 hover:text-white"
                >
                  {compactMutation.isPending ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Compacting...</>
                  ) : (
                    <><Sparkles className="w-3 h-3" /> Compact</>
                  )}
                </Button>
              </div>

              <div className="flex flex-col gap-4">
                {(["selector", "pattern", "strategy", "anti_pattern"] as const).map((type) => {
                  const items = grouped[type];
                  if (!items || items.length === 0) return null;
                  const cfg = MEMORY_TYPE_CONFIG[type] ?? MEMORY_TYPE_CONFIG.selector;
                  return (
                    <div key={type}>
                      <div
                        className="text-xs font-semibold uppercase tracking-wider mb-2"
                        style={{ color: cfg.color }}
                      >
                        {cfg.label}s ({items.length})
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between rounded-lg px-3 py-2 gap-2"
                            style={{ background: cfg.bg }}
                            data-testid={`memory-item-${item.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.7)" }}>
                                {item.value}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className="text-xs font-semibold tabular-nums"
                                style={{ color: cfg.color }}
                                data-testid={`confidence-${item.id}`}
                              >
                                {item.confidence.toFixed(1)}
                              </span>
                              <button
                                onClick={() => deleteMutation.mutate(item.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-memory-${item.id}`}
                                className="opacity-40 hover:opacity-100 transition-opacity"
                                style={{ color: "#f87171" }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type MonitoringData = {
  project: {
    id: number;
    monitoringSchedule: string;
    webhookSecret: string | null;
    monitoringPaused: boolean;
    lastScheduledRunAt: string | null;
  };
  nextRunAt: number | null;
  logs: ScheduledRunLog[];
  passRate7d: number | null;
  latestDreamSummary: string | null;
  openclawWebhookUrl: string | null;
  alertEmail: string | null;
};

function formatRelative(ts: string | number | null) {
  if (!ts) return "Never";
  const d = typeof ts === "number" ? ts : new Date(ts).getTime();
  const diff = Date.now() - d;
  if (diff < 0) {
    const future = -diff;
    if (future < 60000) return "In a moment";
    if (future < 3600000) return `In ${Math.round(future / 60000)}m`;
    if (future < 86400000) return `In ${Math.round(future / 3600000)}h`;
    return `In ${Math.round(future / 86400000)}d`;
  }
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function MonitoringSettings({ projectId }: { projectId: number }) {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<MonitoringData>({
    queryKey: ["/api/projects", String(projectId), "monitoring"],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/monitoring`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load monitoring");
        return r.json();
      }),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/monitoring`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", String(projectId), "monitoring"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      refetch();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update monitoring settings", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-xl p-5 animate-pulse" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", height: 120 }} />
    );
  }

  const schedule = data?.project.monitoringSchedule ?? "off";
  const paused = data?.project.monitoringPaused ?? false;
  const webhookSecret = data?.project.webhookSecret;
  const nextRunAt = data?.nextRunAt;
  const passRate = data?.passRate7d;
  const logs = data?.logs ?? [];
  const dream = data?.latestDreamSummary;
  const lastLog = logs.find((l) => l.trigger !== "dream");

  const appUrl = window.location.origin;
  const webhookUrl = webhookSecret ? `${appUrl}/api/projects/${projectId}/trigger` : null;

  return (
    <div
      className="rounded-xl border p-6 mt-8"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.07)" }}
      data-testid="monitoring-settings"
    >
      <div className="flex items-center gap-2 mb-5">
        <Activity className="w-4 h-4" style={{ color: G }} />
        <h2 className="text-white font-bold text-lg">Monitoring</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
            Schedule
          </Label>
          <Select
            value={schedule}
            onValueChange={(v) => updateMutation.mutate({ monitoringSchedule: v })}
          >
            <SelectTrigger data-testid="select-monitoring-schedule" className="border text-white bg-transparent border-white/10 focus:border-[#0DFF82]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ background: "#181818", borderColor: "rgba(255,255,255,0.12)" }}>
              <SelectItem value="off" data-testid="option-monitoring-off">Off</SelectItem>
              <SelectItem value="hourly" data-testid="option-monitoring-hourly">Hourly</SelectItem>
              <SelectItem value="daily" data-testid="option-monitoring-daily">Daily</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {schedule !== "off" && (
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={() => updateMutation.mutate({ monitoringPaused: !paused })}
              disabled={updateMutation.isPending}
              data-testid="button-toggle-pause"
              className="border-white/10 bg-transparent text-white/60 hover:text-white hover:bg-white/5 gap-2"
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? "Resume monitoring" : "Pause monitoring"}
            </Button>
          </div>
        )}
      </div>

      {schedule !== "off" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-1 mb-1">
              <Clock className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Next run</span>
            </div>
            <p className="text-sm font-semibold text-white" data-testid="text-monitoring-next-run">
              {paused ? "Paused" : formatRelative(nextRunAt ?? null)}
            </p>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-1 mb-1">
              <Activity className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Last heartbeat</span>
            </div>
            <p className="text-sm font-semibold text-white" data-testid="text-monitoring-last-heartbeat">
              {lastLog ? formatRelative(lastLog.triggeredAt as unknown as string) : "Never"}
            </p>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-1 mb-1">
              <CheckCircle2 className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>7-day pass rate</span>
            </div>
            <p
              className="text-sm font-semibold"
              style={{ color: passRate === null ? "rgba(255,255,255,0.4)" : passRate >= 80 ? G : passRate >= 50 ? "#FFB800" : "#FF4444" }}
              data-testid="text-monitoring-pass-rate"
            >
              {passRate === null ? "—" : `${passRate}%`}
            </p>
          </div>
        </div>
      )}

      {webhookUrl && (
        <div className="mb-4">
          <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
            Webhook URL
          </Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={webhookUrl}
              data-testid="input-webhook-url"
              className="flex-1 text-xs bg-transparent border-white/10 text-white/60 font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(`${webhookUrl}?token=${webhookSecret}`);
                toast({ title: "Webhook URL copied" });
              }}
              data-testid="button-copy-webhook"
              className="border-white/10 bg-transparent text-white/60 hover:text-white hover:bg-white/5 gap-1.5 flex-shrink-0"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateMutation.mutate({ regenerateSecret: true })}
              disabled={updateMutation.isPending}
              data-testid="button-regenerate-secret"
              className="border-white/10 bg-transparent text-white/60 hover:text-white hover:bg-white/5 gap-1.5 flex-shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </Button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
            Connect this to Vercel / GitHub deploy hooks for on-deploy runs. Token is included in the URL above.
          </p>
        </div>
      )}

      {dream && (
        <div className="rounded-lg p-4 mb-4" style={{ background: `${G}06`, border: `1px solid ${G}20` }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5" style={{ color: G }} />
            <span className="text-xs font-bold" style={{ color: G }}>Weekly Insight</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }} data-testid="text-dream-summary">
            {dream}
          </p>
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
            Recent Heartbeats
          </h3>
          <div className="space-y-2" data-testid="list-heartbeats">
            {logs.filter((l) => l.trigger !== "dream").slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
                style={{
                  background: log.failed > 0 ? "rgba(255,68,68,0.05)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${log.failed > 0 ? "rgba(255,68,68,0.12)" : "rgba(255,255,255,0.05)"}`,
                }}
                data-testid={`heartbeat-log-${log.id}`}
              >
                {log.failed > 0
                  ? <XCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#FF4444" }} />
                  : <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: G }} />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">
                      {log.passed} passed, {log.failed} failed
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded capitalize"
                      style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}
                    >
                      {log.trigger}
                    </span>
                  </div>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {formatRelative(log.triggeredAt as unknown as string)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OpenClawPanel({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: config, isLoading } = useQuery<MonitoringData>({
    queryKey: ["/api/projects", String(projectId), "monitoring"],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/monitoring`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load monitoring config");
        return r.json();
      }),
    enabled: open,
  });

  const savedUrl = config?.openclawWebhookUrl ?? null;
  const isConnected = !!savedUrl;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/monitoring`, {
        openclawWebhookUrl: urlInput.trim() || null,
        alertEmail: emailInput.trim() || null,
      });
      return res.json();
    },
    onSuccess: (data: MonitoringData) => {
      queryClient.setQueryData(["/api/projects", String(projectId), "monitoring"], data);
      toast({ title: "Monitoring settings saved" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && config) {
      setUrlInput(config.openclawWebhookUrl ?? "");
      setEmailInput(config.alertEmail ?? "");
    }
  };

  if (open && config && urlInput === "" && emailInput === "" && (config.openclawWebhookUrl || config.alertEmail)) {
    setUrlInput(config.openclawWebhookUrl ?? "");
    setEmailInput(config.alertEmail ?? "");
  }

  const handleTestConnection = async () => {
    const urlToTest = urlInput.trim() || savedUrl;
    if (!urlToTest) {
      toast({ title: "No URL set", description: "Save a webhook URL first", variant: "destructive" });
      return;
    }
    setTestStatus("testing");
    setTestError(null);
    try {
      const res = await apiRequest("POST", `/api/projects/${projectId}/monitoring/test-notify`);
      const data = await res.json();
      if (data.success) {
        setTestStatus("success");
        setTimeout(() => setTestStatus("idle"), 4000);
      } else {
        setTestStatus("error");
        setTestError(data.error || "Test failed");
      }
    } catch (err: unknown) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : "Test failed");
    }
  };

  const statusBadge = isConnected ? (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "rgba(13,255,130,0.12)", color: G }}
      data-testid="status-openclaw-connected"
    >
      Connected
    </span>
  ) : (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}
      data-testid="status-openclaw-not-configured"
    >
      Not configured
    </span>
  );

  return (
    <div
      className="rounded-xl border mb-8"
      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
      data-testid="panel-notifications"
    >
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => handleOpenChange(!open)}
        data-testid="button-notifications-toggle"
      >
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: G }} />
          <span className="text-white font-bold">Notifications</span>
          <div className="ml-1">{statusBadge}</div>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} />
        ) : (
          <ChevronRight className="w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} />
        )}
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="border-t mb-5" style={{ borderColor: "rgba(255,255,255,0.06)" }} />

          {isLoading ? (
            <div className="flex items-center gap-2 py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading settings...</span>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Webhook className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                  <Label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>
                    OpenClaw Webhook URL
                  </Label>
                </div>
                <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Paste your OpenClaw webhook URL to receive alerts on Slack, WhatsApp, Discord, and more.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://your-openclaw-instance.com/webhook/..."
                    data-testid="input-openclaw-url"
                    className="flex-1 border text-white placeholder:text-white/20 bg-transparent border-white/10 focus:border-[#0DFF82] text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testStatus === "testing" || (!urlInput.trim() && !savedUrl)}
                    data-testid="button-test-connection"
                    className="shrink-0 border-white/10 bg-transparent text-white/50 hover:text-white text-xs gap-1.5"
                  >
                    {testStatus === "testing" ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Testing...</>
                    ) : testStatus === "success" ? (
                      <><CheckCircle2 className="w-3 h-3" style={{ color: G }} /> Sent!</>
                    ) : testStatus === "error" ? (
                      <><XCircle className="w-3 h-3 text-red-400" /> Failed</>
                    ) : (
                      "Test connection"
                    )}
                  </Button>
                </div>
                {testStatus === "error" && testError && (
                  <p className="text-xs mt-1.5 text-red-400" data-testid="text-test-error">{testError}</p>
                )}
                {testStatus === "success" && (
                  <p className="text-xs mt-1.5" style={{ color: G }} data-testid="text-test-success">
                    Test ping delivered successfully!
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Fallback Email
                </Label>
                <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Used when OpenClaw is not configured or if webhook delivery fails.
                </p>
                <Input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  data-testid="input-alert-email"
                  className="border text-white placeholder:text-white/20 bg-transparent border-white/10 focus:border-[#0DFF82] text-sm"
                />
              </div>

              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save-monitoring"
                size="sm"
                className="font-bold text-black gap-2"
                style={{ background: G, border: "none" }}
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</>
                ) : (
                  "Save settings"
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [framework, setFramework] = useState<"playwright" | "cypress">("playwright");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [streamingCode, setStreamingCode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<GenerationPhase>("idle");
  const [phaseLabel, setPhaseLabel] = useState("");
  const [currentReview, setCurrentReview] = useState<TestReview | null>(null);
  const streamingRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to hash section (used by /demo?section= deep links)
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const attempt = (tries: number) => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (tries > 0) {
        setTimeout(() => attempt(tries - 1), 500);
      }
    };
    setTimeout(() => attempt(6), 300);
  }, []);

  const { data: project, isLoading: projectLoading, error: projectError } = useQuery<Project>({
    queryKey: ["/api/projects", id],
  });

  const { data: tests, isLoading: testsLoading } = useQuery<GeneratedTest[]>({
    queryKey: ["/api/projects", id, "tests"],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/tests`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load tests");
        return r.json();
      }),
    enabled: !!project,
  });

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({ title: "Please describe what to test", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    setCurrentPhase("inspecting");
    setPhaseLabel("Inspecting page...");
    setStreamingCode("");
    setCurrentReview(null);
    streamingRef.current = "";

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/projects/${projectId}/generate-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ framework, prompt, url: url || undefined }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Generation failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.phase) {
                setCurrentPhase(data.phase as GenerationPhase);
                if (data.phaseLabel) setPhaseLabel(data.phaseLabel as string);
              }
              if (data.content) {
                streamingRef.current += data.content;
                setStreamingCode(streamingRef.current);
              }
              if (data.review) {
                setCurrentReview(data.review as TestReview);
              }
              if (data.done) {
                setCurrentPhase("done");
                queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "tests"] });
              }
              if (data.error) {
                setCurrentPhase("idle");
                throw new Error(data.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Generation failed";
      toast({ title: "Generation failed", description: message, variant: "destructive" });
      setCurrentPhase("idle");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyStreaming = () => {
    navigator.clipboard.writeText(streamingCode);
    toast({ title: "Copied to clipboard" });
  };

  const handleDownloadStreaming = () => {
    const blob = new Blob([streamingCode], { type: "text/plain" });
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `generated-test.spec.ts`;
    a.click();
    URL.revokeObjectURL(objUrl);
  };

  const isActive = isGenerating || currentPhase !== "idle";

  if (projectLoading) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-6 w-32 rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="h-10 w-64 rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
            <div className="h-4 w-96 rounded" style={{ background: "rgba(255,255,255,0.04)" }} />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (projectError || !project) {
    return (
      <DashboardLayout>
        <div className="p-8 flex flex-col items-center justify-center py-24">
          <p className="text-white/50 mb-4">Project not found.</p>
          <button
            onClick={() => setLocation("/dashboard")}
            data-testid="button-back-to-dashboard"
            className="text-sm font-medium"
            style={{ color: G }}
          >
            Back to dashboard
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8 max-w-4xl">
        <Link href="/dashboard" data-testid="link-back-dashboard">
          <div
            className="inline-flex items-center gap-2 text-sm mb-6 cursor-pointer transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </div>
        </Link>

        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: G }}>Project</p>
          <h1 className="text-3xl font-black text-white mb-1" data-testid="text-project-name">
            {project.name}
          </h1>
          {project.description && (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }} data-testid="text-project-description">
              {project.description}
            </p>
          )}
          {project.url && (
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.25)" }} data-testid="text-project-url">
              {project.url}
            </p>
          )}
        </div>

        <div
          id="generate"
          className="rounded-xl border p-6 mb-8"
          style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2 mb-5">
            <Zap className="w-4 h-4" style={{ color: G }} />
            <h2 className="text-white font-bold text-lg">Generate Tests with AI</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-1">
              <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                Framework
              </Label>
              <Select
                value={framework}
                onValueChange={(v) => setFramework(v as "playwright" | "cypress")}
              >
                <SelectTrigger
                  data-testid="select-framework"
                  className="border text-white bg-transparent border-white/10 focus:border-[#0DFF82]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: "#181818", borderColor: "rgba(255,255,255,0.12)" }}>
                  <SelectItem value="playwright" data-testid="option-playwright">Playwright</SelectItem>
                  <SelectItem value="cypress" data-testid="option-cypress">Cypress (best-effort)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                URL or HTML snippet (optional)
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com or paste HTML..."
                data-testid="input-url"
                className="border text-white placeholder:text-white/20 bg-transparent border-white/10 focus:border-[#0DFF82]"
              />
            </div>
          </div>

          {project.isDemo && (
            <div className="mb-4" data-testid="demo-prompt-chips">
              <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                Try these
              </Label>
              <div className="flex flex-wrap gap-2">
                {[
                  "Test that the People section loads and displays a list of contacts",
                  "Test that clicking a contact opens their detail view",
                  "Test that the search bar filters results when a name is typed",
                  "Test that the sidebar navigation links all work without errors",
                  "Test that the login page shows the correct form fields",
                ].map((sample) => (
                  <button
                    key={sample}
                    onClick={() => setPrompt(sample)}
                    className="text-xs px-3 py-1.5 rounded-full transition-all"
                    style={{
                      background: prompt === sample ? `${G}20` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${prompt === sample ? `${G}50` : "rgba(255,255,255,0.10)"}`,
                      color: prompt === sample ? G : "rgba(255,255,255,0.55)",
                    }}
                    data-testid={`chip-demo-prompt-${sample.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4">
            <Label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
              Describe what to test
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Test the login flow including valid credentials, invalid password, and empty fields. Verify error messages appear correctly and successful login redirects to the dashboard."
              rows={4}
              data-testid="textarea-prompt"
              className="border text-white placeholder:text-white/20 resize-none bg-transparent border-white/10 focus:border-[#0DFF82]"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            data-testid="button-generate"
            className="font-bold gap-2 text-black"
            style={{ background: G, border: "none" }}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> {phaseLabel || "Generating..."}
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" /> Generate Test
              </>
            )}
          </Button>
        </div>

        {isActive && (
          <div
            className="rounded-xl border mb-6 overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.02)",
              borderColor: isGenerating ? `${G}40` : "rgba(255,255,255,0.08)",
            }}
            data-testid="generation-pipeline"
          >
            <div className="px-5 py-3 flex items-center justify-between border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <PhaseChip
                  icon={Globe}
                  label="Inspect page"
                  status={phaseStatus(currentPhase, "inspecting")}
                />
                <div className="w-4 h-px" style={{ background: "rgba(255,255,255,0.12)" }} />
                <PhaseChip
                  icon={PenLine}
                  label="Write test"
                  status={phaseStatus(currentPhase, "writing")}
                />
                <div className="w-4 h-px" style={{ background: "rgba(255,255,255,0.12)" }} />
                <PhaseChip
                  icon={FlaskConical}
                  label="Review quality"
                  status={phaseStatus(currentPhase, "reviewing")}
                />
              </div>
              {!isGenerating && streamingCode && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyStreaming}
                    data-testid="button-copy-generated"
                    className="text-xs gap-1.5 border-white/10 bg-transparent text-white/60 hover:text-white"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadStreaming}
                    data-testid="button-download-generated"
                    className="text-xs gap-1.5 border-white/10 bg-transparent text-white/60 hover:text-white"
                  >
                    <Download className="w-3.5 h-3.5" /> Download .spec.ts
                  </Button>
                </div>
              )}
            </div>
            <div data-testid="code-output">
              {streamingCode ? (
                <SyntaxHighlighter
                  language="typescript"
                  style={vscDarkPlus}
                  customStyle={{ margin: 0, borderRadius: 0, background: "#080808", fontSize: "12px", maxHeight: "500px" }}
                  showLineNumbers={!isGenerating}
                >
                  {streamingCode}
                </SyntaxHighlighter>
              ) : (
                <div className="p-6 flex items-center gap-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: G }} />
                  <span className="text-sm">{phaseLabel || "AI is analyzing your page..."}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {currentReview && <QualityReviewCard review={currentReview} />}

        <div id="memory"><MemoryPanel projectId={projectId} /></div>

        <OpenClawPanel projectId={projectId} />

        <div id="saved-tests">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg" data-testid="text-saved-tests-header">
              Saved Tests
              {tests && tests.length > 0 && (
                <span className="ml-2 text-sm font-normal" style={{ color: "rgba(255,255,255,0.3)" }}>
                  ({tests.length})
                </span>
              )}
            </h2>
            {tests && tests.some((t) => t.framework === "playwright") && (
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(13,255,130,0.08)", color: "#0DFF82", border: "1px solid rgba(13,255,130,0.2)" }}
                  data-testid="badge-passmark-engine"
                  title="Playwright tests use Passmark for natural language step execution, Redis step caching, and multi-model assertion consensus"
                >
                  <Cpu className="w-3 h-3" />
                  Powered by Passmark
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
                  style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}
                  data-testid="badge-passmark-cache-status"
                  title="Step caching requires Redis — run tests to see cache stats"
                >
                  <Database className="w-3 h-3" />
                  Step cache
                </span>
              </div>
            )}
          </div>

          {testsLoading ? (
            <div className="flex items-center gap-2 py-8" style={{ color: "rgba(255,255,255,0.3)" }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading saved tests...</span>
            </div>
          ) : tests && tests.length > 0 ? (
            <div className="flex flex-col gap-4" data-testid="list-tests">
              {[...tests].reverse().map((test) => (
                <TestRunner key={test.id} test={test} projectId={projectId} />
              ))}
            </div>
          ) : (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}
              data-testid="text-no-tests"
            >
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
                No tests generated yet. Use the form above to create your first test.
              </p>
            </div>
          )}
        </div>

        <MonitoringSettings projectId={projectId} />
      </div>
    </DashboardLayout>
  );
}
