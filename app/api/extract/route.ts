import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ExtractRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import {
  getClientIdentifier,
  logApiEvent,
  rateLimitHeaders,
  retryAfterSeconds,
} from "@/lib/api-observability";

export const runtime = "edge";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: true,
  prefix: "@prompt-generator/extract",
});

const MAX_CONTENT_LENGTH = 3000;
const MAX_FETCH_BYTES = 500_000;
const URL_TIMEOUT_MS = 4000;
const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "text/markdown",
  "application/xhtml+xml",
  "application/json",
];

type ExtractionResult = { content: string; title: string; source: "jina" | "direct" } | null;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.limit(identifier);

  if (!limit.success) {
    const retryAfter = retryAfterSeconds(limit.reset);
    logApiEvent({
      route: "extract",
      event: "rate_limited",
      status: 429,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limit),
          "Retry-After": String(retryAfter),
        },
      },
    );
  }

  const parsed = await parseRequestBody(request, ExtractRequestSchema);
  if (parsed.error) {
    logApiEvent({
      route: "extract",
      event: "validation_failed",
      status: parsed.error.status,
      durationMs: Date.now() - startedAt,
    });
    return parsed.error;
  }

  const { url } = parsed.data;
  const blockedReason = getBlockedUrlReason(url);

  if (blockedReason) {
    logApiEvent({
      route: "extract",
      event: "blocked_url",
      status: 400,
      durationMs: Date.now() - startedAt,
      details: { reason: blockedReason, host: safeHostname(url) },
    });
    return NextResponse.json(
      { error: "This URL cannot be extracted for safety reasons." },
      { status: 400 },
    );
  }

  try {
    const result = (await tryJinaReader(url)) ?? (await tryDirectFetch(url));

    if (result) {
      logApiEvent({
        route: "extract",
        event: "succeeded",
        status: 200,
        durationMs: Date.now() - startedAt,
        inputChars: result.content.length,
        details: { source: result.source, host: safeHostname(url) },
      });

      return NextResponse.json(
        { content: result.content, title: result.title },
        { headers: rateLimitHeaders(limit) },
      );
    }

    logApiEvent({
      route: "extract",
      event: "no_content",
      status: 422,
      durationMs: Date.now() - startedAt,
      details: { host: safeHostname(url) },
    });
    return NextResponse.json(
      { error: "Could not extract meaningful text from this URL." },
      { status: 422 },
    );
  } catch (error) {
    logApiEvent({
      route: "extract",
      event: "failed",
      status: 500,
      durationMs: Date.now() - startedAt,
      details: { host: safeHostname(url) },
    });
    console.error("URL extraction failed", error);
    return NextResponse.json(
      { error: "Unable to fetch this URL. It may be blocking requests or taking too long." },
      { status: 500 },
    );
  }
}

async function tryJinaReader(url: string): Promise<ExtractionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "text",
      },
    });

    if (!response.ok || !isResponseSmallEnough(response)) return null;

    const text = await readTextWithinLimit(response, MAX_FETCH_BYTES);
    if (!text || text.trim().length < 50) return null;

    const titleMatch = text.match(/^#\s+(.+)$/m);
    const title = sanitizeTitle(titleMatch ? titleMatch[1] : new URL(url).hostname);
    const content = text.trim().slice(0, MAX_CONTENT_LENGTH);

    return { content, title, source: "jina" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryDirectFetch(url: string): Promise<ExtractionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PromptGeneratorBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json",
      },
    });

    if (!response.ok || !isResponseSmallEnough(response)) return null;
    if (getBlockedUrlReason(response.url)) return null;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !ALLOWED_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      return null;
    }

    const html = await readTextWithinLimit(response, MAX_FETCH_BYTES);
    if (!html) return null;

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = sanitizeTitle(titleMatch ? titleMatch[1] : new URL(response.url || url).hostname);
    const textContent = stripHtml(html).slice(0, MAX_CONTENT_LENGTH);
    if (!textContent.trim() || textContent.trim().length < 50) return null;

    return { content: textContent, title, source: "direct" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isResponseSmallEnough(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  return !contentLength || contentLength <= MAX_FETCH_BYTES;
}

async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      return null;
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function getBlockedUrlReason(rawUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return "invalid_url";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return "unsupported_protocol";

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home")
  ) {
    return "private_host";
  }

  if (
    host === "::1" ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("169.254.") ||
    host.startsWith("192.168.") ||
    isPrivate172(host) ||
    isPrivateIpv6(host)
  ) {
    return "private_ip";
  }

  return null;
}

function isPrivate172(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts[0] !== "172") return false;

  const second = Number(parts[1]);
  return Number.isInteger(second) && second >= 16 && second <= 31;
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(":")) return false;

  return (
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  );
}

function safeHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "invalid";
  }
}

function sanitizeTitle(title: string): string {
  return stripHtml(title).replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled page";
}

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
