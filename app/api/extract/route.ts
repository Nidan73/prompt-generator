import { NextRequest, NextResponse } from "next/server";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ExtractRequestSchema, parseRequestBody } from "@/lib/api-schemas";

export const runtime = "edge";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix: "@prompt-generator/extract",
});

const MAX_CONTENT_LENGTH = 3000;

export async function POST(request: NextRequest) {
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit.limit),
          "X-RateLimit-Remaining": String(limit.remaining),
          "X-RateLimit-Reset": String(limit.reset),
        },
      },
    );
  }

  const parsed = await parseRequestBody(request, ExtractRequestSchema);
  if (parsed.error) return parsed.error;

  const { url } = parsed.data;

  try {
    // Strategy 1: Jina Reader (handles SPAs, JS-heavy sites, returns clean markdown)
    const jinaResult = await tryJinaReader(url);
    if (jinaResult) {
      return NextResponse.json(
        { content: jinaResult.content, title: jinaResult.title },
        {
          headers: {
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": String(limit.remaining),
            "X-RateLimit-Reset": String(limit.reset),
          },
        },
      );
    }

    // Strategy 2: Direct fetch + HTML strip (fallback for simple pages)
    const directResult = await tryDirectFetch(url);
    if (directResult) {
      return NextResponse.json(
        { content: directResult.content, title: directResult.title },
        {
          headers: {
            "X-RateLimit-Limit": String(limit.limit),
            "X-RateLimit-Remaining": String(limit.remaining),
            "X-RateLimit-Reset": String(limit.reset),
          },
        },
      );
    }

    return NextResponse.json(
      { error: "Could not extract meaningful text from this URL." },
      { status: 422 },
    );
  } catch (error) {
    console.error("URL extraction failed", error);
    return NextResponse.json(
      { error: "Unable to fetch this URL. It may be blocking requests or taking too long." },
      { status: 500 },
    );
  }
}

// ─── Extraction Strategies ─────────────────────────────────────────────────────

type ExtractionResult = { content: string; title: string } | null;

/**
 * Jina Reader: executes JavaScript, handles SPAs, returns clean markdown.
 * Free tier, no API key required. 3s timeout.
 */
async function tryJinaReader(url: string): Promise<ExtractionResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "text",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.trim().length < 50) return null;

    // Jina returns markdown — extract a title from the first heading if present
    const titleMatch = text.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

    // Trim to max length
    const content = text.trim().slice(0, MAX_CONTENT_LENGTH);

    return { content, title };
  } catch {
    return null;
  }
}

/**
 * Direct fetch + HTML strip: fast fallback for simple static pages.
 * 3s timeout, basic HTML stripping.
 */
async function tryDirectFetch(url: string): Promise<ExtractionResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PromptGeneratorBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

    const textContent = stripHtml(html).slice(0, MAX_CONTENT_LENGTH);
    if (!textContent.trim() || textContent.trim().length < 50) return null;

    return { content: textContent, title };
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getClientIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip");
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  return forwardedFor || realIp || cloudflareIp || "anonymous";
}

/**
 * Strip HTML tags and normalize whitespace to extract readable text.
 * Removes script/style blocks entirely, then strips remaining tags.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
