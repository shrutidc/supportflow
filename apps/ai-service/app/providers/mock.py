"""
Deterministic provider for tests, CI, and the free demo.

Not a toy: it is the default, so the whole system runs with no API key, no
network, and no cost. Every response is derived from the prompt by keyword, so
the same ticket always produces the same answer and tests can assert on it.

Its evidence quotes are copied verbatim out of the ticket, which means the
grounding checks pass honestly rather than being bypassed in test.
"""

import re
from typing import Any

from ..contracts import Usage
from .base import StructuredResult

_HIGH_SIGNALS = (
    "urgent", "asap", "immediately", "critical", "outage", "down",
    "cannot access", "can't access", "blocked", "production", "data loss",
    "breach", "security", "escalate",
)
_LOW_SIGNALS = ("question", "clarification", "how do i", "documentation", "when convenient")


def _first_sentence(text: str, limit: int = 160) -> str:
    sentence = re.split(r"(?<=[.!?])\s+", text.strip())[0] if text.strip() else ""
    return sentence[:limit].strip()


def _pick(options: list[str], wanted: str, fallback_index: int = 0) -> str:
    """Choose from the caller's taxonomy, never inventing a value."""
    for option in options:
        if option.lower() == wanted.lower():
            return option
    for option in options:
        if wanted.lower() in option.lower() or option.lower() in wanted.lower():
            return option
    return options[min(fallback_index, len(options) - 1)]


class MockProvider:
    name = "mock"

    def __init__(self) -> None:
        self._model = "mock-deterministic"

    async def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.1,
    ) -> StructuredResult:
        lowered = user_prompt.lower()

        # The prompt embeds messages as "[<id>] <sender>: <body>"; parse them
        # back so quotes can be lifted verbatim from real content.
        messages = re.findall(r"^\[([^\]]+)\]\s+(customer|agent):\s*(.*)$", user_prompt, re.M)
        first_id, _, first_body = messages[0] if messages else ("m1", "customer", "")

        taxonomy = self._parse_taxonomy(user_prompt)
        is_high = any(signal in lowered for signal in _HIGH_SIGNALS)
        is_low = not is_high and any(signal in lowered for signal in _LOW_SIGNALS)
        priority = "High" if is_high else ("Low" if is_low else "Medium")

        quote = _first_sentence(first_body) or first_body[:120]
        evidence = (
            [{
                "message_id": first_id,
                "quote": quote,
                "reason": "Opening description of the problem",
            }]
            if quote
            else []
        )

        if "triage" in system_prompt.lower():
            data: dict[str, Any] = {
                "category": _pick(taxonomy["categories"], "Incident" if is_high else "Request"),
                "priority": _pick(taxonomy["priorities"], priority, 1),
                "urgency": _pick(taxonomy["priorities"], priority, 1),
                "recommended_queue": _pick(
                    taxonomy["queues"],
                    "Billing and Payments" if "billing" in lowered or "invoice" in lowered
                    else "Technical Support",
                ),
                "should_escalate": is_high,
                "confidence": 0.82 if is_high or is_low else 0.68,
                "reasoning_summary": (
                    "Language indicates production impact and time pressure."
                    if is_high
                    else "Routine request with no urgency signals in the text."
                ),
                "evidence": evidence,
                "missing_information": [] if is_high else ["Affected environment", "Steps to reproduce"],
            }
        else:
            data = {
                "headline": _first_sentence(first_body) or "Customer reported an issue.",
                "extracted_facts": (
                    [{"statement": quote, "evidence": evidence}] if quote else []
                ),
                "inference": [
                    "Appears to be blocking the customer's work."
                    if is_high
                    else "Does not appear time-critical."
                ],
                "actions_attempted": [],
                "customer_goal": "Resolution of the reported problem.",
                "current_blocker": "Awaiting agent response." if is_high else None,
                "missing_information": ["Affected environment"],
                "suggested_next_action": (
                    "Acknowledge and escalate to the owning team."
                    if is_high
                    else "Acknowledge and request the missing details."
                ),
            }

        return StructuredResult(
            data=data,
            # Rough proxy so cost and latency plumbing is exercised end to end
            # rather than only under a real provider.
            usage=Usage(
                input_tokens=len(user_prompt) // 4,
                output_tokens=80,
            ),
            model=self._model,
        )

    @staticmethod
    def _parse_taxonomy(prompt: str) -> dict[str, list[str]]:
        """Read back the allowed values the prompt declares."""
        def values(label: str, fallback: list[str]) -> list[str]:
            match = re.search(rf"^{label}:\s*(.+)$", prompt, re.M)
            if not match:
                return fallback
            found = [item.strip() for item in match.group(1).split("|") if item.strip()]
            return found or fallback

        return {
            "categories": values("Allowed categories", ["Request"]),
            "queues": values("Allowed queues", ["Technical Support"]),
            "priorities": values("Allowed priorities", ["Low", "Medium", "High"]),
        }
