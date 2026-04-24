import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { queryClient } from "@/lib/queryClient";

const G = "#0DFF82";

export default function Demo() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const section = params.get("section") ?? "";
    (async () => {
      try {
        const res = await fetch("/api/demo/access", { credentials: "include" });
        if (!res.ok) throw new Error("Demo setup failed");
        const data = await res.json();
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        const hash = section ? `#${section}` : "";
        if (section === "activity") {
          setLocation("/dashboard/activity");
        } else if (section === "monitoring") {
          setLocation("/dashboard/monitoring");
        } else {
          setLocation(`/dashboard/projects/${data.projectId}${hash}`);
        }
      } catch (e: any) {
        setError(e.message || "Something went wrong");
        setStatus("error");
      }
    })();
  }, [setLocation, search]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: "#000" }}>
      {status === "loading" ? (
        <div className="flex flex-col items-center gap-6">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full animate-bounce"
                style={{ background: G, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <div className="text-sm font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
            Loading demo environment...
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm font-mono" style={{ color: "#FF2947" }}>{error}</div>
          <button
            onClick={() => setLocation("/login")}
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ background: G, color: "#000" }}
          >
            Go to Login
          </button>
        </div>
      )}
    </div>
  );
}
