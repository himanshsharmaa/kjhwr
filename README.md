# kjhwr — UK Day-Ahead Wholesale Market Wind Procurement & Forecast Accuracy Portal

A full-stack web application for analyzing wind forecast accuracy in the UK Day-Ahead Wholesale Electricity Market. The portal provides point-in-time forecast matching against actual wind generation, KPI dashboards, and procurement risk analytics.

## Project Overview

This portal implements the **UK Day-Ahead Wholesale Market methodology** for wind procurement analysis:

### D-1 11:00 UTC Gate Closure
The UK day-ahead electricity auction closes at **11:00 UTC on day D-1** for delivery on day D. Market participants must submit their final wind generation forecasts by this deadline. The portal models this by matching each delivery interval against the latest available forecast published **before 11:00 UTC on the prior day**.

### Point-in-Time `WINDFOR` Matching
The Elexon `WINDFOR` dataset provides hourly wind forecasts with multiple publish times. For each delivery hour, the portal selects the **most recent forecast published before the gate closure cutoff** — ensuring no look-ahead bias. This replicates the information actually available to traders at decision time.

### 30-min `FUELHH` vs 60-min `WINDFOR` Alignment
- **Actuals (`FUELHH`)**: 30-minute resolution wind generation data
- **Forecasts (`WINDFOR`)**: Hourly resolution forecasts

The portal linearly interpolates hourly forecasts onto the 30-minute actuals grid, enabling direct comparison at the same temporal resolution.

### P90 Shortfall Risk Buffering
Procurement risk is quantified using **P90 shortfall** (the 90th percentile of forecast-over-actual errors). This represents the shortfall level that will not be exceeded in 90% of intervals — a standard risk metric for hedging and imbalance pricing.

---

## Directory & File Structure

```
kjhwr/
├── api/
│   └── index.py                 # Vercel Python Serverless Function entry point
├── backend/
│   ├── __init__.py
│   ├── main.py                  # FastAPI application with /api/* endpoints
│   ├── analytics.py             # Point-in-time forecast matching & KPI computation
│   ├── elexon_client.py         # Elexon BMRS API client with caching & fallback
│   ├── requirements.txt         # Python dependencies
│   ├── Dockerfile               # Backend container definition
│   └── data/
│       └── jan2026_cache.json   # Cached Elexon data (actuals + forecasts)
├── frontend/
│   ├── src/
│   │   ├── main.tsx             # React entry point
│   │   ├── App.tsx              # Main dashboard component
│   │   └── index.css            # Tailwind CSS imports
│   ├── index.html               # HTML template
│   ├── package.json             # npm dependencies & scripts
│   ├── tsconfig.json            # TypeScript configuration
│   ├── vite.config.ts           # Vite build configuration
│   ├── tailwind.config.js       # Tailwind CSS configuration
│   ├── postcss.config.js        # PostCSS configuration
│   ├── nginx.conf               # nginx reverse proxy config
│   └── Dockerfile               # Frontend multi-stage container definition
├── docker-compose.yml           # Full-stack orchestration
├── vercel.json                  # Vercel deployment configuration
└── README.md                    # This file
```

---

## Running Locally

### Prerequisites
- Python 3.11+
- Node.js 20+
- npm 10+

### Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
API available at `http://localhost:8000`

### Frontend (Vite + React)
```bash
cd frontend
npm install
npm run dev
```
Frontend available at `http://localhost:5173` (proxies `/api/*` to backend)

### Full Stack via Docker Compose
```bash
docker compose up --build
```
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`

The Docker setup includes health checks and proper service dependencies.

---

## Vercel Deployment

### Live URL
**Placeholder**: `https://kjhwr.vercel.app` — replace after deployment

### Repository
**GitHub**: `https://github.com/himanshsharmaa/kjhwr`

### Deployment Steps
1. Push this repository to GitHub
2. Import the repository in Vercel
3. Vercel will auto-detect the `vercel.json` configuration:
   - Builds `frontend/dist` as static assets
   - Routes `/api/*` to `api/index.py` (Python 3.11 serverless function)
   - SPA fallback to `index.html` for client-side routing

### Environment Variables
No environment variables required — the Elexon API is public and the cache is bundled.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/dashboard` | GET | Full dashboard data (KPIs, timeseries, horizon curve, diurnal profile, histogram, worst shortfalls) |
| `/api/refresh-cache` | POST | Force re-fetch from Elexon API and update local cache |

### Dashboard Query Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start_date` | string (ISO 8601) | — | Filter start date |
| `end_date` | string (ISO 8601) | — | Filter end date |
| `date_basis` | `delivery_date` \| `decision_date` | `delivery_date` | Filter basis |
| `mode` | `gate_closure` \| `horizon` | `gate_closure` | Matching mode |
| `cutoff_hour` | integer | `11` | Gate closure hour (UTC) |
| `horizon_hours` | integer (1-48) | — | Horizon for `horizon` mode |
| `resolution` | `hourly` \| `half_hourly` | `half_hourly` | Output resolution |

---

## Data Sources

- **Actual Generation**: Elexon BMRS `FUELHH` dataset (30-min resolution, fuel type WIND)
- **Forecasts**: Elexon BMRS `WINDFOR` dataset (hourly resolution, multiple publish times)
- **Cache**: `backend/data/jan2026_cache.json` — pre-populated for January 2026 delivery period

The `elexon_client.py` implements a three-tier data strategy:
1. **Local cache** (fastest, used by default)
2. **Live Elexon API** (on cache miss or manual refresh)
3. **Deterministic fallback** (realistic synthetic data if API unavailable)

---

## AI Tools Disclosure

**AI coding assistants (GitHub Copilot / LLMs) were used for:**
- UI scaffolding and React component boilerplate
- Dockerfile and docker-compose.yml generation
- Vercel configuration (`vercel.json`)
- Documentation formatting and Markdown structure
- TypeScript type definitions and Vite/Tailwind configuration

**Human-engineered and validated:**
- Domain modeling of UK Day-Ahead market mechanics (gate closure, D-1 timing)
- Point-in-time data join logic (no look-ahead bias, correct forecast selection)
- 30-min vs 60-min temporal alignment via linear interpolation
- P90/P95 shortfall risk metrics and procurement buffering methodology
- Elexon API client with chunked requests, caching, and deterministic fallback
- KPI computations (MAE, RMSE, MAPE, bias, percentiles)
- Horizon curve and diurnal profile analytics

All analytical code was reviewed, tested against known data patterns, and verified for correctness by a domain-knowledgeable engineer.

---

## License

MIT License — see LICENSE file for details.