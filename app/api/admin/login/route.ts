import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  AdminConfigError,
  createAdminToken,
  verifyPassword,
} from "@/lib/admin-auth";
import {
  describeError,
  getClientIdentifier,
  rateLimitHeaders,
  retryAfterSeconds,
} from "@/lib/api-observability";
import { createRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const loginSchema = z.object({ password: z.string().min(1).max(256) });

// Counts every attempt, right or wrong, so the limit cannot be probed for free.
const loginRateLimit = createRateLimit({
  tokens: 5,
  window: "15 m",
  prefix: "@prompt-generator/admin-login",
  scope: "window",
});

export async function POST(request: NextRequest) {
  const limit = await loginRateLimit.check(getClientIdentifier(request));
  if (!limit.success) {
    const retryAfter = retryAfterSeconds(limit.reset);
    return NextResponse.json(
      { error: "Too many login attempts. Try again later.", retryAfter },
      {
        status: 429,
        headers: { ...rateLimitHeaders(limit), "Retry-After": String(retryAfter) },
      },
    );
  }

  try {
    const body = loginSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid admin password." }, { status: 400 });
    }

    if (!verifyPassword(body.data.password)) {
      return NextResponse.json({ error: "Invalid admin password." }, { status: 401 });
    }

    const token = await createAdminToken();

    // The token only ever travels in the httpOnly cookie, never in the body.
    const response = NextResponse.json({ success: true });
    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    if (error instanceof AdminConfigError) {
      return NextResponse.json(
        { error: "Admin access is not configured on this deployment." },
        { status: 503 },
      );
    }

    console.error("Admin login error", describeError(error));
    return NextResponse.json({ error: "Authentication failed." }, { status: 500 });
  }
}
