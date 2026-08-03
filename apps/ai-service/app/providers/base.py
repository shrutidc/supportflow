"""
The provider interface.

One method, because there is exactly one thing every feature in this service
needs: JSON conforming to a schema. Free-form text generation, streaming, and
embeddings are not here — nothing calls them yet, and an interface with unused
methods forces every future provider to implement things nobody wants.
"""

from typing import Any, Protocol

from ..contracts import Usage


class StructuredResult:
    """A model's JSON output plus what it cost to get."""

    __slots__ = ("data", "usage", "model")

    def __init__(self, data: dict[str, Any], usage: Usage, model: str) -> None:
        self.data = data
        self.usage = usage
        self.model = model


class ProviderError(RuntimeError):
    """The provider could not produce valid output.

    Raised for transport failures, refusals, and unparseable responses alike:
    from the caller's side these are the same event — no usable result — and
    each maps to the same 502 upstream.
    """


class ProviderRateLimited(ProviderError):
    """Quota is exhausted; the request would succeed later.

    Kept distinct because it is the one provider failure that is neither the
    caller's fault nor a broken service, and the only useful response is to
    wait. Collapsing it into ProviderError told users the AI was down when it
    was merely busy, which is a different instruction.
    """

    def __init__(self, retry_after_seconds: float | None = None) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"provider rate limited; retry after {retry_after_seconds or 'unknown'}s"
        )


class Provider(Protocol):
    name: str

    async def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.1,
    ) -> StructuredResult:
        """Return JSON conforming to `schema`, or raise ProviderError."""
        ...
