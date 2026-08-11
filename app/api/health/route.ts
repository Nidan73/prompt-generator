import { NextResponse } from "next/server";
import {
  CLARIFY_POOL,
  GENERATE_POOL,
  REFINE_POOL,
  getPoolRuntimeStatus,
} from "@/lib/provider-pool";
import { isRateLimitStoreConfigured } from "@/lib/rate-limit";

export const runtime = "nodejs";

export function GET() {
  const upstashConfigured = isRateLimitStoreConfigured();
  const pools = {
    generate: getPoolRuntimeStatus("generate", GENERATE_POOL),
    clarify: getPoolRuntimeStatus("clarify", CLARIFY_POOL),
    refine: getPoolRuntimeStatus("refine", REFINE_POOL),
  };
  // `usable` counts request-time OpenRouter discovery, which the static pools do
  // not list — an OpenRouter-only deployment generates fine and must not be
  // reported as degraded.
  const ready = upstashConfigured && pools.generate.usable;

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      runtime: "nodejs",
      checks: {
        rateLimitStore: upstashConfigured ? "ok" : "missing",
        generation: poolStatus(pools.generate),
        guidedMode: poolStatus(pools.clarify),
        refinement: poolStatus(pools.refine),
      },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function poolStatus(pool: ReturnType<typeof getPoolRuntimeStatus>) {
  if (pool.ready > 0) return "ok";
  // Every static provider cooling down is still serviceable via discovery.
  return pool.usable ? "degraded" : "unavailable";
}
