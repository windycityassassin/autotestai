// Static demo mode: backend is offline, mock the few endpoints the
// landing page actually hits so the UI renders cleanly. All other
// /api calls return 401 (auth) or 503 (offline) so the React components
// fail to a safe state without throwing.

type Handler = () => unknown;

const MOCK_RESPONSES: Record<string, Handler> = {
  "/api/waitlist/count": () => ({ count: 247 }),
  "/api/waitlist": () => ({ ok: true, message: "Thanks. This demo doesn't persist signups." }),
  "/api/auth/me": () => null,
};

function makeJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function installDemoMode(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    for (const [path, handler] of Object.entries(MOCK_RESPONSES)) {
      if (url.includes(path)) {
        return makeJson(handler());
      }
    }

    if (url.includes("/api/")) {
      return makeJson(
        { error: "Demo mode: backend is offline. View source on GitHub." },
        503,
      );
    }

    return originalFetch(input, init);
  };

  console.log(
    "%c[autotestai] Demo mode active. Backend is offline. UI is fully interactive but no data persists.",
    "color:#0DFF82;font-weight:bold;",
  );
}
