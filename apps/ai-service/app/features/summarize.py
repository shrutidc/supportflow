"""Ticket summarisation."""

from ..contracts import AnalyzeRequest, AnalyzeResponse, SummaryOutput
from .pipeline import run_feature

PROMPT_VERSION = "summarize/v1"

_TASK = """Summarise this ticket for an agent picking it up cold.

Separate what the ticket states from what you infer:
- extracted_facts: statements the ticket actually makes, each with a verbatim
  quote from the message it came from.
- inference: your reading of the situation. Never phrase inference as fact.

Also identify what the customer wants, what is blocking it, what has already
been tried, what information is missing, and the single most useful next action.
Keep the headline to one sentence."""


async def summarize(request: AnalyzeRequest) -> AnalyzeResponse:
    return await run_feature(
        feature="summarize",
        task=_TASK,
        prompt_version=PROMPT_VERSION,
        output_model=SummaryOutput,
        request=request,
        # A summary carries no self-reported confidence — there is no single
        # claim to be confident about — so it starts high and is reduced by
        # whatever share of its quotes fail verification.
        stated_confidence=0.9,
    )
