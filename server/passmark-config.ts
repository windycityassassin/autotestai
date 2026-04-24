import { configure } from "passmark";

export function initPassmark(): void {
  if (!process.env.ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  }

  const hasGemini = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const hasRedis = !!process.env.REDIS_URL;

  if (!hasRedis) {
    console.log("[passmark] REDIS_URL not set — step caching disabled, all steps will use AI execution.");
  }

  if (!hasGemini) {
    console.log("[passmark] GOOGLE_GENERATIVE_AI_API_KEY not set — falling back to Claude-only assertion mode.");
    configure({
      ai: {
        gateway: "none",
        models: {
          stepExecution: "anthropic/claude-haiku-4-5",
          userFlowLow: "anthropic/claude-haiku-4-5",
          userFlowHigh: "anthropic/claude-sonnet-4-5",
          assertionPrimary: "anthropic/claude-haiku-4-5",
          assertionSecondary: "anthropic/claude-haiku-4-5",
          assertionArbiter: "anthropic/claude-sonnet-4-5",
          utility: "anthropic/claude-haiku-4-5",
        },
      },
    });
  } else {
    console.log("[passmark] Configured with Claude (primary) + Gemini (secondary) multi-model assertions.");
    configure({
      ai: {
        gateway: "none",
        models: {
          stepExecution: "anthropic/claude-haiku-4-5",
          userFlowLow: "anthropic/claude-haiku-4-5",
          userFlowHigh: "anthropic/claude-sonnet-4-5",
          assertionPrimary: "anthropic/claude-haiku-4-5",
          assertionSecondary: "google/gemini-2.5-flash",
          assertionArbiter: "google/gemini-2.5-flash",
          utility: "google/gemini-2.5-flash",
        },
      },
    });
  }

  console.log(`[passmark] Initialized. Redis caching: ${hasRedis ? "enabled" : "disabled"}. Multi-model assertions: ${hasGemini ? "enabled (Claude + Gemini)" : "disabled (Claude-only fallback)"}.`);
}

export function hasGeminiKey(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

export function hasRedisUrl(): boolean {
  return !!process.env.REDIS_URL;
}

export type PassmarkPhaseInfo = {
  cacheHits: number;
  cacheMisses: number;
  autoHealTriggered: boolean;
  redisDisabled: boolean;
};

export function parsePassmarkPhases(output: string): PassmarkPhaseInfo {
  const cacheHits = (output.match(/Executing Cached Step:/g) || []).length;
  const cacheMisses = (output.match(/Executing Step:/g) || []).length;
  const autoHealTriggered = /Error executing cached step, falling back to AI execution/.test(output);
  const redisDisabled = /Redis not configured/.test(output) || /Step caching is disabled/.test(output);

  return { cacheHits, cacheMisses, autoHealTriggered, redisDisabled };
}
