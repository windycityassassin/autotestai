import { useBilling } from "@/hooks/useBilling";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

const PLAN_STYLE: Record<string, { label: string; className: string }> = {
  free: { label: "Free", className: "bg-zinc-800 text-zinc-400 border-zinc-700" },
  pro: { label: "Pro", className: "bg-[#0DFF82]/10 text-[#0DFF82] border-[#0DFF82]/30" },
  team: { label: "Team", className: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
};

export function PlanBadge() {
  const { plan } = useBilling();
  const style = PLAN_STYLE[plan] || PLAN_STYLE.free;
  return (
    <Badge
      variant="outline"
      className={`text-xs font-semibold px-2 py-0.5 ${style.className}`}
      data-testid="badge-plan"
    >
      {plan === "pro" || plan === "team" ? <Zap className="w-3 h-3 mr-1" /> : null}
      {style.label}
    </Badge>
  );
}
