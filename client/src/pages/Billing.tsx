import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Zap, Building2, Rocket, ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBilling, usePlans } from "@/hooks/useBilling";
import { Skeleton } from "@/components/ui/skeleton";

const STATIC_PLANS = [
  {
    id: "free",
    name: "Free",
    icon: Rocket,
    price: { month: 0, year: 0 },
    description: "Try AutoTestAI with one project.",
    features: [
      "1 project",
      "20 test runs / month",
      "AI test generation",
      "Manual test runner",
    ],
    notIncluded: ["Self-healing tests", "Monitoring", "Webhooks", "autoDream reports"],
    cta: "Current plan",
    planId: "free",
    accent: "zinc",
  },
  {
    id: "pro",
    name: "Pro",
    icon: Zap,
    price: { month: 49, year: 470 },
    description: "The full power of AutoTestAI.",
    features: [
      "5 projects",
      "Unlimited test runs",
      "AI test generation",
      "Self-healing tests",
      "Hourly & daily monitoring",
      "Email + Slack alerts",
      "Project memory",
    ],
    notIncluded: ["Webhooks", "autoDream reports"],
    cta: "Upgrade to Pro",
    planId: "pro",
    accent: "green",
    popular: true,
  },
  {
    id: "team",
    name: "Team",
    icon: Building2,
    price: { month: 149, year: 1430 },
    description: "Unlimited everything for engineering teams.",
    features: [
      "Unlimited projects",
      "Unlimited test runs",
      "AI test generation",
      "Self-healing tests",
      "Hourly, daily & custom monitoring",
      "All notification channels",
      "Webhooks & CI/CD triggers",
      "Weekly autoDream summaries",
      "Project memory & compaction",
    ],
    notIncluded: [],
    cta: "Upgrade to Team",
    planId: "team",
    accent: "purple",
  },
];

const ACCENT_CLASSES: Record<string, { border: string; badge: string; button: string; check: string; glow: string }> = {
  zinc: {
    border: "border-zinc-700/50",
    badge: "bg-zinc-800 text-zinc-400",
    button: "bg-zinc-800 hover:bg-zinc-700 text-zinc-300",
    check: "text-zinc-500",
    glow: "",
  },
  green: {
    border: "border-[#0DFF82]/30",
    badge: "bg-[#0DFF82]/10 text-[#0DFF82] border border-[#0DFF82]/30",
    button: "bg-[#0DFF82] hover:bg-[#0DFF82]/90 text-black font-bold",
    check: "text-[#0DFF82]",
    glow: "shadow-[0_0_30px_rgba(13,255,130,0.08)]",
  },
  purple: {
    border: "border-purple-500/30",
    badge: "bg-purple-500/10 text-purple-400 border border-purple-500/30",
    button: "bg-purple-600 hover:bg-purple-500 text-white font-bold",
    check: "text-purple-400",
    glow: "shadow-[0_0_30px_rgba(168,85,247,0.08)]",
  },
};

export default function Billing() {
  const [, setLocation] = useLocation();
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const { plan, subscription, checkout, openPortal, isCheckingOut, isOpeningPortal, isLoading } = useBilling();
  const { data: plansData } = usePlans();

  function getPriceIdForPlan(planId: string, interval: "month" | "year"): string | null {
    if (!plansData?.products) return null;
    for (const product of plansData.products) {
      const meta = product.metadata as any;
      if (meta?.plan_id === planId) {
        const price = product.prices.find((p: any) => p.recurring?.interval === interval);
        if (price) return price.id;
      }
    }
    return null;
  }

  function handleUpgrade(planId: string) {
    if (planId === "free") return;
    const priceId = getPriceIdForPlan(planId, billingInterval);
    if (priceId) {
      checkout(priceId);
    }
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <button
            onClick={() => setLocation("/dashboard")}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm"
            data-testid="link-back-dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Simple, honest pricing</h1>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Tests that fix themselves. Pay only for what your team needs.
          </p>

          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setBillingInterval("month")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${billingInterval === "month" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              data-testid="button-billing-monthly"
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval("year")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${billingInterval === "year" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              data-testid="button-billing-yearly"
            >
              Yearly
              <span className="ml-2 text-[#0DFF82] text-xs font-bold">Save 20%</span>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[500px] rounded-2xl bg-zinc-800" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STATIC_PLANS.map((p) => {
              const accent = ACCENT_CLASSES[p.accent];
              const isCurrent = plan === p.planId;
              const Icon = p.icon;
              const displayPrice = billingInterval === "year"
                ? Math.round(p.price.year / 12)
                : p.price.month;

              return (
                <div
                  key={p.id}
                  className={`relative rounded-2xl border bg-[#0E0E0E] p-8 flex flex-col gap-6 ${accent.border} ${accent.glow} transition-all duration-300`}
                  data-testid={`card-plan-${p.planId}`}
                >
                  {p.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${accent.badge}`}>
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`w-5 h-5 ${p.accent === "green" ? "text-[#0DFF82]" : p.accent === "purple" ? "text-purple-400" : "text-zinc-500"}`} />
                      <span className="font-bold text-lg">{p.name}</span>
                      {isCurrent && (
                        <Badge variant="outline" className="text-xs ml-auto border-zinc-600 text-zinc-400" data-testid={`badge-current-${p.planId}`}>
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="mb-2">
                      {p.price.month === 0 ? (
                        <span className="text-4xl font-bold">Free</span>
                      ) : (
                        <div>
                          <span className="text-4xl font-bold">${displayPrice}</span>
                          <span className="text-zinc-500 ml-1">/mo</span>
                          {billingInterval === "year" && (
                            <div className="text-sm text-zinc-500 mt-1">billed ${p.price.year}/yr</div>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400">{p.description}</p>
                  </div>

                  <ul className="space-y-2 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className={`w-4 h-4 mt-0.5 shrink-0 ${accent.check}`} />
                        <span className="text-zinc-200">{f}</span>
                      </li>
                    ))}
                    {p.notIncluded.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm opacity-40">
                        <span className="w-4 h-4 mt-0.5 shrink-0 text-center leading-none">—</span>
                        <span className="text-zinc-400">{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <div className="flex flex-col gap-2">
                      <div className={`w-full py-2 rounded-lg text-center text-sm font-medium ${accent.button} opacity-60`}>
                        Current plan
                      </div>
                      {plan !== "free" && (
                        <button
                          onClick={() => openPortal()}
                          disabled={isOpeningPortal}
                          className="w-full py-2 rounded-lg text-center text-sm text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center gap-1"
                          data-testid="button-manage-billing"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {isOpeningPortal ? "Opening…" : "Manage billing"}
                        </button>
                      )}
                    </div>
                  ) : p.planId === "free" ? (
                    <div
                      className={`w-full py-2 rounded-lg text-center text-sm font-medium ${accent.button} opacity-50`}
                    >
                      Downgrade
                    </div>
                  ) : (
                    <Button
                      onClick={() => handleUpgrade(p.planId)}
                      disabled={isCheckingOut || !getPriceIdForPlan(p.planId, billingInterval)}
                      className={`w-full ${accent.button}`}
                      data-testid={`button-upgrade-${p.planId}`}
                    >
                      {isCheckingOut ? "Redirecting…" : !getPriceIdForPlan(p.planId, billingInterval) ? "Loading…" : p.cta}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {plan === "free" && (
          <div className="mt-8 p-4 rounded-xl border border-zinc-700/50 bg-zinc-900/50 text-center text-sm text-zinc-400">
            You're on the <strong className="text-white">Free plan</strong>.&nbsp;
            {subscription?.usage && (
              <>
                Used <strong className="text-white">{subscription.usage.runsThisMonth}</strong>/20 runs this month
                and <strong className="text-white">{subscription.usage.projects}</strong>/1 projects.
              </>
            )}
          </div>
        )}

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-center text-sm text-zinc-400">
          {[
            { title: "Cancel anytime", body: "No contracts. Downgrade or cancel immediately from your billing portal." },
            { title: "Sandbox safe", body: "Connected to Stripe Sandbox. No real charges until you go live." },
            { title: "SOC 2 in progress", body: "Your test code and results never leave your account." },
          ].map((item) => (
            <div key={item.title} className="p-4 rounded-xl border border-zinc-800">
              <div className="font-semibold text-white mb-1">{item.title}</div>
              <div>{item.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
