"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import { toast } from "@/lib/store/toast-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { Activity, Coins, Cpu, Gauge, RefreshCw, Save } from "lucide-react";

// ---- Types matching GET /admin/api/usage ----
interface UsageModel {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  priced: boolean;
}
interface UsageSeries {
  bucket: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
}
interface UsageData {
  range: { from: string; to: string; bucket: string };
  totals: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    avg_latency_ms: number;
    cost_usd: number | null;
  };
  by_model: UsageModel[];
  by_purpose: { purpose: string; requests: number; total_tokens: number }[];
  series: UsageSeries[];
  pricing: Record<string, { input_per_1m: number; output_per_1m: number }>;
  currency: string;
}

const RANGES = [
  { key: "7", label: "7 ngày" },
  { key: "30", label: "30 ngày" },
  { key: "90", label: "90 ngày" },
];

function fmtInt(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
}
function fmtTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n || 0);
}
function fmtCost(n: number | null) {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}
const PALETTE = ["#0144DB", "#7c3aed", "#059669", "#d97706", "#db2777", "#0891b2", "#65a30d"];

// ---- Stacked bar chart (prompt vs completion tokens, or requests) over time ----
function TimeSeriesChart({ series, metric }: { series: UsageSeries[]; metric: "requests" | "tokens" }) {
  if (!series.length) {
    return <div className="flex items-center justify-center h-48 text-sm text-zinc-400">Chưa có dữ liệu trong khoảng này</div>;
  }
  const W = 720, H = 200, padL = 44, padB = 28, padT = 10, padR = 10;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = series.map((s) => (metric === "requests" ? s.requests : s.prompt_tokens + s.completion_tokens));
  const max = Math.max(1, ...vals);
  const n = series.length;
  const slot = innerW / n;
  const barW = Math.min(40, slot * 0.62);
  const yTicks = 4;
  const labelEvery = Math.ceil(n / 12);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {/* y grid + labels */}
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const y = padT + (innerH * i) / yTicks;
        const v = max * (1 - i / yTicks);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              {metric === "tokens" ? fmtTokens(v) : fmtInt(v)}
            </text>
          </g>
        );
      })}
      {series.map((s, i) => {
        const x = padL + slot * i + (slot - barW) / 2;
        if (metric === "requests") {
          const h = (s.requests / max) * innerH;
          return <rect key={i} x={x} y={padT + innerH - h} width={barW} height={h} rx={3} fill="#0144DB" />;
        }
        const total = s.prompt_tokens + s.completion_tokens;
        const hP = (s.prompt_tokens / max) * innerH;
        const hC = (s.completion_tokens / max) * innerH;
        const top = padT + innerH - (total / max) * innerH;
        return (
          <g key={i}>
            <rect x={x} y={top} width={barW} height={hP} fill="#0144DB" rx={3} />
            <rect x={x} y={top + hP} width={barW} height={hC} fill="#93c5fd" rx={3} />
          </g>
        );
      })}
      {series.map((s, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={padL + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#64748b">
            {s.bucket.length > 10 ? s.bucket.slice(5).replace("T", " ") : s.bucket.slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

export default function UsagePage() {
  const { selectedId } = useAgentConnectStore();
  const [days, setDays] = React.useState("30");
  const [metric, setMetric] = React.useState<"requests" | "tokens">("requests");
  const [data, setData] = React.useState<UsageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [priceDraft, setPriceDraft] = React.useState<Record<string, { input: string; output: string }>>({});
  const [savingPrice, setSavingPrice] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - Number(days) * 86400000);
      const bucket = Number(days) <= 7 ? "day" : "day";
      const qs = `from=${encodeURIComponent(from.toISOString().replace(/\.\d+Z$/, "Z"))}&to=${encodeURIComponent(
        to.toISOString().replace(/\.\d+Z$/, "Z")
      )}&bucket=${bucket}`;
      const res = (await apiFetch(`/api/agent-admin/usage?${qs}`)) as UsageData;
      setData(res);
      // seed price draft from current pricing
      const draft: Record<string, { input: string; output: string }> = {};
      for (const m of res.by_model) {
        const p = res.pricing?.[m.model];
        draft[m.model] = { input: p ? String(p.input_per_1m) : "", output: p ? String(p.output_per_1m) : "" };
      }
      setPriceDraft(draft);
    } catch (err) {
      console.error(err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [selectedId, days]);

  React.useEffect(() => {
    if (selectedId) load();
    else {
      setData(null);
      setLoading(false);
    }
  }, [selectedId, load]);

  const savePricing = async () => {
    if (!data) return;
    setSavingPrice(true);
    try {
      const merged: Record<string, { input_per_1m: number; output_per_1m: number }> = { ...data.pricing };
      for (const [model, d] of Object.entries(priceDraft)) {
        const inp = parseFloat(d.input), out = parseFloat(d.output);
        if (Number.isFinite(inp) || Number.isFinite(out)) {
          merged[model] = { input_per_1m: Number.isFinite(inp) ? inp : 0, output_per_1m: Number.isFinite(out) ? out : 0 };
        }
      }
      await apiFetch(`/api/agent-admin/settings`, {
        method: "PATCH",
        body: JSON.stringify({ values: { model_pricing: merged } }),
      });
      toast.success("Đã lưu đơn giá model");
      load();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      toast.error(status === 403 ? "Cần quyền superadmin để đặt giá" : "Lưu đơn giá thất bại");
    } finally {
      setSavingPrice(false);
    }
  };

  const t = data?.totals;
  const maxModelReq = Math.max(1, ...(data?.by_model.map((m) => m.requests) || [1]));

  return (
    <PageShell>
      <PageHeader
        title="LLM Usage"
        subtitle="Lượng request, model, token và chi phí của agent"
        actions={<AgentConnectSelect />}
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">Chọn Agent Connect để xem dữ liệu.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setDays(r.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                    days === r.key ? "bg-white text-[#0144DB] shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
          </div>

          {error ? (
            <ErrorState errorType={getAgentErrorType(error)} onRetry={load} />
          ) : loading ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-28 bg-zinc-200 rounded-2xl" />
              ))}
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={<Activity className="w-5 h-5" />} color="text-[#0144DB] bg-[--color-primary-soft]" label="Tổng requests" value={fmtInt(t?.requests || 0)} />
                <KpiCard icon={<Cpu className="w-5 h-5" />} color="text-purple-600 bg-purple-50" label="Tổng token" value={fmtTokens(t?.total_tokens || 0)} sub={`vào ${fmtTokens(t?.prompt_tokens || 0)} · ra ${fmtTokens(t?.completion_tokens || 0)}`} />
                <KpiCard icon={<Gauge className="w-5 h-5" />} color="text-emerald-600 bg-emerald-50" label="Latency TB" value={`${fmtInt(t?.avg_latency_ms || 0)} ms`} />
                <KpiCard icon={<Coins className="w-5 h-5" />} color="text-amber-600 bg-amber-50" label={`Chi phí (${data?.currency})`} value={fmtCost(t?.cost_usd ?? null)} sub={t?.cost_usd === null ? "chưa định giá" : undefined} />
              </div>

              {/* Time series */}
              <Card className="bg-white border border-zinc-200 rounded-2xl shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-zinc-900">Theo thời gian</h3>
                    <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl">
                      {(["requests", "tokens"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setMetric(m)}
                          className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                            metric === m ? "bg-white text-[#0144DB] shadow-sm" : "text-zinc-500"
                          }`}
                        >
                          {m === "requests" ? "Requests" : "Token (vào/ra)"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <TimeSeriesChart series={data?.series || []} metric={metric} />
                  {metric === "tokens" && (
                    <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#0144DB" }} /> Token vào</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: "#93c5fd" }} /> Token ra</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* By model table */}
              <Card className="bg-white border border-zinc-200 rounded-2xl shadow-sm">
                <CardContent className="p-6">
                  <h3 className="text-base font-bold text-zinc-900 mb-4">Theo model</h3>
                  {!data?.by_model.length ? (
                    <div className="text-sm text-zinc-400 py-8 text-center">Chưa có request nào trong khoảng này.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-zinc-500 border-b border-zinc-100">
                            <th className="py-2 pr-4 font-semibold">Model</th>
                            <th className="py-2 px-2 font-semibold text-right">Requests</th>
                            <th className="py-2 px-2 font-semibold text-right">Token vào</th>
                            <th className="py-2 px-2 font-semibold text-right">Token ra</th>
                            <th className="py-2 px-2 font-semibold text-right">Tổng token</th>
                            <th className="py-2 pl-2 font-semibold text-right">Chi phí</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.by_model.map((m, i) => (
                            <tr key={m.model} className="border-b border-zinc-50">
                              <td className="py-2.5 pr-4">
                                <div className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                                  <span className="font-semibold text-zinc-800">{m.model}</span>
                                </div>
                                <div className="mt-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden" style={{ maxWidth: 220 }}>
                                  <div className="h-full rounded-full" style={{ width: `${(m.requests / maxModelReq) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-right tabular-nums">{fmtInt(m.requests)}</td>
                              <td className="py-2.5 px-2 text-right tabular-nums text-zinc-600">{fmtInt(m.prompt_tokens)}</td>
                              <td className="py-2.5 px-2 text-right tabular-nums text-zinc-600">{fmtInt(m.completion_tokens)}</td>
                              <td className="py-2.5 px-2 text-right tabular-nums font-semibold">{fmtInt(m.total_tokens)}</td>
                              <td className="py-2.5 pl-2 text-right tabular-nums">
                                {m.priced ? <span className="font-semibold">{fmtCost(m.cost_usd)}</span> : <Badge variant="secondary">chưa định giá</Badge>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Pricing editor */}
              {!!data?.by_model.length && (
                <Card className="bg-white border border-zinc-200 rounded-2xl shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-zinc-900">Đơn giá model (USD / 1M token)</h3>
                      <Button size="sm" onClick={savePricing} disabled={savingPrice}>
                        <Save className="w-4 h-4" /> {savingPrice ? "Đang lưu..." : "Lưu đơn giá"}
                      </Button>
                    </div>
                    <p className="text-xs text-zinc-500 mb-4">
                      MaaS chưa công bố giá cho model đang dùng (TBA). Nhập đơn giá ước tính để tính chi phí. Cần quyền superadmin.
                    </p>
                    <div className="space-y-3">
                      {data.by_model.map((m) => (
                        <div key={m.model} className="flex flex-wrap items-center gap-3">
                          <span className="text-sm font-medium text-zinc-700 min-w-[200px] flex-1 truncate">{m.model}</span>
                          <label className="text-xs text-zinc-500 flex items-center gap-1">
                            vào
                            <input
                              type="number" step="0.01" min="0" placeholder="0.00"
                              className="w-24 px-2 py-1 border border-zinc-200 rounded-lg text-sm"
                              value={priceDraft[m.model]?.input ?? ""}
                              onChange={(e) => setPriceDraft((p) => ({ ...p, [m.model]: { ...p[m.model], input: e.target.value } }))}
                            />
                          </label>
                          <label className="text-xs text-zinc-500 flex items-center gap-1">
                            ra
                            <input
                              type="number" step="0.01" min="0" placeholder="0.00"
                              className="w-24 px-2 py-1 border border-zinc-200 rounded-lg text-sm"
                              value={priceDraft[m.model]?.output ?? ""}
                              onChange={(e) => setPriceDraft((p) => ({ ...p, [m.model]: { ...p[m.model], output: e.target.value } }))}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <p className="text-xs text-zinc-400">
                Khoảng: {data?.range.from?.slice(0, 10)} → {data?.range.to?.slice(0, 10)} · Dữ liệu từ bảng <code>llm_calls</code> của agent.
              </p>
            </>
          )}
        </div>
      )}
    </PageShell>
  );
}

function KpiCard({ icon, color, label, value, sub }: { icon: React.ReactNode; color: string; label: string; value: string; sub?: string }) {
  return (
    <Card className="bg-white border border-zinc-200 rounded-2xl shadow-sm">
      <CardContent className="p-5 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider truncate">{label}</p>
          <h3 className="text-2xl font-extrabold text-zinc-900 mt-1">{value}</h3>
          {sub && <p className="text-xs text-zinc-400 mt-0.5 truncate">{sub}</p>}
        </div>
        <div className={`p-3 rounded-xl shrink-0 ${color}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}
