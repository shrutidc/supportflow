"""
SupportFlow AI service.

Deliberately small surface: two analysis endpoints and a health check. It has
no database credentials and no ticket ids — Express hands it content it has
already authorized and scoped, and stores whatever comes back. That means this
service cannot modify a ticket even if it is compromised or successfully
prompt-injected, which is a property of the deployment rather than a promise
about the code.
"""

import logging
import secrets
import time
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .config import settings
from .contracts import AnalyzeRequest, AnalyzeResponse
from .features.summarize import summarize
from .features.triage import triage
from .providers import ProviderError

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("ai-service")

app = FastAPI(
    title="SupportFlow AI service",
    version="1.0.0",
    # No interactive docs in production: the schemas describe the internal
    # contract and there is no reason to publish them.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# Said loudly at startup because the failure is otherwise invisible: with no
# token every request is accepted, and a deployment reachable from the
# internet becomes an open proxy to a paid model. That is fine locally and
# never fine deployed, and the only signal used to be silence.
if not settings.internal_token:
    logger.warning(
        '{"event":"no_internal_token","detail":"AI_INTERNAL_TOKEN is unset — '
        'every request will be accepted. Acceptable locally; never for a '
        'deployment reachable from the internet."}'
    )


async def require_internal_token(
    x_internal_token: str | None = Header(default=None),
) -> None:
    """
    Shared secret between Express and this service.

    Empty means unauthenticated, which is only acceptable locally — the service
    is not intended to be reachable from the public internet.
    """
    if not settings.internal_token:
        return
    if not x_internal_token or not secrets.compare_digest(
        x_internal_token, settings.internal_token
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.middleware("http")
async def request_context(request: Request, call_next):
    """
    Propagates the caller's request id so a trace spans both services, and logs
    timing without logging ticket content.
    """
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    started = time.perf_counter()

    response = await call_next(request)

    duration_ms = int((time.perf_counter() - started) * 1000)
    response.headers["x-request-id"] = request_id
    logger.info(
        '{"reqId":"%s","method":"%s","path":"%s","status":%d,"durationMs":%d}',
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
    # The model being unavailable or returning garbage is an upstream fault,
    # not a bad request. Express degrades to an error card rather than failing
    # the ticket page.
    logger.warning('{"event":"provider_error","error":"%s"}', exc)
    return JSONResponse(status_code=502, content={"error": "AI provider unavailable"})


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "provider": settings.provider}


@app.post(
    "/v1/summarize",
    response_model=AnalyzeResponse,
    dependencies=[Depends(require_internal_token)],
)
async def summarize_endpoint(request: AnalyzeRequest) -> AnalyzeResponse:
    return await summarize(request)


@app.post(
    "/v1/triage",
    response_model=AnalyzeResponse,
    dependencies=[Depends(require_internal_token)],
)
async def triage_endpoint(request: AnalyzeRequest) -> AnalyzeResponse:
    return await triage(request)
