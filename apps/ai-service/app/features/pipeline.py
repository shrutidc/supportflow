"""
The shared analysis pipeline.

Both features follow the same deterministic sequence, and it is written once
here rather than twice:

    redact -> build prompt -> call model -> validate schema -> verify quotes
    -> adjust confidence -> return

No agent loop, no tool calling, no self-directed retries. Every step is
inspectable and the whole thing is reproducible given the same input, which is
what makes the phase C evaluation meaningful — a pipeline that wanders cannot
be scored.
"""

import time
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from ..contracts import (
    AnalyzeRequest,
    AnalyzeResponse,
    Evidence,
    GroundingReport,
    TicketContext,
)
from ..grounding import adjust_confidence, verify_evidence
from ..providers import ProviderError, get_provider
from ..redact import redact
from .prompts import render_ticket, system_prompt

TOutput = TypeVar("TOutput", bound=BaseModel)


def _redact_ticket(ticket: TicketContext, mode: str) -> TicketContext:
    """Redaction happens before the prompt is built, so nothing sensitive can
    reach the provider even if prompt construction changes later."""
    return ticket.model_copy(
        update={
            "subject": redact(ticket.subject, mode),
            "messages": [
                message.model_copy(update={"body": redact(message.body, mode)})
                for message in ticket.messages
            ],
        }
    )


def _collect_evidence(output: BaseModel) -> list[Evidence]:
    """Evidence lives at the top level on triage and nested inside facts on
    summaries; grounding treats both the same."""
    items: list[Evidence] = list(getattr(output, "evidence", []) or [])
    for fact in getattr(output, "extracted_facts", []) or []:
        items.extend(fact.evidence)
    return items


def _apply_verified(output: BaseModel, keep: set[tuple[str, str]]) -> BaseModel:
    """Rebuild the output with unverifiable quotes removed."""
    updates: dict[str, Any] = {}

    if hasattr(output, "evidence"):
        updates["evidence"] = [
            item for item in output.evidence if (item.message_id, item.quote) in keep
        ]

    if hasattr(output, "extracted_facts"):
        updates["extracted_facts"] = [
            fact.model_copy(
                update={
                    "evidence": [
                        item for item in fact.evidence if (item.message_id, item.quote) in keep
                    ]
                }
            )
            for fact in output.extracted_facts
        ]

    return output.model_copy(update=updates) if updates else output


async def run_feature(
    *,
    feature: str,
    task: str,
    prompt_version: str,
    output_model: type[TOutput],
    request: AnalyzeRequest,
    stated_confidence: float | None = None,
) -> AnalyzeResponse:
    provider = get_provider()

    ticket = _redact_ticket(request.ticket, request.redaction)
    prompt = render_ticket(ticket, request.taxonomy)

    started = time.perf_counter()
    result = await provider.generate_structured(
        system_prompt=system_prompt(feature, task),
        user_prompt=prompt,
        schema=output_model.model_json_schema(),
    )
    latency_ms = int((time.perf_counter() - started) * 1000)

    try:
        output = output_model.model_validate(result.data)
    except ValidationError as exc:
        # The model returned JSON that does not fit the contract. That is a
        # failed call, not a result to hand an agent with the bad parts hidden.
        raise ProviderError(f"{feature} output failed schema validation: {exc.error_count()} error(s)") from exc

    # Quotes are checked against the *redacted* text the model actually saw;
    # checking against the original would fail every quote touching a redaction.
    sources = {message.id: message.body for message in ticket.messages}
    verified, report = verify_evidence(_collect_evidence(output), sources)
    output = _apply_verified(output, {(item.message_id, item.quote) for item in verified})

    claimed = stated_confidence if stated_confidence is not None else getattr(output, "confidence", 0.5)
    confidence = adjust_confidence(float(claimed), report)
    if hasattr(output, "confidence"):
        output = output.model_copy(update={"confidence": confidence})

    return AnalyzeResponse(
        feature=feature,
        model=result.model,
        prompt_version=prompt_version,
        latency_ms=latency_ms,
        usage=result.usage,
        grounding=report,
        confidence=confidence,
        output=output,
    )


__all__ = ["run_feature", "GroundingReport"]
