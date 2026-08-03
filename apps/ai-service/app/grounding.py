"""
Verification that quoted evidence actually appears in the ticket.

A model asked to cite its sources will sometimes produce a quote that reads
perfectly and exists nowhere — a paraphrase presented as a verbatim quotation,
or an outright invention. Shown to an agent under the heading "evidence", that
is worse than no evidence at all: it is a fabrication wearing the costume of a
citation.

So every quote is checked against the message it claims to come from. Quotes
that fail are dropped rather than displayed, and dropping any lowers the
confidence of the whole result.
"""

import re

from .contracts import Evidence, GroundingReport

# How much of a quote must match. Models routinely fix punctuation, collapse
# whitespace, or trim a trailing clause; that is not fabrication. A quote
# sharing almost no words with the source is.
_MIN_OVERLAP = 0.6


def _normalise(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def _overlap_ratio(quote: str, source: str) -> float:
    """Share of the quote's words that appear, in order, in the source."""
    quote_words = _normalise(quote).split()
    if not quote_words:
        return 0.0

    source_norm = _normalise(source)
    if _normalise(quote) in source_norm:
        return 1.0

    # Fall back to ordered word matching, which tolerates small edits without
    # accepting a quote that merely shares vocabulary with the ticket.
    source_words = source_norm.split()
    matched = 0
    cursor = 0
    for word in quote_words:
        try:
            cursor = source_words.index(word, cursor) + 1
            matched += 1
        except ValueError:
            continue
    return matched / len(quote_words)


def verify_evidence(
    evidence: list[Evidence], messages_by_id: dict[str, str]
) -> tuple[list[Evidence], GroundingReport]:
    """
    Returns the evidence that checks out, plus a report of what was discarded.

    Evidence citing an unknown message id is dropped too — a citation that
    points nowhere cannot be verified by the agent reading it either.
    """
    verified: list[Evidence] = []

    for item in evidence:
        source = messages_by_id.get(item.message_id)
        if source is None:
            continue
        if _overlap_ratio(item.quote, source) >= _MIN_OVERLAP:
            verified.append(item)

    return verified, GroundingReport(
        evidence_total=len(evidence),
        evidence_verified=len(verified),
        evidence_dropped=len(evidence) - len(verified),
    )


def adjust_confidence(stated: float, report: GroundingReport) -> float:
    """
    Scale the model's own confidence by how much of its support survived.

    A model that cites four sources and invents two of them is not 90%
    confident in any sense worth reporting, however sincerely it says so.
    """
    if report.evidence_total == 0:
        # Nothing was claimed, so nothing was fabricated — but an unsupported
        # answer should not present as a fully confident one either.
        return round(min(stated, 0.7), 3)

    verified_share = report.evidence_verified / report.evidence_total
    return round(stated * verified_share, 3)
