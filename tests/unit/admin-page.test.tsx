// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminPage from "@/app/admin/page";

const pool = {
  total: 1,
  configured: 1,
  ready: 1,
  coolingDown: 0,
  usable: true,
  providers: [{ name: "groq-a", status: "ready", failures: 0, coolingDownForMs: 0 }],
};

function payload(groqOverrides: Record<string, unknown> = {}) {
  return {
    timestamp: "2026-11-04T10:00:00.000Z",
    providers: {
      openrouter: { configured: true, status: "ok" },
      groq: { configured: true, status: "ok", remainingTokens: null, ...groqOverrides },
      gemini: { configured: true, status: "ok" },
      redis: { configured: true, status: "ok" },
    },
    pools: { generate: pool, clarify: pool, refine: pool },
  };
}

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("AdminPage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows an error screen with Retry when the first load fails, then recovers", async () => {
    fetchMock.mockResolvedValueOnce(res(500, { error: "boom" }));
    render(<AdminPage />);

    expect(await screen.findByText("Could not load the dashboard.")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(res(200, payload()));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Generations Today")).toBeTruthy();
    expect(screen.queryByText("Could not load the dashboard.")).toBeNull();
  });

  it("renders n/a instead of invented Groq numbers", async () => {
    fetchMock.mockResolvedValueOnce(res(200, payload()));
    const { container } = render(<AdminPage />);

    await screen.findByText("Generations Today");
    expect(container.textContent).toContain("n/a");
    expect(container.textContent).not.toContain("100,000");
  });

  it("shows the server message when reset cooldowns fails", async () => {
    const message = "Cleared this instance only: the shared cooldown store was unreachable.";
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/admin/actions" ? res(503, { success: false, message }) : res(200, payload()),
    );
    render(<AdminPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Reset Cooldowns/ }));

    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toContain(message));
  });

  it("keeps data and shows a banner when a refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(res(200, payload()));
    render(<AdminPage />);
    await screen.findByText("Generations Today");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));

    expect(await screen.findByText(/Refresh failed\. Showing data from /)).toBeTruthy();
    expect(screen.getByText("Generations Today")).toBeTruthy();
  });
});
