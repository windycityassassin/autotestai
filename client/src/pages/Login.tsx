import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Terminal, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const G = "#0DFF82";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
      setLocation("/dashboard");
    } catch (err: any) {
      const msg = err.message?.includes("401") || err.message?.includes("Unauthorized")
        ? "Invalid email or password"
        : err.message || "Login failed";
      toast({ title: "Login failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "#000" }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)",
        backgroundSize: "80px 80px",
      }} />

      <div className="relative z-10 w-full max-w-sm">
        <Link href="/" data-testid="link-logo-home">
          <div className="flex items-center gap-3 mb-10 cursor-pointer justify-center">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: G }}>
              <Terminal className="w-4 h-4 text-black" />
            </div>
            <span className="font-black text-sm tracking-tight">
              <span className="text-white">Auto</span>
              <span style={{ color: G }}>Test</span>
              <span className="text-white">AI</span>
            </span>
          </div>
        </Link>

        <div
          className="rounded-2xl p-8"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <h1 className="text-xl font-bold text-white mb-1">Welcome back</h1>
          <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.4)" }}>
            Sign in to your account
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                      Email
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="you@example.com"
                        data-testid="input-email"
                        className="bg-transparent border-white/10 text-white placeholder:text-white/20 focus:border-[#0DFF82] focus:ring-0"
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                      Password
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          data-testid="input-password"
                          className="bg-transparent border-white/10 text-white placeholder:text-white/20 focus:border-[#0DFF82] focus:ring-0 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          data-testid="button-toggle-password"
                          className="absolute right-3 top-1/2 -translate-y-1/2"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={isLoading}
                data-testid="button-login"
                className="w-full font-bold text-black flex items-center justify-center gap-2 mt-2"
                style={{ background: G, border: "none" }}
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <>Sign in <ArrowRight className="w-4 h-4" /></>
                )}
              </Button>
            </form>
          </Form>
        </div>

        <p className="text-center mt-5 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
          Don't have an account?{" "}
          <Link href="/register" data-testid="link-register" className="font-medium" style={{ color: G }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
