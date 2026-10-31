"""Point-in-Time wind forecast accuracy analytics for the Day-Ahead Wind Procurement Portal."""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from elexon_client import get_actuals, get_forecasts


@dataclass
class KPIs:
    mae_mw: float
    rmse_mw: float
    mape_pct: float
    bias_mw: float
    p90_shortfall_mw: float
    p95_shortfall_mw: float
    max_shortfall_mw: float
    avg_actual_mw: float
    avg_forecast_mw: float
    shortfall_hours_pct: float
    sample_count: int


def _parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _format_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(s[int(k)])
    d = k - f
    return float(s[f] * (1 - d) + s[c] * d)


def _compute_kpis(rows: List[Dict[str, Any]]) -> KPIs:
    if not rows:
        return KPIs(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0)
    actuals = [r["actual_mw"] for r in rows]
    forecasts = [r["forecast_mw"] for r in rows]
    errors = [r["error_mw"] for r in rows]
    abs_errors = [r["abs_error_mw"] for r in rows]
    shortfalls = [r["shortfall_mw"] for r in rows]
    n = len(rows)
    mae = sum(abs_errors) / n
    rmse = math.sqrt(sum(e * e for e in errors) / n)
    valid_mape = [abs(e / a) for e, a in zip(errors, actuals) if a != 0]
    mape = (sum(valid_mape) / len(valid_mape) * 100) if valid_mape else 0.0
    bias = sum(errors) / n
    shortfall_hours = sum(1 for s in shortfalls if s > 0)
    return KPIs(
        mae_mw=round(mae, 2),
        rmse_mw=round(rmse, 2),
        mape_pct=round(mape, 2),
        bias_mw=round(bias, 2),
        p90_shortfall_mw=round(_percentile(shortfalls, 90), 2),
        p95_shortfall_mw=round(_percentile(shortfalls, 95), 2),
        max_shortfall_mw=round(max(shortfalls), 2),
        avg_actual_mw=round(sum(actuals) / n, 2),
        avg_forecast_mw=round(sum(forecasts) / n, 2),
        shortfall_hours_pct=round(shortfall_hours / n * 100, 2),
        sample_count=n,
    )


def _get_delivery_range(
    date_basis: str, start_date: Optional[str], end_date: Optional[str]
) -> Tuple[datetime, datetime]:
    if date_basis == "decision_date":
        if start_date and end_date:
            sd = _parse_iso(start_date)
            ed = _parse_iso(end_date)
        else:
            sd = datetime(2026, 1, 1, tzinfo=timezone.utc)
            ed = datetime(2026, 1, 31, tzinfo=timezone.utc)
        # Decisions made in Jan 2026 -> delivery days Jan 2 to Feb 1
        return sd + timedelta(days=1), ed + timedelta(days=1)
    # delivery_date
    if start_date and end_date:
        return _parse_iso(start_date), _parse_iso(end_date)
    return datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 1, 31, tzinfo=timezone.utc)


def _build_forecast_index(forecasts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    index: Dict[str, List[Dict[str, Any]]] = {}
    for f in forecasts:
        index.setdefault(f["startTime"], []).append(f)
    for st in index:
        index[st].sort(key=lambda x: x["publishTime"])
    return index


def _find_latest_before(candidates: List[Dict[str, Any]], cutoff: datetime) -> Optional[Dict[str, Any]]:
    best: Optional[Dict[str, Any]] = None
    for f in candidates:
        if _parse_iso(f["publishTime"]) <= cutoff:
            best = f
        else:
            break
    return best


def _match_point_in_time(
    delivery_times: List[datetime],
    forecast_index: Dict[str, List[Dict[str, Any]]],
    mode: str,
    cutoff_hour: int,
    horizon_hours: Optional[int],
) -> Dict[datetime, Optional[Dict[str, Any]]]:
    matched: Dict[datetime, Optional[Dict[str, Any]]] = {}
    for dt in delivery_times:
        st_key = _format_iso(dt)
        candidates = forecast_index.get(st_key, [])
        if mode == "gate_closure":
            d = dt.date()
            cutoff_day = datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - timedelta(days=1)
            cutoff = datetime(cutoff_day.year, cutoff_day.month, cutoff_day.day, cutoff_hour, 0, 0, tzinfo=timezone.utc)
        else:  # horizon
            h = horizon_hours if horizon_hours is not None else 24
            cutoff = dt - timedelta(hours=h)
        matched[dt] = _find_latest_before(candidates, cutoff)
    return matched


def _compute_rows(
    actuals: List[Dict[str, Any]],
    forecast_index: Dict[str, List[Dict[str, Any]]],
    mode: str,
    cutoff_hour: int,
    horizon_hours: Optional[int],
    resolution: str,
) -> List[Dict[str, Any]]:
    # Determine which delivery hours need point-in-time forecast matching
    if resolution == "hourly":
        target_times = sorted(
            set(
                _parse_iso(a["startTime"]).replace(minute=0, second=0, microsecond=0)
                for a in actuals
                if _parse_iso(a["startTime"]).minute == 0
            )
        )
    else:  # half_hourly
        hours_needed: set = set()
        for a in actuals:
            t = _parse_iso(a["startTime"])
            hours_needed.add(t.replace(minute=0, second=0, microsecond=0))
            if t.minute == 30:
                hours_needed.add((t + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0))
        target_times = sorted(hours_needed)

    matched_forecasts = _match_point_in_time(
        target_times, forecast_index, mode, cutoff_hour, horizon_hours
    )

    rows: List[Dict[str, Any]] = []
    for a in actuals:
        t = _parse_iso(a["startTime"])
        actual_mw = a["generation"]

        if resolution == "hourly":
            if t.minute != 0:
                continue
            fe = matched_forecasts.get(t)
            if not fe:
                continue
            forecast_mw = fe["generation"]
            publish_time = fe["publishTime"]
        else:  # half_hourly: linearly interpolate hourly forecasts onto 30-min grid
            floor_hour = t.replace(minute=0, second=0, microsecond=0)
            ceil_hour = floor_hour + timedelta(hours=1)
            f_floor = matched_forecasts.get(floor_hour)
            f_ceil = matched_forecasts.get(ceil_hour)
            if f_floor and f_ceil:
                ratio = t.minute / 60.0
                forecast_mw = f_floor["generation"] + ratio * (f_ceil["generation"] - f_floor["generation"])
                publish_time = f_floor["publishTime"]
            elif f_floor:
                forecast_mw = f_floor["generation"]
                publish_time = f_floor["publishTime"]
            elif f_ceil:
                forecast_mw = f_ceil["generation"]
                publish_time = f_ceil["publishTime"]
            else:
                continue

        error_mw = forecast_mw - actual_mw
        abs_error_mw = abs(error_mw)
        shortfall_mw = max(0.0, error_mw)
        pt_dt = _parse_iso(publish_time)
        lead_time_hours = (t - pt_dt).total_seconds() / 3600.0

        rows.append({
            "startTime": _format_iso(t),
            "publishTime": publish_time,
            "actual_mw": round(actual_mw, 1),
            "forecast_mw": round(forecast_mw, 1),
            "error_mw": round(error_mw, 1),
            "abs_error_mw": round(abs_error_mw, 1),
            "shortfall_mw": round(shortfall_mw, 1),
            "lead_time_hours": round(lead_time_hours, 2),
        })

    rows.sort(key=lambda x: x["startTime"])
    return rows


def compute_dashboard(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    date_basis: str = "delivery_date",
    mode: str = "gate_closure",
    cutoff_hour: int = 11,
    horizon_hours: Optional[int] = None,
    resolution: str = "half_hourly",
) -> Dict[str, Any]:
    actuals_raw = get_actuals()
    forecasts_raw = get_forecasts()

    range_start, range_end = _get_delivery_range(date_basis, start_date, end_date)
    actuals = [
        a
        for a in actuals_raw
        if range_start <= _parse_iso(a["startTime"]) <= range_end
        and a.get("fuelType", "WIND") == "WIND"
    ]

    forecast_index = _build_forecast_index(forecasts_raw)

    rows = _compute_rows(actuals, forecast_index, mode, cutoff_hour, horizon_hours, resolution)
    kpis = _compute_kpis(rows)

    # Horizon curve across fixed horizons
    horizon_curve: List[Dict[str, Any]] = []
    for h in [4, 8, 12, 18, 24, 36, 48]:
        h_rows = _compute_rows(actuals, forecast_index, mode, cutoff_hour, h, resolution)
        h_kpis = _compute_kpis(h_rows)
        horizon_curve.append({
            "horizon_hours": h,
            "mae_mw": h_kpis.mae_mw,
            "rmse_mw": h_kpis.rmse_mw,
            "bias_mw": h_kpis.bias_mw,
            "p90_shortfall_mw": h_kpis.p90_shortfall_mw,
        })

    # Diurnal profile (hour 0..23 UTC)
    diurnal: Dict[int, List[Dict[str, Any]]] = {}
    for r in rows:
        hour = _parse_iso(r["startTime"]).hour
        diurnal.setdefault(hour, []).append(r)
    diurnal_profile: List[Dict[str, Any]] = []
    for hour in range(24):
        hour_rows = diurnal.get(hour, [])
        if hour_rows:
            k = _compute_kpis(hour_rows)
            diurnal_profile.append({
                "hour": hour,
                "avg_actual_mw": k.avg_actual_mw,
                "avg_forecast_mw": k.avg_forecast_mw,
                "mae_mw": k.mae_mw,
                "bias_mw": k.bias_mw,
                "p90_shortfall_mw": k.p90_shortfall_mw,
                "sample_count": k.sample_count,
            })
        else:
            diurnal_profile.append({
                "hour": hour,
                "avg_actual_mw": 0.0,
                "avg_forecast_mw": 0.0,
                "mae_mw": 0.0,
                "bias_mw": 0.0,
                "p90_shortfall_mw": 0.0,
                "sample_count": 0,
            })

    # Error histogram (binned distribution of forecast - actual residuals)
    errors = [r["error_mw"] for r in rows]
    histogram: List[Dict[str, Any]] = []
    if errors:
        e_min, e_max = min(errors), max(errors)
        bin_count = 10
        bin_width = (e_max - e_min) / bin_count if e_max > e_min else 1.0
        for i in range(bin_count):
            lo = e_min + i * bin_width
            hi = e_min + (i + 1) * bin_width
            count = sum(1 for e in errors if lo <= e < hi or (i == bin_count - 1 and e == e_max))
            histogram.append({"bin": f"{lo:.1f} to {hi:.1f}", "count": count})

    # Worst shortfalls (top 10 over-forecast intervals)
    worst_shortfalls = sorted(rows, key=lambda x: x["shortfall_mw"], reverse=True)[:10]

    return {
        "kpis": asdict(kpis),
        "timeseries": rows,
        "horizon_curve": horizon_curve,
        "diurnal_profile": diurnal_profile,
        "error_histogram": histogram,
        "worst_shortfalls": worst_shortfalls,
    }