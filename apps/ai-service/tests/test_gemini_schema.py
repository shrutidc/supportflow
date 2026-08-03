"""
Schema conversion for Gemini's `responseSchema`.

These exist because the mock provider ignores the schema entirely, so the whole
suite passed while the real provider was sending an object with **no
properties** and getting an opaque HTTP 400. Nothing that talks to a real
provider is covered by tests that only exercise the mock, so the translation
layer is tested directly.
"""

from app.contracts import SummaryOutput, TriageOutput
from app.providers.gemini import to_gemini_schema


class TestPropertiesSurvive:
    def test_triage_fields_are_not_stripped(self):
        converted = to_gemini_schema(TriageOutput.model_json_schema())
        properties = converted["properties"]

        # The original bug: the keyword allow-list was applied to the
        # properties map, whose keys are field names, emptying it entirely.
        assert properties, "properties must not be empty"
        for field in (
            "category", "priority", "urgency", "recommended_queue",
            "should_escalate", "confidence", "reasoning_summary",
            "evidence", "missing_information",
        ):
            assert field in properties, field

    def test_object_type_is_declared(self):
        assert to_gemini_schema(TriageOutput.model_json_schema())["type"] == "object"


class TestRefsAreInlined:
    def test_nested_evidence_model_is_expanded(self):
        converted = to_gemini_schema(TriageOutput.model_json_schema())
        evidence = converted["properties"]["evidence"]

        assert evidence["type"] == "array"
        item = evidence["items"]
        # Gemini understands neither $ref nor $defs.
        assert "$ref" not in item
        assert set(item["properties"]) == {"message_id", "quote", "reason"}

    def test_doubly_nested_models_are_expanded(self):
        # SummaryOutput -> Fact -> Evidence exercises two levels of $ref.
        converted = to_gemini_schema(SummaryOutput.model_json_schema())
        fact = converted["properties"]["extracted_facts"]["items"]
        assert "$ref" not in fact
        nested = fact["properties"]["evidence"]["items"]
        assert set(nested["properties"]) == {"message_id", "quote", "reason"}


class TestOptionalFields:
    def test_nullable_field_collapses_to_a_type_plus_nullable(self):
        converted = to_gemini_schema(SummaryOutput.model_json_schema())
        blocker = converted["properties"]["current_blocker"]

        # `str | None` arrives from Pydantic as anyOf, which Gemini rejects.
        assert "anyOf" not in blocker
        assert blocker["type"] == "string"
        assert blocker["nullable"] is True


class TestUnsupportedKeywordsAreRemoved:
    def test_no_pydantic_vocabulary_leaks_through(self):
        converted = to_gemini_schema(TriageOutput.model_json_schema())
        serialised = str(converted)
        for keyword in ("$defs", "$ref", "title", "default", "additionalProperties", "anyOf"):
            assert keyword not in serialised, keyword

    def test_constraints_pydantic_adds_are_dropped(self):
        # confidence has ge/le bounds; Gemini has no vocabulary for them and
        # rejects the payload if they are passed through.
        confidence = to_gemini_schema(TriageOutput.model_json_schema())["properties"]["confidence"]
        assert "minimum" not in confidence
        assert "maximum" not in confidence
        assert confidence["type"] == "number"
