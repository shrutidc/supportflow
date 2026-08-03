"""Environment configuration, validated once at import."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    provider: str
    gemini_api_key: str
    gemini_model: str
    internal_token: str
    request_timeout_seconds: float

    @property
    def uses_real_model(self) -> bool:
        return self.provider != "mock"


def load_settings() -> Settings:
    # Mock is the default on purpose: tests, CI, and the deployed demo all run
    # without an API key, without network access, and at no cost. A real
    # provider is opt-in via AI_PROVIDER.
    provider = os.getenv("AI_PROVIDER", "mock").strip().lower()
    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if provider == "gemini" and not gemini_api_key:
        raise RuntimeError(
            "AI_PROVIDER=gemini but GEMINI_API_KEY is unset. "
            "Get a free key at https://aistudio.google.com, or unset "
            "AI_PROVIDER to run against the mock provider."
        )

    if provider not in {"mock", "gemini"}:
        raise RuntimeError(f"Unknown AI_PROVIDER: {provider!r} (expected 'mock' or 'gemini')")

    return Settings(
        provider=provider,
        gemini_api_key=gemini_api_key,
        # A floating alias, not a pinned version, because every pinned model
        # tested reports `limit: 0` on the free tier — there is no free quota
        # to pin to. The alias drifts as Google moves it, so the provider
        # records the *resolved* version from each response rather than this
        # name, keeping evaluation results attributable to a real model.
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-flash-latest"),
        # Shared secret between the Express API and this service. Empty means
        # unauthenticated, which is only acceptable locally.
        internal_token=os.getenv("INTERNAL_TOKEN", "").strip(),
        request_timeout_seconds=float(os.getenv("REQUEST_TIMEOUT_SECONDS", "30")),
    )


settings = load_settings()
