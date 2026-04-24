import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface PlanLimits {
  maxProjects: number;
  maxRunsPerMonth: number;
  selfHealing: boolean;
  monitoring: boolean;
  webhooks: boolean;
  autoDream: boolean;
}

export interface SubscriptionData {
  plan: "free" | "pro" | "team";
  limits: PlanLimits;
  usage: { projects: number; runsThisMonth: number };
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export function useBilling() {
  const query = useQuery<SubscriptionData>({
    queryKey: ["/api/billing/subscription"],
    retry: 1,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/billing/checkout", { priceId });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      return data;
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/billing/portal", {});
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      return data;
    },
  });

  return {
    subscription: query.data,
    isLoading: query.isLoading,
    plan: query.data?.plan || "free",
    limits: query.data?.limits,
    usage: query.data?.usage,
    checkout: checkoutMutation.mutate,
    openPortal: portalMutation.mutate,
    isCheckingOut: checkoutMutation.isPending,
    isOpeningPortal: portalMutation.isPending,
  };
}

export function usePlans() {
  return useQuery<{ products: any[] }>({
    queryKey: ["/api/billing/plans"],
    retry: 1,
  });
}
