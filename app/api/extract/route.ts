import { NextRequest, NextResponse } from "next/server";
import { ExtractRequestSchema, parseRequestBody } from "@/lib/api-schemas";
import {
  getClientIdentifier,
  rateLimitHeaders,
  retryAfterSeconds,
  trackApiEvent,
} from "@/lib/api-observability";
import { createRateLimit } from "@/lib/rate-limit";
import { checkUrlSyntax, checkUrlWithDns, safeFetch } from "@/lib/url-safety";

// node, not edge: the SSRF guard resolves hostnames before fetching them, and
// DNS is not available on the edge runtime.
export const runtime = "nodejs";

const ratelimit = createRateLimit({
  tokens: 5,
  window: "1 m",
  prefix: "@prompt-generator/extract",
});

const MAX_CONTENT_LENGTH = 3000;
const MAX_FETCH_BYTES = 2_000_000;
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

  // Validate before metering. Rate limiting first meant a malformed body burned
  // a slot out of the user's window for a request that never reached a provider.
  const parsed = await parseRequestBody(request, ExtractRequestSchema);
  if (parsed.error) {
    trackApiEvent({
      route: "extract",
      event: "validation_failed",
      status: parsed.error.status,
      durationMs: Date.now() - startedAt,
    });
    return parsed.error;
  }

  const { url } = parsed.data;

  // Cheap syntax rejection also happens before metering — a blocked URL is a
  // client mistake, not consumption.
  const syntaxCheck = checkUrlSyntax(url);
  if (!syntaxCheck.ok) {
    trackApiEvent({
      route: "extract",
      event: "blocked_url",
      status: 400,
      durationMs: Date.now() - startedAt,
      details: { reason: syntaxCheck.reason, host: safeHostname(url) },
    });
    return NextResponse.json(
      { error: "This URL cannot be extracted for safety reasons." },
      { status: 400 },
    );
  }

  const identifier = getClientIdentifier(request);
  const limit = await ratelimit.check(identifier);

  if (!limit.success) {
    const retryAfter = retryAfterSeconds(limit.reset);
    trackApiEvent({
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

  // The DNS-level check is the one that catches a public name pointing at a
  // private address, so it runs before any outbound request is made.
  const dnsCheck = await checkUrlWithDns(url);
  if (!dnsCheck.ok) {
    trackApiEvent({
      route: "extract",
      event: "blocked_url",
      status: 400,
      durationMs: Date.now() - startedAt,
      details: { reason: dnsCheck.reason, host: safeHostname(url) },
    });
    return NextResponse.json(
      { error: "This URL cannot be extracted for safety reasons." },
      { status: 400 },
    );
  }

  try {
    const result = (await tryJinaReader(url)) ?? (await tryDirectFetch(url));

    if (result) {
      trackApiEvent({
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

    trackApiEvent({
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
    trackApiEvent({
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

/**
 * Jina's reader renders JS-heavy pages we cannot. It fetches from its own
 * infrastructure, so the URL is validated before we hand it over — and that
 * hand-off is disclosed in the privacy policy.
 */
async function tryJinaReader(url: string): Promise<ExtractionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);

  try {
    // Encoded, not interpolated: a target containing "../" would otherwise
    // rewrite the path we are requesting from Jina.
    const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "text",
      },
    });

    if (!response.ok) return null;

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
    // safeFetch re-validates every redirect hop before following it.
    const fetched = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PromptGeneratorBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json",
      },
    });

    if (!fetched.ok) return null;

    const { response, finalUrl } = fetched;
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !ALLOWED_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      return null;
    }

    const html = await readTextWithinLimit(response, MAX_FETCH_BYTES);
    if (!html) return null;

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = sanitizeTitle(titleMatch ? titleMatch[1] : new URL(finalUrl).hostname);
    const textContent = stripHtml(html).slice(0, MAX_CONTENT_LENGTH);
    if (textContent.trim().length < 50) return null;

    return { content: textContent, title, source: "direct" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads at most `maxBytes` and returns what arrived.
 *
 * This used to return null on overflow, throwing away a perfectly good page
 * because its HTML was larger than the cap — and we only ever keep the first
 * few thousand characters anyway. Truncating is the useful behaviour.
 */
async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      text += decoder.decode(value, { stream: true });

      if (receivedBytes >= maxBytes) {
        await reader.cancel().catch(() => undefined);
        return text;
      }
    }
  } catch {
    // Partial content still beats nothing.
    return text || null;
  }

  text += decoder.decode();
  return text;
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
