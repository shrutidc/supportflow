"""
Vercel serverless entry point.

Vercel's Python runtime looks for an ASGI application named `app` in a file
under `api/`. FastAPI is already ASGI, so this re-exports the same object that
`uvicorn app.main:app` serves locally — the application is not aware it is
running serverless.

Deployed with Vercel "Root Directory" set to `apps/ai-service`, so dependencies
come from this directory's requirements.txt.
"""

import sys
from pathlib import Path

# Vercel invokes this file directly, so the package root is not on sys.path
# the way it is under `uvicorn app.main:app`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402

__all__ = ["app"]
