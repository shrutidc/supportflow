"""Ticket triage: category, priority, queue, and whether to escalate."""

from ..contracts import AnalyzeRequest, AnalyzeResponse, TriageOutput
from .pipeline import run_feature

PROMPT_VERSION = "triage/v1"

_TASK = """Classify this ticket so it reaches the right team at the right urgency.

Choose category, priority, urgency, and recommended_queue strictly from the
allowed values given above the ticket. Do not invent values.

Set should_escalate only when the ticket shows evidence of production impact,
data loss, a security concern, or a commitment already broken — not merely
because the customer sounds annoyed.

State confidence honestly: a vague ticket should score low. Cite the specific
quotes that drove the decision, and list what you would need to be sure."""


def _coerce_to_taxonomy(output: TriageOutput, request: AnalyzeRequest) -> TriageOutput:
    """
    Snap the classification back onto the caller's vocabulary.

    The schema constrains the *shape* of the response, not the *values* inside
    a string field, so a model can still return a plausible-looking category
    that the application has never heard of. Rather than reject the whole
    result, the closest allowed value is used — and if nothing matches, the
    first allowed value, which is the caller's own default.
    """

    def snap(value: str, allowed: list[str]) -> str:
        for option in allowed:
            if option.lower() == value.strip().lower():
                return option
        for option in allowed:
            if value.strip().lower() in option.lower() or option.lower() in value.strip().lower():
                return option
        return allowed[0]

    taxonomy = request.taxonomy
    return output.model_copy(
        update={
            "category": snap(output.category, taxonomy.categories),
            "priority": snap(output.priority, taxonomy.priorities),
            "urgency": snap(output.urgency, taxonomy.priorities),
            "recommended_queue": snap(output.recommended_queue, taxonomy.queues),
        }
    )


async def triage(request: AnalyzeRequest) -> AnalyzeResponse:
    response = await run_feature(
        feature="triage",
        task=_TASK,
        prompt_version=PROMPT_VERSION,
        output_model=TriageOutput,
        request=request,
    )
    return response.model_copy(
        update={"output": _coerce_to_taxonomy(response.output, request)}
    )
