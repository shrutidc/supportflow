"""
The wire contract between the Express API and this service.

Two properties are load-bearing:

1. **The service is given a ticket; it never fetches one.** There is no ticket
   id and no organization id here, only content that Express has already
   authorized, scoped, and redacted. The service holds no database credentials,
   so "the AI cannot mutate a ticket" is a fact about the deployment rather than
   a promise about the code.

2. **The domain vocabulary arrives with the request.** Categories, queues, and
   priorities belong to the application, not to this service. Passing them in
   means the taxonomy can change in one place and this service stays generic.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Sender = Literal["customer", "agent"]
RedactionMode = Literal["off", "standard", "strict"]


class Message(BaseModel):
    id: str
    sender: Sender
    body: str


class Taxonomy(BaseModel):
    """The vocabularies the caller will accept back."""

    categories: list[str] = Field(min_length=1)
    queues: list[str] = Field(min_length=1)
    priorities: list[str] = Field(min_length=1)


class TicketContext(BaseModel):
    subject: str
    status: str
    messages: list[Message] = Field(min_length=1)
    category: str | None = None
    priority: str | None = None
    queue: str | None = None
    customer_company: str | None = None


class LabelledExample(BaseModel):
    """A previously-classified ticket, shown to the model as a worked example."""

    subject: str
    body: str
    category: str
    queue: str
    priority: str


class AnalyzeRequest(BaseModel):
    ticket: TicketContext
    taxonomy: Taxonomy
    # Opaque tracing label. Not used to fetch anything, and never sent to a
    # model provider.
    org_tag: str = ""
    redaction: RedactionMode = "standard"
    # Optional worked examples. Empty means zero-shot, which is what the
    # product sends today; the evaluation uses this to measure what a handful
    # of labelled examples is worth against a supervised baseline that has
    # thousands. Examples must come from training data — drawing them from the
    # rows being scored would be leakage dressed up as prompting.
    examples: list[LabelledExample] = Field(default_factory=list)


class Evidence(BaseModel):
    """A claim tied to the exact message it came from."""

    message_id: str
    quote: str
    reason: str


class Fact(BaseModel):
    statement: str
    evidence: list[Evidence] = Field(default_factory=list)


class SummaryOutput(BaseModel):
    headline: str
    # Facts are things the ticket says. Inference is the model's reading of
    # them. Merging the two is how a guess ends up presented to an agent as
    # something the customer stated.
    extracted_facts: list[Fact] = Field(default_factory=list)
    inference: list[str] = Field(default_factory=list)
    actions_attempted: list[str] = Field(default_factory=list)
    customer_goal: str = ""
    current_blocker: str | None = None
    missing_information: list[str] = Field(default_factory=list)
    suggested_next_action: str = ""


class TriageOutput(BaseModel):
    category: str
    priority: str
    urgency: str
    recommended_queue: str
    should_escalate: bool
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning_summary: str
    evidence: list[Evidence] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)

    @field_validator("reasoning_summary")
    @classmethod
    def _concise(cls, value: str) -> str:
        # A decision explanation, not a transcript of the model's deliberation.
        # Hidden reasoning is never surfaced; see docs.
        return value.strip()[:600]


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class GroundingReport(BaseModel):
    """What survived verification against the source messages."""

    evidence_total: int = 0
    evidence_verified: int = 0
    evidence_dropped: int = 0

    @property
    def all_verified(self) -> bool:
        return self.evidence_dropped == 0


class AnalyzeResponse(BaseModel):
    feature: Literal["summarize", "triage"]
    model: str
    prompt_version: str
    latency_ms: int
    usage: Usage
    grounding: GroundingReport
    # Post-grounding: fabricated evidence lowers this rather than being shown
    # to an agent as support for a conclusion.
    confidence: float = Field(ge=0.0, le=1.0)
    output: SummaryOutput | TriageOutput
