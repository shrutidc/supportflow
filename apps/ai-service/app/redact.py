"""
Redaction applied before any text leaves for a model provider.

Ticket bodies are written by customers, who paste things they should not:
API keys, card numbers, passwords in "here's my login" messages. Once that
reaches a third-party provider it is out of our control and may be retained,
so the cheapest correct place to remove it is on the way out.

Secret-shaped strings are always removed, in every mode. Personal data —
emails, phone numbers — is configurable, because redacting a customer's own
email often destroys the very context that makes a ticket answerable.
"""

import re

from .contracts import RedactionMode

# Ordered: the most specific patterns run first, so a card number is not
# partially eaten by the generic long-digit rule.
_ALWAYS = [
    # Vendor-prefixed keys: Stripe, OpenAI, Anthropic, GitHub, Google, Slack.
    (re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b"), "[REDACTED_API_KEY]"),
    # JWTs — three base64url segments.
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b"),
     "[REDACTED_TOKEN]"),
    # Private key blocks.
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
     "[REDACTED_PRIVATE_KEY]"),
    # Card numbers: 13-19 digits, optionally spaced or dashed in groups.
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[REDACTED_CARD]"),
    # "password: hunter2", "pwd = ...", "secret: ..."
    (re.compile(r"(?i)\b(password|passwd|pwd|secret|api[_ -]?key|token)\b\s*[:=]\s*\S+"),
     r"\1: [REDACTED]"),
]

_PII = [
    (re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"), "[REDACTED_EMAIL]"),
    # Loose international phone shapes; deliberately not exhaustive.
    (re.compile(r"(?<!\w)\+?\d[\d\s().\-]{8,}\d(?!\w)"), "[REDACTED_PHONE]"),
]


def redact(text: str, mode: RedactionMode = "standard") -> str:
    """
    Apply redaction. `off` still strips secrets — that part is not optional,
    because sending a live credential to a third party is not a trade-off any
    caller should be able to configure away.
    """
    if not text:
        return text

    result = text
    for pattern, replacement in _ALWAYS:
        result = pattern.sub(replacement, result)

    if mode == "strict":
        for pattern, replacement in _PII:
            result = pattern.sub(replacement, result)

    return result


def redaction_count(original: str, redacted: str) -> int:
    """How many replacements happened — for logging without logging content."""
    return redacted.count("[REDACTED")  - original.count("[REDACTED")
