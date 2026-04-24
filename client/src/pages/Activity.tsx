import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Wand2, Play, RefreshCw, Activity, Brain, CheckCircle, XCircle, Clock, Zap } from "lucide-react";
import { motion } from "framer-motion";

const G = "#0DFF82";
const R = "#FF2947";

type ActivityEvent = {
  type: "generation" | "run" | "run_passed" | "run_failed" | "heal" | "monitoring" | "dream";
  id: string;
  projectId: number;
  projectName: string;
  title?: string;
  framework?: string;
  reviewScore?: number | null;
  status?: string;
  passed?: number;
  failed?: number;
  total?: number;
  trigger?: string;
  testsRun?: number;
  notificationSent?: boolean;
  dreamSummary?: string | null;
  healAttempts?: number;
  healedVia?: string | null;
  at: string;
};

function timeAgo(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function EventIcon({ type }: { type: ActivityEvent["type"] }) {
  const base = "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0";
  if (type === "generation") return <div className={base} style={{ background: `${G}20` }}><Wand2 className="w-4 h-4" style={{ color: G }} /></div>;
  if (type === "run_passed") return <div className={base} style={{ background: "rgba(13,255,130,0.1)" }}><CheckCircle className="w-4 h-4" style={{ color: G }} /></div>;
  if (type === "run_failed") return <div className={base} style={{ background: "rgba(255,41,71,0.1)" }}><XCircle className="w-4 h-4" style={{ color: R }} /></div>;
  if (type === "run") return <div className={base} style={{ background: "rgba(255,255,255,0.05)" }}><Play className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} /></div>;
  if (type === "heal") return <div className={base} style={{ background: `${G}18` }}><RefreshCw className="w-4 h-4" style={{ color: G }} /></div>;
  if (type === "monitoring") return <div className={base} style={{ background: "rgba(168,85,247,0.12)" }}><Activity className="w-4 h-4" style={{ color: "#a855f7" }} /></div>;
  if (type === "dream") return <div className={base} style={{ background: "rgba(168,85,247,0.18)" }}><Brain className="w-4 h-4" style={{ color: "#a855f7" }} /></div>;
  return <div className={base} style={{ background: "rgba(255,255,255,0.05)" }}><Zap className="w-4 h-4" style={{ color: "rgba(255,255,255,0.3)" }} /></div>;
}

function EventRow({ event, index }: { event: ActivityEvent; index: number }) {
  const label = {
    generation: "Test Generated",
    run_passed: "Run Passed",
    run_failed: "Run Failed",
    run: "Test Run",
    heal: "Self-Healed",
    monitoring: "Monitoring Run",
    dream: "Weekly Dream",
  }[event.type] ?? event.type;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      data-testid={`activity-event-${event.id}`}
      className="flex gap-4 p-4 rounded-xl border"
      style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.015)" }}
    >
      <EventIcon type={event.type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-0.5">
          <span className="text-sm font-bold text-white">{label}</span>
          <span className="text-xs flex-shrink-0" style={{ color: "rgba(255,255,255,0.28)" }}>{timeAgo(event.at)}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
          <span>{event.projectName}</span>
          {event.title && <span className="font-mono truncate max-w-[200px]">{event.title}</span>}
          {event.framework && <span className="uppercase" style={{ color: `${G}80` }}>{event.framework}</span>}
          {event.type === "generation" && event.reviewScore != null && (
            <span>Score: <strong style={{ color: G }}>{event.reviewScore}/10</strong></span>
          )}
          {(event.type === "run_passed" || event.type === "run_failed" || event.type === "run") && event.total != null && (
            <span>
              <strong style={{ color: G }}>{event.passed}</strong> passed ·{" "}
              <strong style={{ color: event.failed ? R : "rgba(255,255,255,0.4)" }}>{event.failed}</strong> failed ·{" "}
              {event.total} total
            </span>
          )}
          {event.trigger && event.trigger !== "manual" && (
            <span className="uppercase text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)" }}>
              {event.trigger}
            </span>
          )}
          {event.type === "heal" && (
            <span>
              Healed via <strong style={{ color: G }}>{event.healedVia ?? "AI"}</strong>
              {event.healAttempts != null && event.healAttempts > 1 && ` · ${event.healAttempts} attempts`}
            </span>
          )}
          {event.type === "monitoring" && event.testsRun != null && (
            <span>{event.testsRun} tests · {event.notificationSent ? "alert sent" : "no alert"}</span>
          )}
          {event.type === "dream" && event.dreamSummary && (
            <span className="italic" style={{ color: "rgba(168,85,247,0.7)" }}>"{event.dreamSummary.slice(0, 80)}{event.dreamSummary.length > 80 ? "…" : ""}"</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function ActivityPage() {
  const { data, isLoading } = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ["/api/activity"],
  });

  const events = data?.events ?? [];

  const stats = {
    generations: events.filter((e) => e.type === "generation").length,
    runs: events.filter((e) => e.type === "run_passed" || e.type === "run_failed" || e.type === "run").length,
    heals: events.filter((e) => e.type === "heal").length,
    monitoring: events.filter((e) => e.type === "monitoring" || e.type === "dream").length,
  };

  return (
    <div className="flex min-h-screen" style={{ background: "#000" }}>
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-black text-white mb-1">Activity Feed</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
              Every test generation, run, heal, and monitoring cycle — permanently logged.
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Tests Generated", value: stats.generations, icon: <Wand2 className="w-3.5 h-3.5" />, color: G },
              { label: "Runs Recorded", value: stats.runs, icon: <Play className="w-3.5 h-3.5" />, color: G },
              { label: "Self-Heals", value: stats.heals, icon: <RefreshCw className="w-3.5 h-3.5" />, color: G },
              { label: "Monitoring Cycles", value: stats.monitoring, icon: <Activity className="w-3.5 h-3.5" />, color: "#a855f7" },
            ].map((s, i) => (
              <div key={i} data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                className="p-4 rounded-xl border"
                style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ color: s.color }}>{s.icon}</span>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</span>
                </div>
                <div className="text-2xl font-black" style={{ color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {isLoading && (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
              ))}
            </div>
          )}

          {!isLoading && events.length === 0 && (
            <div className="text-center py-24">
              <Zap className="w-12 h-12 mx-auto mb-4" style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-sm font-bold text-white mb-1">No activity yet</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                Generate your first test to start building your activity record.
              </p>
            </div>
          )}

          {!isLoading && events.length > 0 && (
            <div className="space-y-2.5">
              {events.map((event, i) => (
                <EventRow key={event.id} event={event} index={i} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
