"""Provider selection. Swapping models is configuration, not a code change."""

from functools import lru_cache

from ..config import settings
from .base import Provider, ProviderError, StructuredResult
from .gemini import GeminiProvider
from .mock import MockProvider

__all__ = ["Provider", "ProviderError", "StructuredResult", "get_provider"]


@lru_cache(maxsize=1)
def get_provider() -> Provider:
    if settings.provider == "gemini":
        return GeminiProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_seconds=settings.request_timeout_seconds,
        )
    return MockProvider()
