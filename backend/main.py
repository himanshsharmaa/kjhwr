"""FastAPI application for the UK Energy Utility Day-Ahead Wind Procurement Portal."""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

import analytics
from elexon_client import refresh_cache

app = FastAPI(title="UK Energy Utility Day-Ahead Wind Procurement & Forecast Accuracy Portal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard(
    start_date: Optional[str] = Query(None, description="Filter start date (ISO 8601)"),
    end_date: Optional[str] = Query(None, description="Filter end date (ISO 8601)"),
    date_basis: str = Query("delivery_date", description="decision_date or delivery_date"),
    mode: str = Query("gate_closure", description="gate_closure or horizon"),
    cutoff_hour: int = Query(11, description="Gate closure hour in UTC (default 11 for UK day-ahead auction)"),
    horizon_hours: Optional[int] = Query(None, description="Horizon in hours (1-48) for horizon mode"),
    resolution: str = Query("half_hourly", description="hourly or half_hourly"),
) -> dict:
    return analytics.compute_dashboard(
        start_date=start_date,
        end_date=end_date,
        date_basis=date_basis,
        mode=mode,
        cutoff_hour=cutoff_hour,
        horizon_hours=horizon_hours,
        resolution=resolution,
    )


@app.post("/api/refresh-cache")
def refresh_cache_endpoint() -> dict:
    result = refresh_cache()
    return {
        "status": "refreshed",
        "source": result.get("source", "unknown"),
        "fetched_at": result.get("fetched_at"),
        "actuals_count": len(result.get("actuals", [])),
        "forecasts_count": len(result.get("forecasts", [])),
    }