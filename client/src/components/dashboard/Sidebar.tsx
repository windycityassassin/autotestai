import { useAuth } from "@/context/AuthContext";
import { useLocation, Link } from "wouter";
import { Terminal, LayoutDashboard, FolderOpen, Zap, LogOut, User, Activity, CreditCard, ArrowUpRight } from "lucide-react";
import { useBilling } from "@/hooks/useBilling";

const G = "#0DFF82";

const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderOpen },
  { href: "/dashboard/monitoring", label: "Monitoring", icon: Activity },
  { href: "/dashboard/activity", label: "Activity", icon: Zap },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { plan, usage, limits } = useBilling();

  const planLabel = plan === "pro" ? "Pro" : plan === "team" ? "Team" : "Free";
  const planColor = plan === "pro" ? G : plan === "team" ? "#a855f7" : "rgba(255,255,255,0.3)";
  const isApproachingLimit = plan === "free" && usage && limits && limits.maxRunsPerMonth !== Infinity
    ? usage.runsThisMonth >= limits.maxRunsPerMonth * 0.8
    : false;

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{
        background: "rgba(8,8,8,1)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="px-5 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Link href="/dashboard" data-testid="link-logo">
          <div className="flex items-center gap-3 cursor-pointer">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: G }}
            >
              <Terminal className="w-4 h-4 text-black" />
            </div>
            <span className="font-black text-sm tracking-tight">
              <span className="text-white">Auto</span>
              <span style={{ color: G }}>Test</span>
              <span className="text-white">AI</span>
            </span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navLinks.map(({ href, label, icon: Icon, disabled }) => {
          const isActive = location === href || (href !== "/dashboard" && location.startsWith(href));
          return (
            <div key={href}>
              {disabled ? (
                <div
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-not-allowed"
                  data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                  style={{ color: "rgba(255,255,255,0.2)" }}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                  <span
                    className="ml-auto text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.2)" }}
                  >
                    Soon
                  </span>
                </div>
              ) : (
                <Link href={href} data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all duration-150"
                    style={{
                      background: isActive ? `${G}14` : "transparent",
                      color: isActive ? G : "rgba(255,255,255,0.5)",
                      borderLeft: isActive ? `2px solid ${G}` : "2px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                        (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.8)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
                      }
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </div>
                </Link>
              )}
            </div>
          );
        })}
      </nav>

      {plan === "free" && (
        <div className="px-3 pb-3">
          <Link href="/dashboard/billing" data-testid="link-upgrade-cta">
            <div
              className="rounded-xl p-3 cursor-pointer transition-all duration-200 group"
              style={{ background: `${G}0D`, border: `1px solid ${G}25` }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = `${G}1A`;
                (e.currentTarget as HTMLElement).style.borderColor = `${G}50`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = `${G}0D`;
                (e.currentTarget as HTMLElement).style.borderColor = `${G}25`;
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold" style={{ color: G }}>Upgrade to Pro</span>
                <ArrowUpRight className="w-3 h-3" style={{ color: G }} />
              </div>
              {usage && limits && limits.maxRunsPerMonth !== Infinity && (
                <div className="mb-2">
                  <div className="flex justify-between text-xs mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                    <span>Runs this month</span>
                    <span style={{ color: isApproachingLimit ? "#FF2947" : "rgba(255,255,255,0.5)" }}>
                      {usage.runsThisMonth}/{limits.maxRunsPerMonth}
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (usage.runsThisMonth / limits.maxRunsPerMonth) * 100)}%`,
                        background: isApproachingLimit ? "#FF2947" : G,
                      }}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Self-healing, monitoring & more
              </p>
            </div>
          </Link>
        </div>
      )}

      <div className="px-3 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <User className="w-3.5 h-3.5 text-white/60" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-white truncate" data-testid="text-user-name">{user?.name}</p>
              <span
                className="text-xs font-bold px-1 py-0.5 rounded shrink-0"
                style={{ color: planColor, background: `${planColor}15`, fontSize: "9px" }}
                data-testid="badge-plan-sidebar"
              >
                {planLabel}
              </span>
            </div>
            <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.3)" }} data-testid="text-user-email">
              {user?.email}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          data-testid="button-logout"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
          style={{ color: "rgba(255,255,255,0.35)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,41,71,0.08)";
            (e.currentTarget as HTMLElement).style.color = "#FF2947";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)";
          }}
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
