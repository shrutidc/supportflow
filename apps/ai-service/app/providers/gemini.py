"""
Google Gemini via its REST API.

Chosen because it has a genuinely free tier — Anthropic and OpenAI do not, and
this project has no budget. `responseSchema` makes the model emit JSON matching
a declared shape, which is what makes the output contract enforceable rather
than aspirational.
"""

import asyncio
import json
import logging
from typing import Any

import httpx

from ..contracts import Usage
from .base import ProviderError, ProviderRateLimited, StructuredResult

logger = logging.getLogger("ai-service.gemini")

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# 503 and 500 are the free tier being momentarily busy: short, and they clear
# on their own. 429 is deliberately NOT here — see _retry_delay_seconds.
# 400 and 401 never clear, so they are not retried either.
_RETRYABLE_STATUS = {503, 500}
_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (1.0, 3.0)

# A 429 whose quota resets within this window is worth waiting out inside the
# request. Beyond it the agent should be told to come back, not held on an
# open connection.
_MAX_INLINE_WAIT_SECONDS = 5.0


def _retry_delay_seconds(body: dict[str, Any]) -> float | None:
    """
    Pulls Google's own `retryDelay` out of a 429 body.

    Worth parsing because the value is typically ~30s — a per-minute quota, not
    a momentary blip. Retrying that on a 1s/3s backoff, as this once did, fails
    just as surely while spending three more requests against the same
    exhausted quota and reporting the result as an outage.
    """
    for detail in body.get("error", {}).get("details", []):
        raw = detail.get("retryDelay")
        if isinstance(raw, str) and raw.endswith("s"):
            try:
                return float(raw[:-1])
            except ValueError:
                continue
    return None


# Keywords Gemini's responseSchema understands. Everything else Pydantic
# emits — title, default, additionalProperties — is dropped.
_SUPPORTED_KEYWORDS = {
    "type", "properties", "items", "required", "enum", "description",
    "nullable", "format",
}


def to_gemini_schema(schema: dict[str, Any], defs: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Convert a Pydantic JSON schema into the subset Gemini accepts.

    Three transformations are needed, and getting any of them wrong produces an
    opaque HTTP 400:

    - **$ref/$defs are inlined.** Pydantic hoists nested models into `$defs`
      and references them; Gemini has no concept of either.
    - **`properties` is recursed into by value, not filtered by key.** Its keys
      are field names, so applying the keyword allow-list to them strips the
      entire object — which is exactly the bug this function was written to
      replace.
    - **`anyOf: [T, null]` becomes `T` plus `nullable: true`**, which is how
      Gemini expresses an optional field.
    """
    if defs is None:
        defs = schema.get("$defs", {})

    if "$ref" in schema:
        ref_name = schema["$ref"].rsplit("/", 1)[-1]
        return to_gemini_schema(defs.get(ref_name, {}), defs)

    # `str | None` arrives as anyOf. Collapse to the non-null branch.
    if "anyOf" in schema:
        branches = [b for b in schema["anyOf"] if b.get("type") != "null"]
        nullable = len(branches) < len(schema["anyOf"])
        if branches:
            converted = to_gemini_schema(branches[0], defs)
            if nullable:
                converted["nullable"] = True
            return converted
        return {"type": "string", "nullable": True}

    result: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in _SUPPORTED_KEYWORDS:
            continue
        if key == "properties":
            # Field names are data here, not schema keywords.
            result[key] = {
                name: to_gemini_schema(subschema, defs) for name, subschema in value.items()
            }
        elif key == "items":
            result[key] = to_gemini_schema(value, defs)
        else:
            result[key] = value

    if "properties" in result and "type" not in result:
        result["type"] = "object"

    return result


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout_seconds

    async def _post_with_retries(self, payload: dict[str, Any]) -> httpx.Response:
        """
        Retries the transient failures the free tier produces routinely.

        Deliberately bounded and short: this sits inside a request an agent is
        waiting on, so it is better to fail quickly and let the UI offer a
        retry than to hold the connection open through a long backoff.
        """
        url = f"{_BASE}/{self._model}:generateContent"
        last_status: int | None = None

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for attempt in range(_MAX_ATTEMPTS):
                try:
                    response = await client.post(
                        url,
                        json=payload,
                        # Header rather than query string: a key in a URL ends
                        # up in access logs and proxy traces.
                        headers={"x-goog-api-key": self._api_key},
                    )
                except httpx.HTTPError as exc:
                    raise ProviderError(f"gemini request failed: {exc}") from exc

                if response.status_code == 200:
                    return response

                last_status = response.status_code

                if response.status_code == 429:
                    delay = _retry_delay_seconds(response.json()) if response.content else None
                    if delay is not None and delay <= _MAX_INLINE_WAIT_SECONDS:
                        logger.warning('{"event":"gemini_quota_wait","seconds":%.1f}', delay)
                        await asyncio.sleep(delay)
                        continue
                    # Typically ~30s. Holding the connection open that long is
                    # worse than telling the caller to come back.
                    raise ProviderRateLimited(retry_after_seconds=delay)

                if response.status_code not in _RETRYABLE_STATUS:
                    break

                if attempt < _MAX_ATTEMPTS - 1:
                    logger.warning(
                        '{"event":"gemini_retry","status":%d,"attempt":%d}',
                        response.status_code,
                        attempt + 1,
                    )
                    await asyncio.sleep(_BACKOFF_SECONDS[attempt])

        # The body can echo the prompt back, so only the status is surfaced.
        raise ProviderError(f"gemini returned HTTP {last_status}")

    async def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.1,
    ) -> StructuredResult:
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
                "responseSchema": to_gemini_schema(schema),
            },
        }

        response = await self._post_with_retries(payload)

        body = response.json()
        candidates = body.get("candidates") or []
        if not candidates:
            # Usually a safety block — no candidate at all rather than an error.
            raise ProviderError("gemini returned no candidates")

        parts = candidates[0].get("content", {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts).strip()
        if not text:
            raise ProviderError("gemini returned an empty response")

        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"gemini returned unparseable JSON: {exc}") from exc

        meta = body.get("usageMetadata", {})
        return StructuredResult(
            data=data,
            usage=Usage(
                input_tokens=meta.get("promptTokenCount", 0),
                output_tokens=meta.get("candidatesTokenCount", 0),
            ),
            # The version Google actually served, not the alias we asked for.
            # `gemini-flash-latest` is a moving target; recording what it
            # resolved to is what lets an evaluation run stay attributable.
            model=body.get("modelVersion") or self._model,
        )
