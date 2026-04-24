import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Activity, CheckCircle2, XCircle, Clock, Zap, TrendingUp, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import type { Project, ScheduledRunLog } from "@shared/schema";

const G = "#0DFF82";

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

function SparkLine({ logs }: { logs: ScheduledRunLog[] }) {
  const runLogs = logs.filter((l) => l.trigger !== "dream" && l.testsRun > 0).slice(0, 7).reverse();
  if (runLogs.length === 0) return <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>No data</span>;

  const points = runLogs.map((l) => {
    const total = l.passed + l.failed;
    return total > 0 ? Math.round((l.passed / total) * 100) : 100;
  });

  const max = 100;
  const height = 32;
  const width = 80;
  const step = width / Math.max(1, points.length - 1);

  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - (p / max) * height;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={path} fill="none" stroke={G} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={i * step} cy={height - (p / max) * height} r={2.5} fill={p >= 80 ? G : p >= 50 ? "#FFB800" : "#FF4444"} />
      ))}
    </svg>
  );
}

function MonitoringProjectCard({ project, monitoringData }: { project: Project; monitoringData: MonitoringData | undefined }) {
  const schedule = monitoringData?.project.monitoringSchedule ?? project.monitoringSchedule;
  const paused = monitoringData?.project.monitoringPaused ?? project.monitoringPaused;
  const nextRun = monitoringData?.nextRunAt ?? null;
  const passRate = monitoringData?.passRate7d ?? null;
  const logs = monitoringData?.logs ?? [];
  const dream = monitoringData?.latestDreamSummary ?? null;

  const lastLog = logs.find((l) => l.trigger !== "dream");

  if (schedule === "off") return null;

  return (
    <div
      className="rounded-xl p-5 mb-4"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid={`monitoring-card-${project.id}`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-white font-bold text-sm truncate">{project.name}</h3>
            {paused ? (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(255,184,0,0.1)", color: "#FFB800", border: "1px solid rgba(255,184,0,0.2)" }}>
                Paused
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${G}10`, color: G, border: `1px solid ${G}25` }}>
                {schedule === "hourly" ? "Hourly" : "Daily"}
              </span>
            )}
          </div>
          {project.url && (
            <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{project.url}</p>
          )}
        </div>
        <Link href={`/dashboard/projects/${project.id}`} data-testid={`link-monitoring-project-${project.id}`}>
          <span className="text-xs font-medium" style={{ color: G }}>Settings</span>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <Clock className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Next run</span>
          </div>
          <p className="text-sm font-semibold text-white" data-testid={`text-next-run-${project.id}`}>
            {paused ? "Paused" : formatRelative(nextRun)}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Last heartbeat</span>
          </div>
          <p className="text-sm font-semibold text-white" data-testid={`text-last-heartbeat-${project.id}`}>
            {lastLog ? formatRelative(lastLog.triggeredAt as unknown as string) : "Never"}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>7-day rate</span>
          </div>
          <p
            className="text-sm font-semibold"
            style={{ color: passRate === null ? "rgba(255,255,255,0.4)" : passRate >= 80 ? G : passRate >= 50 ? "#FFB800" : "#FF4444" }}
            data-testid={`text-pass-rate-${project.id}`}
          >
            {passRate === null ? "—" : `${passRate}%`}
          </p>
        </div>
        <div className="rounded-lg p-3 flex flex-col items-start" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1 mb-1">
            <Zap className="w-3 h-3" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Trend</span>
          </div>
          <SparkLine logs={logs} />
        </div>
      </div>

      {lastLog && (
        <div
          className="flex items-center gap-3 rounded-lg px-3 py-2 mb-3"
          style={{
            background: lastLog.failed > 0 ? "rgba(255,68,68,0.06)" : `${G}08`,
            border: `1px solid ${lastLog.failed > 0 ? "rgba(255,68,68,0.15)" : `${G}20`}`,
          }}
        >
          {lastLog.failed > 0
            ? <XCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#FF4444" }} />
            : <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: G }} />
          }
          <span className="text-xs" style={{ color: lastLog.failed > 0 ? "#FF6666" : G }}>
            Last run: {lastLog.passed} passed, {lastLog.failed} failed
          </span>
        </div>
      )}

      {dream && (
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="w-3 h-3" style={{ color: G }} />
            <span className="text-xs font-semibold" style={{ color: G }}>Weekly Insight</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }} data-testid={`text-dream-${project.id}`}>
            {dream}
          </p>
        </div>
      )}
    </div>
  );
}

export default function MonitoringPage() {
  const { data: projects, isLoading } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const monitoredProjects = (projects ?? []).filter((p) => p.monitoringSchedule !== "off");

  const monitoringQueries = useQuery<Record<number, MonitoringData>>({
    queryKey: ["/api/monitoring-all", monitoredProjects.map((p) => p.id).join(",")],
    queryFn: async () => {
      if (monitoredProjects.length === 0) return {};
      const results = await Promise.all(
        monitoredProjects.map(async (p) => {
          const res = await fetch(`/api/projects/${p.id}/monitoring`, { credentials: "include" });
          if (!res.ok) return [p.id, null] as [number, null];
          const data = await res.json();
          return [p.id, data] as [number, MonitoringData];
        })
      );
      return Object.fromEntries(results.filter(([, d]) => d !== null));
    },
    enabled: monitoredProjects.length > 0,
    refetchInterval: 60000,
  });

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: G }}>Autonomous</p>
          <h1 className="text-3xl font-black text-white">Monitoring</h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            Scheduled heartbeats, pass rate trends, and weekly reliability insights.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-xl p-5 animate-pulse" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", height: 180 }} />
            ))}
          </div>
        ) : monitoredProjects.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            data-testid="text-no-monitored-projects"
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: `${G}14` }}>
              <Activity className="w-6 h-6" style={{ color: G }} />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">No monitoring enabled</h2>
            <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.35)" }}>
              Enable scheduled monitoring on a project to see heartbeats and trends here.
            </p>
            <Link href="/dashboard">
              <span className="text-sm font-medium" style={{ color: G }}>Go to projects</span>
            </Link>
          </div>
        ) : (
          <div data-testid="list-monitored-projects">
            {monitoredProjects.map((project) => (
              <MonitoringProjectCard
                key={project.id}
                project={project}
                monitoringData={monitoringQueries.data?.[project.id]}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
