import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useMemo } from "react";
import { LineChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, } from "recharts";
import { BarChart3, Activity, AlertTriangle, Factory, ShieldAlert, HelpCircle, RefreshCw, Thermometer, Wind, AlertCircle, } from "lucide-react";
const API_BASE = "/api";
const presets = [
    { label: "Full Jan 2026", start: "2026-01-01", end: "2026-01-31" },
    { label: "Jan Week 1–2", start: "2026-01-01", end: "2026-01-14" },
    { label: "Peak Shortfall Week", start: "2026-01-15", end: "2026-01-21" },
];
const formatDate = (iso) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const formatDateTime = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const formatMW = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " MW";
const formatPct = (v) => v.toFixed(1) + "%";
const formatHours = (v) => v.toFixed(1) + " h";
const biasLabel = (v) => (v > 0 ? "Over-forecast" : v < 0 ? "Under-forecast" : "Neutral");
const fetchDashboard = async (params) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "")
            qs.set(k, String(v));
    }
    const res = await fetch(`${API_BASE}/dashboard?${qs.toString()}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `HTTP ${res.status}`);
    }
    return res.json();
};
const refreshCache = async () => {
    const res = await fetch(`${API_BASE}/refresh-cache`, { method: "POST" });
    if (!res.ok)
        throw new Error("Refresh failed");
    return res.json();
};
const KPICard = ({ title, value, subtitle, trend, tooltip, icon: Icon, color = "text-blue-400", }) => (_jsxs("div", { className: "kpi-card", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Icon, { className: `w-5 h-5 ${color}` }), _jsx("span", { className: "text-xs text-slate-400 font-medium uppercase tracking-wider", children: title })] }), tooltip && (_jsxs("div", { className: "flex items-center gap-1 text-slate-500 cursor-help hover:text-slate-300", children: [_jsx(HelpCircle, { className: "w-3 h-3" }), _jsx("span", { className: "text-[10px]", children: tooltip })] }))] }), _jsx("div", { className: "text-2xl font-bold text-slate-100 mb-1", children: value }), subtitle && _jsx("div", { className: "text-xs text-slate-500 mb-3", children: subtitle }), trend && (_jsxs("div", { className: `text-xs font-medium ${trend.positive ? "text-emerald-400" : "text-rose-400"}`, children: [trend.label, ": ", trend.value > 0 ? "+" : "", trend.value.toFixed(1)] }))] }));
const TooltipBadge = ({ children, tip }) => (_jsxs("div", { className: "relative inline-block", children: [children, _jsx("span", { className: "tooltip-badge absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20", children: tip })] }));
const App = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState("procurement");
    // Controls
    const [startDate, setStartDate] = useState("2026-01-01");
    const [endDate, setEndDate] = useState("2026-01-31");
    const [dateBasis, setDateBasis] = useState("delivery_date");
    const [mode, setMode] = useState("gate_closure");
    const [cutoffHour, setCutoffHour] = useState(11);
    const [horizonHours, setHorizonHours] = useState(24);
    const [resolution, setResolution] = useState("half_hourly");
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
        }
        catch (e) {
            setError(e.message || "Failed to load dashboard data");
        }
        finally {
            setLoading(false);
        }
    }, [startDate, endDate, dateBasis, mode, cutoffHour, horizonHours, resolution]);
    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await refreshCache();
            await fetchData();
        }
        catch (e) {
            setError(e.message || "Refresh failed");
        }
        finally {
            setRefreshing(false);
        }
    };
    const applyPreset = (p) => {
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
    const [riskPolicy, setRiskPolicy] = useState("p90");
    const avgForecast = useMemo(() => {
        if (!timeseries.length)
            return 0;
        return timeseries.reduce((sum, r) => sum + r.forecast_mw, 0) / timeseries.length;
    }, [timeseries]);
    const biasMw = kpis?.bias_mw ?? 0;
    const p90Shortfall = kpis?.p90_shortfall_mw ?? 0;
    const p95Shortfall = kpis?.p95_shortfall_mw ?? 0;
    const safeWindBaseline = useMemo(() => {
        let baseline = avgForecast;
        if (riskPolicy === "bias_corrected")
            baseline = avgForecast - biasMw;
        if (riskPolicy === "p90")
            baseline = avgForecast - p90Shortfall;
        if (riskPolicy === "p95")
            baseline = avgForecast - p95Shortfall;
        return Math.max(0, baseline);
    }, [avgForecast, biasMw, p90Shortfall, p95Shortfall, riskPolicy]);
    const requiredThermal = Math.max(0, targetDemand - safeWindBaseline);
    const dailyMWh = requiredThermal * 24;
    const imbalanceReduction = useMemo(() => {
        const unadjusted = Math.max(0, targetDemand - avgForecast);
        return Math.max(0, unadjusted - requiredThermal);
    }, [targetDemand, avgForecast, requiredThermal]);
    const chartData = useMemo(() => timeseries.map((r) => ({
        name: new Date(r.startTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        actual: r.actual_mw,
        forecast: r.forecast_mw,
    })), [timeseries]);
    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            return (_jsxs("div", { className: "bg-slate-800 border border-slate-600 p-3 rounded-lg shadow-xl min-w-[200px]", children: [_jsx("div", { className: "text-xs text-slate-400 mb-2 uppercase tracking-wider", children: formatDateTime(d.startTime) }), _jsxs("div", { className: "flex items-center gap-2 mb-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-emerald-400" }), _jsxs("span", { className: "text-sm text-slate-200", children: ["Actual: ", _jsxs("span", { className: "text-emerald-400 font-mono", children: [d.actual_mw.toFixed(0), " MW"] })] })] }), _jsxs("div", { className: "flex items-center gap-2 mb-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-blue-400" }), _jsxs("span", { className: "text-sm text-slate-200", children: ["Forecast: ", _jsxs("span", { className: "text-blue-400 font-mono", children: [d.forecast_mw.toFixed(0), " MW"] })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-rose-400" }), _jsxs("span", { className: "text-sm text-slate-200", children: ["Shortfall: ", _jsxs("span", { className: "text-rose-400 font-mono", children: [d.shortfall_mw.toFixed(0), " MW"] })] })] })] }));
        }
        return null;
    };
    const isShortfall = (r) => r.shortfall_mw > 0;
    return (_jsxs("div", { className: "min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6", children: [_jsx("header", { className: "glass-panel p-6 mb-6", children: _jsxs("div", { className: "flex flex-col md:flex-row md:items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsxs("h1", { className: "text-2xl font-bold text-white tracking-tight flex items-center gap-3", children: [_jsx(Wind, { className: "w-6 h-6 text-blue-400" }), "UK National Wind Day-Ahead Procurement & Forecast Intelligence"] }), _jsx("p", { className: "text-slate-400 text-sm mt-1", children: "Elexon BMRS \u2022 FUELHH 30-min Actuals & WINDFOR Point-in-Time Forecasts \u2022 January 2026 Scope" })] }), _jsxs("div", { className: "flex flex-wrap gap-2 md:justify-end w-full md:w-auto", children: [_jsx("span", { className: "tooltip-badge", children: "FUELHH Actuals" }), _jsx("span", { className: "tooltip-badge", children: "WINDFOR Forecasts" }), _jsx("span", { className: "tooltip-badge", children: "Zero Look-Ahead Bias" }), _jsx(TooltipBadge, { tip: "UK day-ahead auction gate closure: D-1 at 11:00 UTC. Forecasts published after this cutoff cannot be used for D-1 purchase decisions.", children: _jsx("span", { className: "btn-secondary text-xs px-2 py-1.5", children: "Methodology" }) })] })] }) }), error && (_jsxs("div", { className: "mb-4 p-4 rounded-lg border border-rose-500/30 bg-rose-900/20 text-rose-300 text-sm flex items-center gap-3", children: [_jsx(AlertCircle, { className: "w-5 h-5" }), _jsx("span", { children: error })] })), _jsx("div", { className: "glass-panel p-5 mb-6", children: _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4", children: [_jsxs("div", { className: "col-span-1 md:col-span-2", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Date Range" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { type: "date", value: startDate, onChange: (e) => setStartDate(e.target.value), className: "px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none", min: "2026-01-01", max: "2026-02-01" }), _jsx("input", { type: "date", value: endDate, onChange: (e) => setEndDate(e.target.value), className: "px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none", min: "2026-01-01", max: "2026-02-01" })] }), _jsx("div", { className: "flex flex-wrap gap-1 mt-2", children: presets.map((p) => (_jsx("button", { onClick: () => applyPreset(p), className: "px-2 py-1 text-xs rounded bg-slate-800/50 border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors", children: p.label }, p.label))) })] }), _jsxs("div", { className: "col-span-1 md:col-span-1 lg:col-span-2 xl:col-span-2", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Date Basis" }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => setDateBasis("delivery_date"), className: `flex-1 py-2 rounded text-sm font-medium transition-colors ${dateBasis === "delivery_date" ? "btn-active" : "btn-secondary"}`, children: "Delivery Date (D in Jan)" }), _jsx("button", { onClick: () => setDateBasis("decision_date"), className: `flex-1 py-2 rounded text-sm font-medium transition-colors ${dateBasis === "decision_date" ? "btn-active" : "btn-secondary"}`, children: "Decision Date (D-1 in Jan)" })] })] }), _jsxs("div", { className: "col-span-1 md:col-span-1 lg:col-span-2 xl:col-span-2", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Forecast Mode" }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => setMode("gate_closure"), className: `flex-1 py-2 rounded text-sm font-medium transition-colors ${mode === "gate_closure" ? "btn-active" : "btn-secondary"}`, children: "Gate Closure (D-1 @ 11:00)" }), _jsx("button", { onClick: () => setMode("horizon"), className: `flex-1 py-2 rounded text-sm font-medium transition-colors ${mode === "horizon" ? "btn-active" : "btn-secondary"}`, children: "Horizon" })] }), mode === "horizon" && (_jsxs("div", { className: "mt-3", children: [_jsx("label", { className: "block text-xs text-slate-400 mb-1", children: "Lead-Time Horizon" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "range", min: "1", max: "48", step: "1", value: horizonHours, onChange: (e) => setHorizonHours(parseInt(e.target.value, 10)), className: "flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" }), _jsxs("span", { className: "text-xs text-slate-300 w-10 text-right", children: [horizonHours, "h"] })] })] })), mode === "gate_closure" && (_jsxs("div", { className: "mt-3", children: [_jsx("label", { className: "block text-xs text-slate-400 mb-1", children: "Gate Closure Hour (UTC)" }), _jsx("div", { className: "flex items-center gap-2", children: _jsx("input", { type: "number", min: "0", max: "23", value: cutoffHour, onChange: (e) => setCutoffHour(parseInt(e.target.value, 10) || 11), className: "w-12 px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none" }) })] }))] }), _jsxs("div", { className: "col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-1", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Resolution" }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => setResolution("hourly"), className: `flex-1 py-2 rounded text-sm font-medium transition-colors ${resolution === "hourly" ? "btn-active" : "btn-secondary"}`, children: "Hourly" }), _jsx("button", { onClick: () => setResolution("half_hourly"), className: `flex-1 py-2 rounded text-sm font-medium transition-colors ${resolution === "half_hourly" ? "btn-active" : "btn-secondary"}`, children: "30-Min" })] })] }), _jsx("div", { className: "col-span-1 md:col-span-1 lg:col-span-1 xl:col-span-1 flex items-end", children: _jsxs("button", { onClick: fetchData, disabled: loading, className: "w-full py-3 rounded bg-uk-blue hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50", children: [_jsx(RefreshCw, { className: "w-4 h-4 animate-[spin_1s_linear_infinite]" }), " Apply"] }) })] }) }), _jsxs("div", { className: "flex gap-1 mb-4 border-b border-slate-700/50 pb-2", children: [_jsxs("button", { onClick: () => setActiveTab("procurement"), className: `tab-btn px-3 py-2 text-sm font-medium transition-colors ${activeTab === "procurement" ? "tab-btn-active" : "tab-btn-inactive"}`, children: [_jsx(Activity, { className: "w-4 h-4 mr-2" }), " Day-Ahead Procurement"] }), _jsxs("button", { onClick: () => setActiveTab("analytics"), className: `tab-btn px-3 py-2 text-sm font-medium transition-colors ${activeTab === "analytics" ? "tab-btn-active" : "tab-btn-inactive"}`, children: [_jsx(BarChart3, { className: "w-4 h-4 mr-2" }), " Forecast Error Analysis"] })] }), activeTab === "procurement" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6", children: [_jsx(KPICard, { title: "MAE (MW)", value: kpis ? kpis.mae_mw.toFixed(1) : "—", subtitle: "Mean Absolute Error", tooltip: "Average magnitude of forecast error regardless of direction", icon: Activity, color: "text-emerald-400" }), _jsx(KPICard, { title: "RMSE (MW)", value: kpis ? kpis.rmse_mw.toFixed(1) : "—", subtitle: "Root Mean Square Error", tooltip: "Penalises large errors more heavily than MAE", icon: Activity, color: "text-amber-400" }), _jsx(KPICard, { title: "Mean Bias (MW)", value: kpis ? kpis.bias_mw.toFixed(1) : "—", subtitle: biasLabel(kpis?.bias_mw ?? 0), tooltip: "Positive = over-forecast (utility short of power); Negative = under-forecast", icon: Thermometer, color: kpis?.bias_mw ?? 0 > 0 ? "text-rose-400" : "text-emerald-400", trend: {
                                    label: "Tendency",
                                    value: kpis?.bias_mw ?? 0,
                                    positive: kpis?.bias_mw ?? 0 > 0,
                                } }), _jsx(KPICard, { title: "MAPE (%)", value: kpis ? kpis.mape_pct.toFixed(1) : "—", subtitle: "Mean Absolute Percentage Error", tooltip: "Error as a percentage of actual generation", icon: Activity, color: "text-purple-400" }), _jsx(KPICard, { title: "P90 Shortfall Buffer (MW)", value: kpis ? kpis.p90_shortfall_mw.toFixed(1) : "—", subtitle: "90th percentile of over-forecast deficit", tooltip: "Recommended minimum thermal reserve to cover 90% of shortfall events", icon: ShieldAlert, color: "text-rose-400" }), _jsx(KPICard, { title: "Max Single-Period Shortfall (MW)", value: kpis ? kpis.max_shortfall_mw.toFixed(1) : "—", subtitle: "Worst over-forecast interval", tooltip: "Largest forecast minus actual gap in the selected window", icon: AlertTriangle, color: "text-rose-500" })] }), _jsxs("div", { className: "glass-panel p-5 mb-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-lg font-semibold text-white", children: "Actual Wind vs Point-in-Time Forecast" }), _jsxs("div", { className: "flex gap-2 text-xs", children: [_jsxs("span", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-emerald-400" }), " Actual Wind (MW)"] }), _jsxs("span", { className: "flex items-center gap-1", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-blue-400" }), " PIT Forecast (MW)"] }), _jsxs("span", { className: "flex items-center gap-1 text-rose-400", children: [_jsx("div", { className: "w-3 h-3 rounded-full bg-rose-400/20 border border-rose-400/50" }), " Shortfall Zone"] })] })] }), _jsx("div", { className: "h-[400px] w-full", children: loading ? (_jsx("div", { className: "flex h-full items-center justify-center text-slate-400", children: "Loading data\u2026" })) : !data ? (_jsx("div", { className: "flex h-full items-center justify-center text-slate-400", children: "Click Apply to load data" })) : (_jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(LineChart, { data: chartData, children: [_jsxs("defs", { children: [_jsxs("linearGradient", { id: "colorActual", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "5%", stopColor: "#10b981", stopOpacity: "0.8" }), _jsx("stop", { offset: "95%", stopColor: "#10b981", stopOpacity: "0" })] }), _jsxs("linearGradient", { id: "colorForecast", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "5%", stopColor: "#3b82f6", stopOpacity: "0.8" }), _jsx("stop", { offset: "95%", stopColor: "#3b82f6", stopOpacity: "0" })] })] }), _jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#334155", vertical: false }), _jsx(XAxis, { dataKey: "name", tick: { fontSize: 11, fill: "#94a3b8" }, interval: Math.max(1, Math.floor(chartData.length / 20)) }), _jsx(YAxis, { tick: { fontSize: 11, fill: "#94a3b8" } }), _jsx(Tooltip, { content: CustomTooltip }), _jsx(Area, { type: "monotone", dataKey: "actual", stroke: "#10b981", fillOpacity: 1, fill: "url(#colorActual)", name: "Actual" }), _jsx(Line, { type: "monotone", dataKey: "forecast", stroke: "#3b82f6", strokeWidth: 2, dot: false, name: "Forecast" })] }) })) })] }), _jsxs("div", { className: "glass-panel p-5 mb-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("h2", { className: "text-lg font-semibold text-white flex items-center gap-2", children: [_jsx(Factory, { className: "w-5 h-5 text-blue-400" }), " Day-Ahead Thermal Procurement Calculator"] }), _jsx("span", { className: "text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded", children: "Risk-adjusted wind baseline" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: [_jsxs("div", { className: "col-span-1 md:col-span-1", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Target Consumer Demand (MW)" }), _jsx("input", { type: "number", value: targetDemand, onChange: (e) => setTargetDemand(parseInt(e.target.value) || 0), className: "w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100 focus:border-blue-500 outline-none" })] }), _jsxs("div", { className: "col-span-1 md:col-span-1", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Selected Wind Forecast (MW)" }), _jsx("input", { type: "number", value: avgForecast.toFixed(0), readOnly: true, className: "w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-sm text-slate-100" }), _jsx("p", { className: "text-xs text-slate-500 mt-1", children: "Period average PIT forecast" })] }), _jsxs("div", { className: "col-span-1 md:col-span-1", children: [_jsx("label", { className: "block text-xs text-slate-400 uppercase font-medium mb-2", children: "Risk Policy" }), _jsx("div", { className: "space-y-1", children: [
                                                    { val: "unadjusted", label: "Unadjusted Forecast" },
                                                    { val: "bias_corrected", label: "Bias-Corrected" },
                                                    { val: "p90", label: "P90 Safe Margin" },
                                                    { val: "p95", label: "P95 Extreme Margin" },
                                                ].map((p) => (_jsx("button", { onClick: () => setRiskPolicy(p.val), className: `w-full text-left px-3 py-2 rounded text-sm transition-colors border ${riskPolicy === p.val
                                                        ? "bg-blue-500/10 border-blue-500/50 text-blue-400"
                                                        : "bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700"}`, children: p.label }, p.val))) })] })] }), _jsxs("div", { className: "mt-5 pt-4 border-t border-slate-700/50 grid grid-cols-1 sm:grid-cols-3 gap-4", children: [_jsx(KPICard, { title: "Recommended Safe Wind Baseline (MW)", value: safeWindBaseline.toFixed(0), subtitle: "Forecast adjusted for selected risk policy", icon: Wind, color: "text-blue-400" }), _jsx(KPICard, { title: "Required Day-Ahead Thermal Purchase (MW)", value: requiredThermal.toFixed(0), subtitle: `${dailyMWh.toFixed(0)} MWh per day`, tooltip: "Target demand minus safe wind baseline", icon: Factory, color: "text-rose-400" }), _jsx(KPICard, { title: "Imbalance Exposure Reduction (MW)", value: imbalanceReduction.toFixed(0), subtitle: "vs unadjusted forecast procurement", tooltip: "How much thermal over-purchase risk is mitigated by the risk policy", icon: ShieldAlert, color: "text-emerald-400" })] })] })] })), activeTab === "analytics" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6", children: [_jsxs("div", { className: "glass-panel p-5", children: [_jsx("h2", { className: "text-lg font-semibold text-white mb-4", children: "Lead-Time Degradation" }), _jsx("div", { className: "h-[320px] w-full", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(LineChart, { data: horizonCurve, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#334155", vertical: false }), _jsx(XAxis, { dataKey: "horizon_hours", tick: { fontSize: 11, fill: "#94a3b8" } }), _jsx(YAxis, { tick: { fontSize: 11, fill: "#94a3b8" } }), _jsx(Tooltip, { content: ({ active, payload }) => {
                                                            if (active && payload && payload.length) {
                                                                const d = payload[0].payload;
                                                                return (_jsxs("div", { className: "bg-slate-800 border border-slate-600 p-2 rounded-lg", children: [_jsxs("div", { className: "text-xs text-slate-400 mb-1", children: [d.horizon_hours, "h horizon"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["MAE: ", d.mae_mw.toFixed(1), " MW"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["RMSE: ", d.rmse_mw.toFixed(1), " MW"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["P90 Shortfall: ", d.p90_shortfall_mw.toFixed(1), " MW"] })] }));
                                                            }
                                                            return null;
                                                        } }), _jsx(Line, { type: "monotone", dataKey: "mae_mw", stroke: "#3b82f6", strokeWidth: 2, dot: false, name: "MAE" }), _jsx(Line, { type: "monotone", dataKey: "rmse_mw", stroke: "#10b981", strokeWidth: 2, dot: false, name: "RMSE" }), _jsx(Line, { type: "monotone", dataKey: "p90_shortfall_mw", stroke: "#f43f5e", strokeWidth: 2, dot: false, name: "P90 Shortfall" })] }) }) })] }), _jsxs("div", { className: "glass-panel p-5", children: [_jsx("h2", { className: "text-lg font-semibold text-white mb-4", children: "Diurnal Error Profile (UTC Hour)" }), _jsx("div", { className: "h-[320px] w-full", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(BarChart, { data: diurnal, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#334155", horizontal: false }), _jsx(XAxis, { dataKey: "hour", type: "number", tick: { fontSize: 10, fill: "#94a3b8" } }), _jsx(YAxis, { tick: { fontSize: 10, fill: "#94a3b8" } }), _jsx(Tooltip, { content: ({ active, payload }) => {
                                                            if (active && payload && payload.length) {
                                                                const d = payload[0].payload;
                                                                return (_jsxs("div", { className: "bg-slate-800 border border-slate-600 p-2 rounded-lg", children: [_jsxs("div", { className: "text-xs text-slate-400 mb-1", children: ["Hour ", String(d.hour).padStart(2, "0"), ":00 UTC"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["Avg Actual: ", d.avg_actual_mw.toFixed(0), " MW"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["Avg Forecast: ", d.avg_forecast_mw.toFixed(0), " MW"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["MAE: ", d.mae_mw.toFixed(0), " MW"] }), _jsxs("div", { className: "text-sm text-slate-200", children: ["P90 Shortfall: ", d.p90_shortfall_mw.toFixed(0), " MW"] })] }));
                                                            }
                                                            return null;
                                                        } }), _jsx(Bar, { dataKey: "avg_actual_mw", fill: "#10b981", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "avg_forecast_mw", fill: "#3b82f6", radius: [4, 4, 0, 0] })] }) }) })] })] }), _jsxs("div", { className: "glass-panel p-5 mb-6", children: [_jsx("h2", { className: "text-lg font-semibold text-white mb-4", children: "Error Distribution Histogram (Forecast \u2212 Actual, MW)" }), _jsx("div", { className: "h-[300px] w-full", children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(BarChart, { data: histogram, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#334155", horizontal: false }), _jsx(XAxis, { dataKey: "bin", tick: { fontSize: 10, fill: "#94a3b8" } }), _jsx(YAxis, { tick: { fontSize: 10, fill: "#94a3b8" } }), _jsx(Bar, { dataKey: "count", fill: "#6366f1", radius: [4, 4, 0, 0] })] }) }) })] }), _jsxs("div", { className: "glass-panel p-5", children: [_jsx("h2", { className: "text-lg font-semibold text-white mb-4", children: "Top 10 Critical Wind Shortfall Events" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-left text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-700 text-slate-400", children: [_jsx("th", { className: "pb-3 font-medium", children: "Target StartTime" }), _jsx("th", { className: "pb-3 font-medium", children: "Forecast PublishTime" }), _jsx("th", { className: "pb-3 font-medium text-right", children: "Lead Time (h)" }), _jsx("th", { className: "pb-3 font-medium text-right", children: "Forecast (MW)" }), _jsx("th", { className: "pb-3 font-medium text-right", children: "Actual (MW)" }), _jsx("th", { className: "pb-3 font-medium text-right text-rose-400", children: "Shortfall Deficit (MW)" })] }) }), _jsx("tbody", { children: worstShortfalls.map((r, i) => (_jsxs("tr", { className: "border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors", children: [_jsx("td", { className: "py-2 text-slate-200", children: formatDateTime(r.startTime) }), _jsx("td", { className: "py-2 text-slate-300", children: formatDateTime(r.publishTime) }), _jsx("td", { className: "py-2 text-right text-slate-300 font-mono", children: r.lead_time_hours.toFixed(1) }), _jsx("td", { className: "py-2 text-right text-slate-300 font-mono", children: r.forecast_mw.toFixed(0) }), _jsx("td", { className: "py-2 text-right text-slate-300 font-mono", children: r.actual_mw.toFixed(0) }), _jsxs("td", { className: "py-2 text-right text-rose-400 font-mono font-medium", children: ["+", r.shortfall_mw.toFixed(0)] })] }, i))) })] }) })] })] })), _jsxs("footer", { className: "mt-8 pt-6 border-t border-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-4", children: [_jsx("p", { className: "text-xs text-slate-500", children: "UK National Wind Day-Ahead Procurement & Forecast Intelligence \u2022 Elexon BMRS FUELHH & WINDFOR \u2022 January 2026" }), _jsxs("div", { className: "flex gap-3 text-xs text-slate-500", children: [_jsx("span", { children: "Backend: FastAPI :8000" }), _jsx("span", { children: "Frontend: Vite :5173" }), _jsxs("button", { onClick: handleRefresh, disabled: refreshing, className: "flex items-center gap-1 hover:text-slate-300 transition-colors", children: [_jsx(RefreshCw, { className: "w-3 h-3" }), " ", refreshing ? "Refreshing…" : "Refresh Cache"] })] })] })] }));
};
export default App;
