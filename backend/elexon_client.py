"""Elexon BMRS API client with local JSON cache and deterministic fallback."""

from __future__ import annotations

import json
import math
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "jan2026_cache.json")

ACTUALS_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream"
FORECASTS_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream"

ACTUALS_START = "2025-12-30T00:00:00Z"
ACTUALS_END = "2026-02-02T23:59:59Z"
FORECASTS_START = "2025-12-29T00:00:00Z"
FORECASTS_END = "2026-02-02T23:59:59Z"

CHUNK_DAYS = 7
REQUEST_TIMEOUT = 10.0


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _format_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _chunk_ranges(start_str: str, end_str: str, days: int) -> List[tuple]:
    start = _parse_iso(start_str)
    end = _parse_iso(end_str)
    chunks: List[tuple] = []
    current = start
    while current < end:
        chunk_end = min(current + timedelta(days=days), end)
        chunks.append((current, chunk_end))
        current = chunk_end
    return chunks


def _load_cache() -> Optional[Dict[str, Any]]:
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _save_cache(data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _extract_records(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "items", "results"):
            if key in payload and isinstance(payload[key], list):
                return payload[key]
    return []


def _fetch_actuals_chunked() -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
        for chunk_start, chunk_end in _chunk_ranges(ACTUALS_START, ACTUALS_END, CHUNK_DAYS):
            params = {
                "settlementDateFrom": chunk_start.strftime("%Y-%m-%d"),
                "settlementDateTo": chunk_end.strftime("%Y-%m-%d"),
            }
            try:
                resp = client.get(ACTUALS_URL, params=params)
                resp.raise_for_status()
                records.extend(_extract_records(resp.json()))
            except Exception:
                continue
    return records


def _fetch_forecasts_chunked() -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
        for chunk_start, chunk_end in _chunk_ranges(FORECASTS_START, FORECASTS_END, CHUNK_DAYS):
            params = {
                "publishDateTimeFrom": _format_iso(chunk_start),
                "publishDateTimeTo": _format_iso(chunk_end),
            }
            try:
                resp = client.get(FORECASTS_URL, params=params)
                resp.raise_for_status()
                records.extend(_extract_records(resp.json()))
            except Exception:
                continue
    return records


def _generate_fallback_actuals(start: datetime, end: datetime) -> List[Dict[str, Any]]:
    """Deterministic realistic fallback for actual wind generation (30-min resolution)."""
    rng = random.Random(42)
    records: List[Dict[str, Any]] = []
    current = start.replace(minute=0, second=0, microsecond=0)
    if current.minute not in (0, 30):
        current = current.replace(minute=0) + timedelta(minutes=30)
    base = _parse_iso(ACTUALS_START)
    while current <= end:
        days_since = (current - base).total_seconds() / 86400.0
        seasonal = 1.0 + 0.3 * math.sin(2 * math.pi * days_since / 30.0)
        diurnal = 1.0 + 0.15 * math.sin(2 * math.pi * current.hour / 24.0 + 1.0)
        base_mw = 4000.0 * seasonal * diurnal
        noise = rng.gauss(0, 800)
        generation = max(0.0, base_mw + noise)
        records.append({
            "startTime": _format_iso(current),
            "fuelType": "WIND",
            "generation": round(generation, 1),
        })
        current += timedelta(minutes=30)
    return records


def _generate_fallback_forecasts(start: datetime, end: datetime) -> List[Dict[str, Any]]:
    """Deterministic realistic fallback for wind forecasts (hourly, multiple publish times)."""
    rng = random.Random(123)
    records: List[Dict[str, Any]] = []
    current = start.replace(minute=0, second=0, microsecond=0)
    while current <= end:
        for lead in range(1, 49):
            publish = current
            delivery = publish + timedelta(hours=lead)
            if delivery > end:
                break
            days_since = (delivery - _parse_iso(ACTUALS_START)).total_seconds() / 86400.0
            seasonal = 1.0 + 0.3 * math.sin(2 * math.pi * days_since / 30.0)
            diurnal = 1.0 + 0.15 * math.sin(2 * math.pi * delivery.hour / 24.0 + 1.0)
            base_mw = 4000.0 * seasonal * diurnal
            forecast_error = rng.gauss(100, 600)
            generation = max(0.0, base_mw + forecast_error)
            records.append({
                "startTime": _format_iso(delivery),
                "publishTime": _format_iso(publish),
                "generation": round(generation, 1),
            })
        current += timedelta(hours=1)
    return records


def get_actuals() -> List[Dict[str, Any]]:
    """Return actual wind generation records (cache > API > fallback)."""
    cache = _load_cache()
    if cache and cache.get("actuals"):
        return cache["actuals"]
    try:
        actuals = _fetch_actuals_chunked()
        if actuals:
            return actuals
    except Exception:
        pass
    return _generate_fallback_actuals(_parse_iso(ACTUALS_START), _parse_iso(ACTUALS_END))


def get_forecasts() -> List[Dict[str, Any]]:
    """Return wind forecast records (cache > API > fallback)."""
    cache = _load_cache()
    if cache and cache.get("forecasts"):
        return cache["forecasts"]
    try:
        forecasts = _fetch_forecasts_chunked()
        if forecasts:
            return forecasts
    except Exception:
        pass
    return _generate_fallback_forecasts(_parse_iso(FORECASTS_START), _parse_iso(FORECASTS_END))


def refresh_cache() -> Dict[str, Any]:
    """Force re-fetch from API (with fallback) and save both datasets to cache."""
    source = "api"
    try:
        actuals = _fetch_actuals_chunked()
    except Exception:
        actuals = []
        source = "fallback"
    if not actuals:
        actuals = _generate_fallback_actuals(_parse_iso(ACTUALS_START), _parse_iso(ACTUALS_END))
        source = "fallback"

    try:
        forecasts = _fetch_forecasts_chunked()
        if source == "api" and not forecasts:
            forecasts = []
            source = "fallback"
    except Exception:
        forecasts = []
        source = "fallback"
    if not forecasts:
        forecasts = _generate_fallback_forecasts(_parse_iso(FORECASTS_START), _parse_iso(FORECASTS_END))
        source = "fallback"

    cache_data = {
        "actuals": actuals,
        "forecasts": forecasts,
        "fetched_at": _format_iso(datetime.now(timezone.utc)),
        "source": source,
    }
    _save_cache(cache_data)
    return cache_data