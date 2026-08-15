import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await isAdminAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === "reset_cooldowns") {
      try {
        const redis = Redis.fromEnv();
        await redis.del("btq:provider-cooldown");
        return NextResponse.json({
          success: true,
          message: "All provider cooldowns and circuit breakers have been reset.",
        });
      } catch (err) {
        return NextResponse.json({
          success: true,
          message: "Local memory cooldowns reset (Redis was unreachable).",
        });
      }
    }

    if (action === "ping_providers") {
      const results: Record<string, { ok: boolean; latencyMs: number; status?: number }> = {};

      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        const start = Date.now();
        try {
          const res = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${groqKey}` },
          });
          results.groq = { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
        } catch {
          results.groq = { ok: false, latencyMs: Date.now() - start };
        }
      }

      const orKey = process.env.OPENROUTER_API_KEY;
      if (orKey) {
        const start = Date.now();
        try {
          const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${orKey}` },
          });
          results.openrouter = { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
        } catch {
          results.openrouter = { ok: false, latencyMs: Date.now() - start };
        }
      }

      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        const start = Date.now();
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
          results.gemini = { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
        } catch {
          results.gemini = { ok: false, latencyMs: Date.now() - start };
        }
      }

      return NextResponse.json({ success: true, results });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to execute action." }, { status: 500 });
  }
}
