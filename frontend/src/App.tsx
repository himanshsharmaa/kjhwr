import React, { useState, useCallback, useMemo } from "react";
import {
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  AlertCircle,
  Activity,
  Wind,
  Factory,
  HelpCircle,
  RefreshCw,
  BarChart2,
  Gauge,
  Shield,
  TriangleAlert,
} from "lucide-react";

type DashboardData = {
  kpis: {
    mae_mw: number;
    rmse_mw: number;
    mape_pct: number;
    bias_mw: number;
    p90_shortfall_mw: number;
    p95_shortfall_mw: number;
    max_shortfall_mw: number;
    avg_actual_mw: number;
    avg_forecast_mw: number;
    shortfall_hours_pct: number;
    sample_count: number;
  };
  timeseries: Array<{
    startTime: string;
    publishTime: string;
    actual_mw: number;
    forecast_mw: number;
    error_mw: number;
    abs_error_mw: number;
    shortfall_mw: number;
    lead_time_hours: number;
  }>;
  horizon_curve: Array<{
    horizon_hours: number;
    mae_mw: number;
    rmse_mw: number;
    bias_mw: number;
    p90_shortfall_mw: number;
  }>;
  diurnal_profile: Array<{
    hour: number;
    avg_actual_mw: number;
    avg_forecast_mw: number;
    mae_mw: number;
    bias_mw: number;
    p90_shortfall_mw: number;
    sample_count: number;
  }>;
  error_histogram: Array<{ bin: string; count: number }>;
  worst_shortfalls: Array<{
    startTime: string;
    publishTime: string;
    actual_mw: number;
    forecast_mw: number;
    error_mw: number;
    abs_error_mw: number;
    shortfall_mw: number;
    lead_time_hours: number;
  }>;
};

type ApiError = { detail?: string; message?: string };

const API_BASE = "/api";

const presets: Array<{ label: string; start: string; end: string }> = [
  { label: "Full Jan 2026", start: "2026-01-01", end: "2026-01-31" },
  { label: "Jan Week 1–2", start: "2026-01-01", end: "2026-01-14" },
  { label: "Peak Shortfall Week", start: "2026-01-15", end: "2026-01-21" },
];

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};

const biasLabel = (v: number) => (v > 0 ? "Over-forecast" : v < 0 ? "Under-forecast" : "Neutral");

const fetchDashboard = async (params: Record<string, string | number | undefined>): Promise<DashboardData> => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${API_BASE}/dashboard?${qs.toString()}`);
  if (!res.ok) {
    const err: ApiError = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.message || `HTTP ${res.status}`);
  }
  return res.json();
};

const refreshCache = async () => {
  const res = await fetch(`${API_BASE}/refresh-cache`, { method: "POST" });
  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
};

const KPICard = ({
  title,
  value,
  subtitle,
  trend,
  tooltip,
  icon: Icon,
  color = "text-blue-400",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { label: string; value: number; positive: boolean };
  tooltip?: string;
  icon: React.ElementType;
  color?: string;
}) => (
  <div className="kpi-card">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center ${color.replace("text-", "bg-")}/20`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{title}</span>
      </div>
      {tooltip && (
        <div className="flex items-center gap-1 text-slate-500 cursor-help hover:text-slate-300">
          <HelpCircle className="w-3 h-3" />
          <span className="text-[10px]">{tooltip}</span>
        </div>
      )}
    </div>
    <div className="text-3xl font-bold text-slate-100 mb-1">{value}</div>
    {subtitle && <div className="text-xs text-slate-500 mb-3">{subtitle}</div>}
    {trend && (
      <div className={`text-xs font-medium ${trend.positive ? "text-emerald-400" : "text-rose-400"}`}>
        {trend.label}: {trend.value > 0 ? "+" : ""}{trend.value.toFixed(1)}
      </div>
    )}
  </div>
);

const TooltipBadge = ({ children, tip }: { children: React.ReactNode; tip: string }) => (
  <div className="relative inline-block">
    {children}
    <span className="tooltip-badge absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
      {tip}
    </span>
  </div>
);

const App = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"procurement" | "analytics">("procurement");

  // Controls
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState("2026-01-31");
  const [dateBasis, setDateBasis] = useState<"delivery_date" | "decision_date">("delivery_date");
  const [mode, setMode] = useState<"gate_closure" | "horizon">("gate_closure");
  const [cutoffHour, setCutoffHour] = useState(11);
  const [horizonHours, setHorizonHours] = useState(24);
  const [resolution, setResolution] = useState<"hourly" | "half_hourly">("half_hourly");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchDashboard({
        start_date: startDate,
        end_date: endDate,
        date_basis: dateBasis,
        mode,
        cutoff_hour: mode === "gate_closure" ? cutoffHour : undefined,
        horizon_hours: mode === "horizon" ? horizonHours : undefined,
        resolution,
      });
      setData(d);
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, dateBasis, mode, cutoffHour, horizonHours, resolution]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCache();
      await fetchData();
    } catch (e: any) {
      setError(e.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const applyPreset = (p: typeof presets[number]) => {
    setStartDate(p.start);
    setEndDate(p.end);
  };

  const kpis = data?.kpis;
  const timeseries = data?.timeseries ?? [];
  const horizonCurve = data?.horizon_curve ?? [];
  const diurnal = data?.diurnal_profile ?? [];
  const histogram = data?.error_histogram ?? [];
  const worstShortfalls = data?.worst_shortfalls ?? [];

  // Thermal procurement calculator state
  const [targetDemand, setTargetDemand] = useState(32000);
  const [riskPolicy, setRiskPolicy] = useState<"unadjusted" | "bias_corrected" | "p90" | "p95">("p90");

  const avgForecast = useMemo(() => {
    if (!timeseries.length) return 0;
    return timeseries.reduce((sum, r) => sum + r.forecast_mw, 0) / timeseries.length;
  }, [timeseries]);

  const biasMw = kpis?.bias_mw ?? 0;
  const p90Shortfall = kpis?.p90_shortfall_mw ?? 0;
  const p95Shortfall = kpis?.p95_shortfall_mw ?? 0;

  const safeWindBaseline = useMemo(() => {
    let baseline = avgForecast;
    if (riskPolicy === "bias_corrected") baseline = avgForecast - biasMw;
    if (riskPolicy === "p90") baseline = avgForecast - p90Shortfall;
    if (riskPolicy === "p95") baseline = avgForecast - p95Shortfall;
    return Math.max(0, baseline);
  }, [avgForecast, biasMw, p90Shortfall, p95Shortfall, riskPolicy]);

  const requiredThermal = Math.max(0, targetDemand - safeWindBaseline);
  const dailyMWh = requiredThermal * 24;
  const imbalanceReduction = useMemo(() => {
    const unadjusted = Math.max(0, targetDemand - avgForecast);
    return Math.max(0, unadjusted - requiredThermal);
  }, [targetDemand, avgForecast, requiredThermal]);

  const chartData = useMemo(
    () =>
      timeseries.map((r) => ({
        name: new Date(r.startTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        actual: r.actual_mw,
        forecast: r.forecast_mw,
      })),
    [timeseries]
  );

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload as any;
      return (
        <div className="bg-slate-800 border border-slate-600 p-3 rounded-lg shadow-xl min-w-[200px]">
          <div className="text-xs text-slate-400 mb-2 uppercase tracking-wider">{formatDateTime(d.startTime)}</div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
            <span className="text-sm text-slate-200">Actual: <span className="text-emerald-400 font-mono">{d.actual_mw.toFixed(0)} MW</span></span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full bg-blue-400" />
            <span className="text-sm text-slate-200">Forecast: <span className="text-blue-400 font-mono">{d.forecast_mw.toFixed(0)} MW</span></span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-400" />
            <span className="text-sm text-slate-200">Shortfall: <span className="text-rose-400 font-mono">{d.shortfall_mw.toFixed(0)} MW</span></span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      {/* Header & Context Banner */}
      <header className="glass-panel p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center">
                <Wind className="w-6 h-6 text-blue-400" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                UK National Wind Day-Ahead Procurement & Forecast Intelligence
              </h1>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Elexon BMRS • FUELHH 30-min Actuals & WINDFOR Point-in-Time Forecasts • January 2026 Scope
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end w-full md:w-auto">
            <span className="tooltip-badge">FUELHH Actuals</span>
            <span className="tooltip-badge">WINDFOR Forecasts</span>
            <span className="tooltip-badge">Zero Look-Ahead Bias</span>
            <TooltipBadge tip="UK day-ahead auction gate closure: D-1 at 11:00 UTC. Forecasts published after this cutoff cannot be used for D-1 purchase decisions.">
              <span className="btn-secondary text-xs px-2 py-1.5">Methodology</span>
            </TooltipBadge>
          </div>
        </div>
      </header>

      {/* Error / Refresh */}
      {error && (
        <div className="mb-4 p-4 rounded-lg border border-rose-500/30 bg-rose-900/20 text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Interactive Control Bar */}
      <div className="glass-panel p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <div className="col-span-1 md:col-span-2">
            <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Date Range</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none"
                min="2026-01-01"
                max="2026-02-01"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none"
                min="2026-01-01"
                max="2026-02-01"
              />
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="px-2 py-1 text-xs rounded bg-slate-800/50 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="col-span-1 md:col-span-1 lg:col-span-2 xl:col-span-2">
            <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Date Basis</label>
            <div className="flex gap-1">
              <button
                onClick={() => setDateBasis("delivery_date")}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                  dateBasis === "delivery_date" ? "btn-active" : "btn-secondary"
                }`}
              >
                Delivery Date (D in Jan)
              </button>
              <button
                onClick={() => setDateBasis("decision_date")}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                  dateBasis === "decision_date" ? "btn-active" : "btn-secondary"
                }`}
              >
                Decision Date (D-1 in Jan)
              </button>
            </div>
          </div>

          <div className="col-span-1 md:col-span-1 lg:col-span-2 xl:col-span-2">
            <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Forecast Mode</label>
            <div className="flex gap-1">
              <button
                onClick={() => setMode("gate_closure")}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                  mode === "gate_closure" ? "btn-active" : "btn-secondary"
                }`}
              >
                Gate Closure (D-1 @ 11:00)
              </button>
              <button
                onClick={() => setMode("horizon")}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                  mode === "horizon" ? "btn-active" : "btn-secondary"
                }`}
              >
                Horizon
              </button>
            </div>
            {mode === "horizon" && (
              <div className="mt-3">
                <label className="block text-xs text-slate-400 mb-1">Lead-Time Horizon</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="48"
                    step="1"
                    value={horizonHours}
                    onChange={(e) => setHorizonHours(parseInt(e.target.value, 10))}
                    className="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-xs text-slate-300 w-10 text-right">{horizonHours}h</span>
                </div>
              </div>
            )}
            {mode === "gate_closure" && (
              <div className="mt-3">
                <label className="block text-xs text-slate-400 mb-1">Gate Closure Hour (UTC)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={cutoffHour}
                    onChange={(e) => setCutoffHour(parseInt(e.target.value, 10) || 11)}
                    className="w-12 px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-1">
            <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Resolution</label>
            <div className="flex gap-1">
              <button
                onClick={() => setResolution("hourly")}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                  resolution === "hourly" ? "btn-active" : "btn-secondary"
                }`}
              >
                Hourly
              </button>
              <button
                onClick={() => setResolution("half_hourly")}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                  resolution === "half_hourly" ? "btn-active" : "btn-secondary"
                }`}
              >
                30-Min
              </button>
            </div>
          </div>

          <div className="col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-1 flex items-end">
            <button
              onClick={fetchData}
              disabled={loading}
              className="w-full py-3 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 border border-blue-500/50"
            >
              <RefreshCw className="w-4 h-4 animate-[spin_1s_linear_infinite]" /> Apply
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-700/50 pb-2">
        <button
          onClick={() => setActiveTab("procurement")}
          className={`tab-btn px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === "procurement" ? "tab-btn-active" : "tab-btn-inactive"
          }`}
        >
          <Activity className="w-4 h-4 mr-2" /> Day-Ahead Procurement
        </button>
        <button
          onClick={() => setActiveTab("analytics")}
          className={`tab-btn px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === "analytics" ? "tab-btn-active" : "tab-btn-inactive"
          }`}
        >
          <BarChart2 className="w-4 h-4 mr-2" /> Forecast Error Analysis
        </button>
      </div>

      {activeTab === "procurement" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <KPICard
              title="MAE (MW)"
              value={kpis ? kpis.mae_mw.toFixed(1) : "—"}
              subtitle="Mean Absolute Error"
              tooltip="Average magnitude of forecast error regardless of direction"
              icon={Activity}
              color="text-emerald-400"
            />
            <KPICard
              title="RMSE (MW)"
              value={kpis ? kpis.rmse_mw.toFixed(1) : "—"}
              subtitle="Root Mean Square Error"
              tooltip="Penalises large errors more heavily than MAE"
              icon={Activity}
              color="text-amber-400"
            />
            <KPICard
              title="Mean Bias (MW)"
              value={kpis ? kpis.bias_mw.toFixed(1) : "—"}
              subtitle={biasLabel(kpis?.bias_mw ?? 0)}
              tooltip="Positive = over-forecast (utility short of power); Negative = under-forecast"
                          icon={Gauge}
              color={kpis?.bias_mw ?? 0 > 0 ? "text-rose-400" : "text-emerald-400"}
              trend={{
                label: "Tendency",
                value: kpis?.bias_mw ?? 0,
                              positive: (kpis?.bias_mw ?? 0) > 0,
              }}
            />
            <KPICard
              title="MAPE (%)"
              value={kpis ? kpis.mape_pct.toFixed(1) : "—"}
              subtitle="Mean Absolute Percentage Error"
              tooltip="Error as a percentage of actual generation"
              icon={Activity}
              color="text-purple-400"
            />
            <KPICard
              title="P90 Shortfall Buffer (MW)"
              value={kpis ? kpis.p90_shortfall_mw.toFixed(1) : "—"}
              subtitle="90th percentile of over-forecast deficit"
              tooltip="Recommended minimum thermal reserve to cover 90% of shortfall events"
                          icon={Shield}
              color="text-rose-400"
            />
            <KPICard
              title="Max Single-Period Shortfall (MW)"
              value={kpis ? kpis.max_shortfall_mw.toFixed(1) : "—"}
              subtitle="Worst over-forecast interval"
              tooltip="Largest forecast minus actual gap in the selected window"
                          icon={TriangleAlert}
              color="text-rose-500"
            />
          </div>

          {/* Main Chart */}
          <div className="glass-panel p-6 mb-6">
            <div className="section-header">
              <h2 className="section-title">
                <div className="w-3 h-3 rounded-full bg-emerald-400" />
                Actual Wind vs Point-in-Time Forecast
              </h2>
              <div className="flex gap-2 text-xs">
                <span className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-emerald-400" /> Actual Wind (MW)
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-blue-400" /> PIT Forecast (MW)
                </span>
                <span className="flex items-center gap-1 text-rose-400">
                  <div className="w-3 h-3 rounded-full bg-rose-400/20 border border-rose-400/50" /> Shortfall Zone
                </span>
              </div>
            </div>
            <div className="chart-container">
              {loading ? (
                <div className="loading-state">Loading data…</div>
              ) : !data ? (
                <div className="empty-state">Click Apply to load data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <defs>
                      <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity="0.8" />
                        <stop offset="95%" stopColor="#10b981" stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity="0.8" />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} interval={Math.max(1, Math.floor(chartData.length / 20))} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <Tooltip content={CustomTooltip} />
                    <Area type="monotone" dataKey="actual" stroke="#10b981" fillOpacity={1} fill="url(#colorActual)" name="Actual" />
                    <Line type="monotone" dataKey="forecast" stroke="#3b82f6" strokeWidth={2} dot={false} name="Forecast" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Thermal Procurement Calculator */}
          <div className="glass-panel p-6 mb-6">
            <div className="section-header">
              <h2 className="section-title">
                <Factory className="w-5 h-5 text-blue-400" />
                Day-Ahead Thermal Procurement Calculator
              </h2>
              <span className="section-subtitle">Risk-adjusted wind baseline</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="col-span-1 md:col-span-1">
                <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Target Consumer Demand (MW)</label>
                <input
                  type="number"
                  value={targetDemand}
                  onChange={(e) => setTargetDemand(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none"
                />
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Selected Wind Forecast (MW)</label>
                <input
                  type="number"
                  value={avgForecast.toFixed(0)}
                  readOnly
                  className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100"
                />
                <p className="text-xs text-slate-500 mt-1">Period average PIT forecast</p>
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className="block text-xs text-slate-400 uppercase font-medium mb-2">Risk Policy</label>
                <div className="space-y-1">
                                  {([
                    { val: "unadjusted", label: "Unadjusted Forecast" },
                    { val: "bias_corrected", label: "Bias-Corrected" },
                    { val: "p90", label: "P90 Safe Margin" },
                    { val: "p95", label: "P95 Extreme Margin" },
                                  ] as const).map((p) => (
                    <button
                      key={p.val}
                      onClick={() => setRiskPolicy(p.val)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors border ${
                        riskPolicy === p.val
                          ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                          : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KPICard
                title="Recommended Safe Wind Baseline (MW)"
                value={safeWindBaseline.toFixed(0)}
                subtitle="Forecast adjusted for selected risk policy"
                icon={Wind}
                color="text-blue-400"
              />
              <KPICard
                title="Required Day-Ahead Thermal Purchase (MW)"
                value={requiredThermal.toFixed(0)}
                subtitle={`${dailyMWh.toFixed(0)} MWh per day`}
                tooltip="Target demand minus safe wind baseline"
                icon={Factory}
                color="text-rose-400"
              />
              <KPICard
                title="Imbalance Exposure Reduction (MW)"
                value={imbalanceReduction.toFixed(0)}
                subtitle="vs unadjusted forecast procurement"
                tooltip="How much thermal over-purchase risk is mitigated by the risk policy"
                              icon={Shield}
                color="text-emerald-400"
              />
            </div>
          </div>
        </>
      )}

      {activeTab === "analytics" && (
        <>
          {/* Lead-Time Degradation Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="glass-panel p-6">
              <div className="section-header">
                <h2 className="section-title">
                  <BarChart2 className="w-5 h-5 text-blue-400" />
                  Lead-Time Degradation
                </h2>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={horizonCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="horizon_hours" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-800 border border-slate-600 p-2 rounded-lg">
                              <div className="text-xs text-slate-400 mb-1">{d.horizon_hours}h horizon</div>
                              <div className="text-sm text-slate-200">MAE: {d.mae_mw.toFixed(1)} MW</div>
                              <div className="text-sm text-slate-200">RMSE: {d.rmse_mw.toFixed(1)} MW</div>
                              <div className="text-sm text-slate-200">P90 Shortfall: {d.p90_shortfall_mw.toFixed(1)} MW</div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line type="monotone" dataKey="mae_mw" stroke="#3b82f6" strokeWidth={2} dot={false} name="MAE" />
                    <Line type="monotone" dataKey="rmse_mw" stroke="#10b981" strokeWidth={2} dot={false} name="RMSE" />
                    <Line type="monotone" dataKey="p90_shortfall_mw" stroke="#f43f5e" strokeWidth={2} dot={false} name="P90 Shortfall" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Diurnal Profile */}
            <div className="glass-panel p-6">
              <div className="section-header">
                <h2 className="section-title">
                  <Activity className="w-5 h-5 text-blue-400" />
                  Diurnal Error Profile (UTC Hour)
                </h2>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={diurnal}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis dataKey="hour" type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-800 border border-slate-600 p-2 rounded-lg">
                              <div className="text-xs text-slate-400 mb-1">Hour {String(d.hour).padStart(2, "0")}:00 UTC</div>
                              <div className="text-sm text-slate-200">Avg Actual: {d.avg_actual_mw.toFixed(0)} MW</div>
                              <div className="text-sm text-slate-200">Avg Forecast: {d.avg_forecast_mw.toFixed(0)} MW</div>
                              <div className="text-sm text-slate-200">MAE: {d.mae_mw.toFixed(0)} MW</div>
                              <div className="text-sm text-slate-200">P90 Shortfall: {d.p90_shortfall_mw.toFixed(0)} MW</div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="avg_actual_mw" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="avg_forecast_mw" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Error Histogram */}
          <div className="glass-panel p-6 mb-6">
            <div className="section-header">
              <h2 className="section-title">
                <AlertCircle className="w-5 h-5 text-purple-400" />
                Error Distribution Histogram (Forecast − Actual, MW)
              </h2>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top 10 Shortfall Events Table */}
          <div className="glass-panel p-6">
            <div className="section-header">
              <h2 className="section-title">
                <TriangleAlert className="w-5 h-5 text-rose-400" />
                Top 10 Critical Wind Shortfall Events
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="pb-3 font-medium">Target StartTime</th>
                    <th className="pb-3 font-medium">Forecast PublishTime</th>
                    <th className="pb-3 font-medium text-right">Lead Time (h)</th>
                    <th className="pb-3 font-medium text-right">Forecast (MW)</th>
                    <th className="pb-3 font-medium text-right">Actual (MW)</th>
                    <th className="pb-3 font-medium text-right text-rose-400">Shortfall Deficit (MW)</th>
                  </tr>
                </thead>
                <tbody>
                  {worstShortfalls.map((r, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 text-slate-200">{formatDateTime(r.startTime)}</td>
                      <td className="py-2 text-slate-300">{formatDateTime(r.publishTime)}</td>
                      <td className="py-2 text-right text-slate-300 font-mono">{r.lead_time_hours.toFixed(1)}</td>
                      <td className="py-2 text-right text-slate-300 font-mono">{r.forecast_mw.toFixed(0)}</td>
                      <td className="py-2 text-right text-slate-300 font-mono">{r.actual_mw.toFixed(0)}</td>
                      <td className="py-2 text-right text-rose-400 font-mono font-medium">+{r.shortfall_mw.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <footer className="mt-8 pt-6 border-t border-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-xs text-slate-500">
          UK National Wind Day-Ahead Procurement & Forecast Intelligence • Elexon BMRS FUELHH & WINDFOR • January 2026
        </p>
        <div className="flex gap-3 text-xs text-slate-500">
          <span>Backend: FastAPI :8000</span>
          <span>Frontend: Vite :5173</span>
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 hover:text-slate-300 transition-colors">
            <RefreshCw className="w-3 h-3" /> {refreshing ? "Refreshing…" : "Refresh Cache"}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default App;
