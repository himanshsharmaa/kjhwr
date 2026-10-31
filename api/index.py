"""Vercel Python Serverless Function entry point.

Exposes the FastAPI `app` from `backend.main` so Vercel can serve `/api/*` directly.
"""

import sys
import os

# Add the project root to the path so we can import backend.main
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app

# Vercel expects the FastAPI app to be available as `app`
# This is the ASGI application that Vercel will invoke