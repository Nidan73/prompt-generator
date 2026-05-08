import { NextResponse } from "next/server";
import {
  CLARIFY_POOL,
  GENERATE_POOL,
  REFINE_POOL,
  getPoolRuntimeStatus,
} from "@/lib/provider-pool";

export const runtime = "edge";

export function GET() {
  const upstashConfigured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
  const pools = {
    generate: getPoolRuntimeStatus("generate", GENERATE_POOL),
    clarify: getPoolRuntimeStatus("clarify", CLARIFY_POOL),
    refine: getPoolRuntimeStatus("refine", REFINE_POOL),
  };
  const hasGenerationProvider = pools.generate.configured > 0;
  const ready = upstashConfigured && hasGenerationProvider;

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      runtime: "edge",
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
  return pool.ready > 0 ? "ok" : "degraded";
}
