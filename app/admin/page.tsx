"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Database,
  Lock,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";

type UsageData = {
  timestamp: string;
  providers: {
    openrouter: {
      configured: boolean;
      status: string;
      label?: string;
      usageUsd?: number;
      creditsRemainingUsd?: number | null;
      totalCreditsUsd?: number | null;
      rateLimit?: { requests: number; interval: string };
      error?: string;
    };
    groq: {
      configured: boolean;
      status: string;
      latencyMs?: number;
      remainingTokens?: number | null;
      limitTokens?: number;
      resetTokens?: string;
      remainingRequests?: number | null;
      limitRequests?: number;
      resetRequests?: string;
      error?: string;
    };
    gemini: {
      configured: boolean;
      status: string;
      latencyMs?: number;
      dailyQuotaLimit?: number;
      error?: string;
    };
    redis: {
      configured: boolean;
      status: string;
      today?: string;
      metrics?: {
        totalRequests: number;
        totalSuccess: number;
        totalError: number;
        inputChars: number;
        fallbacks: number;
      };
    };
  };
  pools: {
    generate: PoolStatus;
    clarify: PoolStatus;
    refine: PoolStatus;
  };
};

type PoolStatus = {
  total: number;
  configured: number;
  ready: number;
  coolingDown: number;
  usable: boolean;
  providers: Array<{
    name: string;
    status: "ready" | "cooling_down";
    failures: number;
    coolingDownForMs: number;
    lastLatencyMs?: number;
  }>;
};

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UsageData | null>(null);
  const [autoRefreshSecs, setAutoRefreshSecs] = useState<number>(30);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [pingResults, setPingResults] = useState<Record<string, { ok: boolean; latencyMs: number }> | null>(null);

  const fetchUsageData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/usage");
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch data");
      const json = await res.json();
      setData(json);
      setAuthenticated(true);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsageData();
  }, [fetchUsageData]);

  // Auto refresh timer
  useEffect(() => {
    if (!authenticated || autoRefreshSecs <= 0) return;
    const interval = setInterval(() => {
      fetchUsageData();
    }, autoRefreshSecs * 1000);
    return () => clearInterval(interval);
  }, [authenticated, autoRefreshSecs, fetchUsageData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const err = await res.json();
        setLoginError(err.error || "Login failed");
        return;
      }

      setAuthenticated(true);
      setPassword("");
      await fetchUsageData();
    } catch {
      setLoginError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setData(null);
  };

  const handleResetCooldowns = async () => {
    setActionStatus("Resetting cooldowns...");
    try {
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_cooldowns" }),
      });
      const json = await res.json();
      setActionStatus(json.message || "Reset complete.");
      await fetchUsageData();
    } catch {
      setActionStatus("Failed to reset cooldowns.");
    }
    setTimeout(() => setActionStatus(""), 4000);
  };

  const handlePingProviders = async () => {
    setActionStatus("Pinging providers...");
    try {
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping_providers" }),
      });
      const json = await res.json();
      setPingResults(json.results);
      setActionStatus("Ping completed.");
    } catch {
      setActionStatus("Failed to ping providers.");
    }
    setTimeout(() => setActionStatus(""), 4000);
  };

  // ─── Loading Screen ──────────────────────────────────────────────────────────
  if (authenticated === null) {
    return (
      <div className="min-h-screen bg-[#0d0e14] text-white flex items-center justify-center">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span className="text-sm text-zinc-400 font-medium">Loading Bhai Thik Kor Mission Control...</span>
        </div>
      </div>
    );
  }

  // ─── Login Gate ──────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#090a0f] text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#13151f] border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col items-center text-center mb-8">
            <span className="text-4xl mb-3">🍉</span>
            <h1 className="text-2xl font-bold tracking-tight">Bhai Thik Kor Admin</h1>
            <p className="text-sm text-zinc-400 mt-1">Live Token Usage & Provider Mission Control</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Admin Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password..."
                  required
                  className="w-full bg-[#1c1f2e] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
                <Lock className="w-4 h-4 text-zinc-500 absolute right-4 top-3.5" />
              </div>
            </div>

            {loginError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.99] flex items-center justify-center gap-2 text-sm"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Authenticate to Admin Panel"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const { providers, pools } = data || {};
  const metrics = providers?.redis?.metrics;

  const groqPercent =
    providers?.groq?.limitTokens && providers?.groq?.remainingTokens !== null && providers?.groq?.remainingTokens !== undefined
      ? Math.round((providers.groq.remainingTokens / providers.groq.limitTokens) * 100)
      : 100;

  return (
    <div className="min-h-screen bg-[#090a0f] text-zinc-100 p-6 md:p-10 font-sans selection:bg-emerald-500/30">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* ── Header ── */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🍉</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Bhai Thik Kor Admin</h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Observability
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">Real-time token counters, provider quotas, and circuit breakers</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto Refresh Selector */}
            <div className="flex items-center bg-[#13151f] border border-white/10 rounded-lg p-1 text-xs text-zinc-300">
              <span className="px-2 text-zinc-500 font-medium">Refresh:</span>
              <button
                onClick={() => setAutoRefreshSecs(10)}
                className={`px-2 py-1 rounded transition-colors ${autoRefreshSecs === 10 ? "bg-emerald-500/20 text-emerald-400 font-semibold" : "hover:text-white"}`}
              >
                10s
              </button>
              <button
                onClick={() => setAutoRefreshSecs(30)}
                className={`px-2 py-1 rounded transition-colors ${autoRefreshSecs === 30 ? "bg-emerald-500/20 text-emerald-400 font-semibold" : "hover:text-white"}`}
              >
                30s
              </button>
              <button
                onClick={() => setAutoRefreshSecs(0)}
                className={`px-2 py-1 rounded transition-colors ${autoRefreshSecs === 0 ? "bg-emerald-500/20 text-emerald-400 font-semibold" : "hover:text-white"}`}
              >
                Off
              </button>
            </div>

            <button
              onClick={fetchUsageData}
              disabled={loading}
              className="p-2 bg-[#13151f] hover:bg-[#1a1d2b] border border-white/10 rounded-lg text-zinc-300 hover:text-white transition-all"
              title="Refresh metrics"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-400" : ""}`} />
            </button>

            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-[#13151f] hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/30 text-zinc-300 hover:text-rose-400 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </header>

        {/* ── Status Toast ── */}
        {actionStatus && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionStatus}</span>
          </div>
        )}

        {/* ── Top Metric Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Requests Today */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between text-zinc-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Generations Today</span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {metrics?.totalRequests.toLocaleString() ?? "0"}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1.5">
              <span className="text-emerald-400 font-semibold">{metrics?.totalSuccess ?? 0} successful</span>
              <span>·</span>
              <span className="text-rose-400 font-semibold">{metrics?.totalError ?? 0} errors</span>
            </div>
          </div>

          {/* OpenRouter Balance */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between text-zinc-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">OpenRouter Balance</span>
              <Coins className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {providers?.openrouter?.creditsRemainingUsd !== null && providers?.openrouter?.creditsRemainingUsd !== undefined
                ? `$${providers.openrouter.creditsRemainingUsd.toFixed(2)}`
                : "Active"}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              Total Spent: ${providers?.openrouter?.usageUsd?.toFixed(4) ?? "0.0000"}
            </div>
          </div>

          {/* Groq Token Quota */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between text-zinc-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Groq Token Quota</span>
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {groqPercent}% <span className="text-sm font-normal text-zinc-400">capacity</span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              Reset in: {providers?.groq?.resetTokens ?? "0s"}
            </div>
          </div>

          {/* System Health */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-5 relative overflow-hidden">
            <div className="flex items-center justify-between text-zinc-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Providers</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {pools?.generate?.ready ?? 0} / {pools?.generate?.configured ?? 0}
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">
              {pools?.generate?.coolingDown ?? 0} cooling down
            </div>
          </div>
        </div>

        {/* ── Provider Cards Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Groq Provider Card */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Cpu className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">Groq Cloud (Fast Tier)</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  providers?.groq?.configured ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {providers?.groq?.status || "Not configured"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">Primary low-latency generator (~800 tok/s). 100k Tokens Per Day tier.</p>

            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                  <span>Daily Remaining Tokens</span>
                  <span className="text-white font-medium">
                    {providers?.groq?.remainingTokens?.toLocaleString() ?? "100,000"} / {providers?.groq?.limitTokens?.toLocaleString() ?? "100,000"}
                  </span>
                </div>
                <div className="w-full h-2 bg-[#1c1f2e] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${groqPercent}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5">
                  <span className="text-zinc-500 block">Remaining RPM</span>
                  <span className="text-white font-semibold">{providers?.groq?.remainingRequests ?? 30} req/min</span>
                </div>
                <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5">
                  <span className="text-zinc-500 block">Token Reset</span>
                  <span className="text-white font-semibold">{providers?.groq?.resetTokens ?? "Instant"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* OpenRouter Provider Card */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Server className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-white text-base">OpenRouter AI</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  providers?.openrouter?.configured ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {providers?.openrouter?.status || "Not configured"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">Dynamic model discovery & fallback pool for high-concurrency surge.</p>

            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5">
                  <span className="text-zinc-500 block">Credit Balance</span>
                  <span className="text-emerald-400 font-bold text-sm">
                    {providers?.openrouter?.creditsRemainingUsd !== null && providers?.openrouter?.creditsRemainingUsd !== undefined
                      ? `$${providers.openrouter.creditsRemainingUsd.toFixed(2)}`
                      : "Pay As You Go"}
                  </span>
                </div>
                <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5">
                  <span className="text-zinc-500 block">Total Lifetime Spend</span>
                  <span className="text-white font-semibold">${providers?.openrouter?.usageUsd?.toFixed(4) ?? "0.0000"}</span>
                </div>
              </div>

              <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5 text-xs flex justify-between items-center">
                <span className="text-zinc-500">Rate Limit Interval</span>
                <span className="text-zinc-300 font-medium">
                  {providers?.openrouter?.rateLimit?.requests ?? 50} req / {providers?.openrouter?.rateLimit?.interval ?? "10s"}
                </span>
              </div>
            </div>
          </div>

          {/* Google Gemini Card */}
          <div className="bg-[#13151f] border border-white/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Cpu className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">Google Gemini</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  providers?.gemini?.configured ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {providers?.gemini?.status || "Not configured"}
              </span>
            </div>

            <p className="text-xs text-zinc-400">High-quota backup & complex prompt instruction follower (1500 RPD).</p>

            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5">
                  <span className="text-zinc-500 block">Daily Quota</span>
                  <span className="text-white font-semibold">1,500 RPD / model</span>
                </div>
                <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5">
                  <span className="text-zinc-500 block">Rate Limit</span>
                  <span className="text-white font-semibold">15 RPM</span>
                </div>
              </div>

              <div className="bg-[#181a27] p-2.5 rounded-lg border border-white/5 text-xs flex justify-between items-center">
                <span className="text-zinc-500">Probe Latency</span>
                <span className="text-emerald-400 font-semibold">{providers?.gemini?.latencyMs ?? "~350"} ms</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Circuit Breaker & Pool Health Table ── */}
        <div className="bg-[#13151f] border border-white/10 rounded-xl overflow-hidden">
          <div className="p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-white text-lg">Provider Pools & Circuit Breakers</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Live status of models in round-robin failover rotation</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handlePingProviders}
                className="px-3 py-1.5 bg-[#1c1f2e] hover:bg-[#25293d] border border-white/10 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                Ping All Providers
              </button>

              <button
                onClick={handleResetCooldowns}
                className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Reset Cooldowns
              </button>
            </div>
          </div>

          {/* Live Ping Results */}
          {pingResults && (
            <div className="px-6 py-3 bg-[#181a27] border-b border-white/5 flex flex-wrap gap-4 text-xs">
              <span className="text-zinc-400 font-medium">Live Latency:</span>
              {Object.entries(pingResults).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1 text-zinc-200">
                  <span className={`w-1.5 h-1.5 rounded-full ${v.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
                  <span className="capitalize font-semibold">{k}:</span> {v.latencyMs}ms
                </span>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#181a27] text-zinc-400 font-semibold border-b border-white/5">
                <tr>
                  <th className="py-3 px-6">Pool</th>
                  <th className="py-3 px-6">Model Provider</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6">Consecutive Failures</th>
                  <th className="py-3 px-6">Last Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {pools?.generate?.providers?.map((p) => (
                  <tr key={`gen-${p.name}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-6 font-semibold text-emerald-400">Generate (Normal)</td>
                    <td className="py-3 px-6 font-medium text-white">{p.name}</td>
                    <td className="py-3 px-6">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === "ready"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${p.status === "ready" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
                        {p.status === "ready" ? "Ready" : `Cooling Down (${Math.round(p.coolingDownForMs / 1000)}s)`}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-zinc-400">{p.failures}</td>
                    <td className="py-3 px-6 text-zinc-400">{p.lastLatencyMs ? `${p.lastLatencyMs} ms` : "—"}</td>
                  </tr>
                ))}

                {pools?.clarify?.providers?.map((p) => (
                  <tr key={`clarify-${p.name}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-6 font-semibold text-sky-400">Clarify (Guided)</td>
                    <td className="py-3 px-6 font-medium text-white">{p.name}</td>
                    <td className="py-3 px-6">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === "ready"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${p.status === "ready" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
                        {p.status === "ready" ? "Ready" : `Cooling Down (${Math.round(p.coolingDownForMs / 1000)}s)`}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-zinc-400">{p.failures}</td>
                    <td className="py-3 px-6 text-zinc-400">{p.lastLatencyMs ? `${p.lastLatencyMs} ms` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer ── */}
        <footer className="text-center text-xs text-zinc-600 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Bhai Thik Kor · Admin Infrastructure Control</span>
          <span>Last sync: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "—"}</span>
        </footer>
      </div>
    </div>
  );
}
