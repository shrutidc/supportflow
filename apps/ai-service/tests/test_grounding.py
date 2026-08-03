from app.contracts import Evidence, GroundingReport
from app.grounding import adjust_confidence, verify_evidence

SOURCE = {
    "m1": "Our production integration started returning 500 errors at 09:00 UTC "
          "and is completely blocked.",
    "m2": "We tried rotating the API key but it made no difference.",
}


def ev(message_id: str, quote: str) -> Evidence:
    return Evidence(message_id=message_id, quote=quote, reason="test")


class TestVerification:
    def test_exact_quote_is_kept(self):
        verified, report = verify_evidence([ev("m1", "returning 500 errors at 09:00 UTC")], SOURCE)
        assert len(verified) == 1
        assert report.evidence_dropped == 0
        assert report.all_verified

    def test_minor_edits_are_tolerated(self):
        # Models routinely fix punctuation or casing. That is not fabrication.
        verified, _ = verify_evidence([ev("m1", "Production integration started returning 500 errors!")], SOURCE)
        assert len(verified) == 1

    def test_invented_quote_is_dropped(self):
        verified, report = verify_evidence(
            [ev("m1", "we have lost all customer data and are considering legal action")], SOURCE
        )
        assert verified == []
        assert report.evidence_dropped == 1
        assert not report.all_verified

    def test_quote_attributed_to_the_wrong_message_is_dropped(self):
        # The words exist in the ticket, but not where the model says.
        verified, report = verify_evidence([ev("m2", "returning 500 errors")], SOURCE)
        assert verified == []
        assert report.evidence_dropped == 1

    def test_citation_to_an_unknown_message_is_dropped(self):
        verified, report = verify_evidence([ev("does-not-exist", "anything")], SOURCE)
        assert verified == []
        assert report.evidence_dropped == 1

    def test_mixed_evidence_keeps_only_what_checks_out(self):
        verified, report = verify_evidence(
            [ev("m1", "completely blocked"), ev("m1", "the CEO has threatened to churn")],
            SOURCE,
        )
        assert len(verified) == 1
        assert report.evidence_total == 2
        assert report.evidence_verified == 1


class TestConfidenceAdjustment:
    def test_fully_grounded_confidence_is_unchanged(self):
        report = GroundingReport(evidence_total=2, evidence_verified=2, evidence_dropped=0)
        assert adjust_confidence(0.9, report) == 0.9

    def test_half_fabricated_halves_confidence(self):
        report = GroundingReport(evidence_total=2, evidence_verified=1, evidence_dropped=1)
        assert adjust_confidence(0.9, report) == 0.45

    def test_entirely_fabricated_collapses_confidence(self):
        report = GroundingReport(evidence_total=3, evidence_verified=0, evidence_dropped=3)
        assert adjust_confidence(0.95, report) == 0.0

    def test_unsupported_answer_is_capped(self):
        # Nothing was fabricated, but nothing was cited either — that should
        # not present as certainty.
        report = GroundingReport(evidence_total=0, evidence_verified=0, evidence_dropped=0)
        assert adjust_confidence(0.99, report) == 0.7
