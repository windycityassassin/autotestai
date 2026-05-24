import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import ThankYou from "@/pages/ThankYou";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import DashboardPage from "@/pages/Dashboard";
import ProjectDetail from "@/pages/ProjectDetail";
import MonitoringPage from "@/pages/Monitoring";
import BillingPage from "@/pages/Billing";
import ActivityPage from "@/pages/Activity";
import Demo from "@/pages/Demo";
import { useEffect } from "react";

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [location] = useLocation();

  useEffect(() => {
    if (!loading && user && (location === "/login" || location === "/register")) {
      setLocation("/dashboard");
    }
  }, [user, loading, location, setLocation]);

  return <>{children}</>;
}

function Router() {
  return (
    <AuthRedirect>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/thank-you" component={ThankYou} />
        <Route path="/login" component={Login} />
        <Route path="/register" component={Register} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/dashboard/projects" component={DashboardPage} />
        <Route path="/dashboard/monitoring" component={MonitoringPage} />
        <Route path="/dashboard/billing" component={BillingPage} />
        <Route path="/dashboard/activity" component={ActivityPage} />
        <Route path="/dashboard/projects/:id" component={ProjectDetail} />
        <Route path="/demo" component={Demo} />
        <Route component={NotFound} />
      </Switch>
    </AuthRedirect>
  );
}

const DEMO_BASE =
  import.meta.env.VITE_DEMO_MODE === "true" ? "/autotestai" : "";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <WouterRouter base={DEMO_BASE}>
            <Router />
          </WouterRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
