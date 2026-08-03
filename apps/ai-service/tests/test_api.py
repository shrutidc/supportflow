import copy


class TestHealth:
    def test_reports_the_active_provider(self, client):
        response = client.get("/healthz")
        assert response.status_code == 200
        # The model is reported so a deployment can be identified without
        # spending a request against a possibly-exhausted quota.
        assert response.json() == {"status": "ok", "provider": "mock", "model": "mock"}


class TestTriage:
    def test_returns_a_classification_within_the_caller_taxonomy(self, client, analyze_body):
        response = client.post("/v1/triage", json=analyze_body)
        assert response.status_code == 200
        body = response.json()

        assert body["feature"] == "triage"
        output = body["output"]
        assert output["category"] in analyze_body["taxonomy"]["categories"]
        assert output["priority"] in analyze_body["taxonomy"]["priorities"]
        assert output["recommended_queue"] in analyze_body["taxonomy"]["queues"]
        assert 0.0 <= output["confidence"] <= 1.0

    def test_urgent_production_impact_is_escalated(self, client, analyze_body):
        output = client.post("/v1/triage", json=analyze_body).json()["output"]
        assert output["priority"] == "High"
        assert output["should_escalate"] is True

    def test_a_routine_question_is_not_escalated(self, client, analyze_body):
        body = copy.deepcopy(analyze_body)
        body["ticket"]["subject"] = "Question about exporting reports"
        body["ticket"]["messages"] = [
            {
                "id": "m1",
                "sender": "customer",
                "body": "How do I export a report to CSV? No rush, just a question.",
            }
        ]
        output = client.post("/v1/triage", json=body).json()["output"]
        assert output["should_escalate"] is False
        assert output["priority"] == "Low"

    def test_evidence_quotes_are_grounded_in_the_ticket(self, client, analyze_body):
        body = client.post("/v1/triage", json=analyze_body).json()
        source = analyze_body["ticket"]["messages"][0]["body"]

        assert body["grounding"]["evidence_dropped"] == 0
        for item in body["output"]["evidence"]:
            assert item["message_id"] == "m1"
            assert item["quote"] in source

    def test_reports_model_prompt_version_latency_and_usage(self, client, analyze_body):
        body = client.post("/v1/triage", json=analyze_body).json()
        assert body["model"] == "mock-deterministic"
        assert body["prompt_version"] == "triage/v1"
        assert body["latency_ms"] >= 0
        assert body["usage"]["input_tokens"] > 0

    def test_identical_input_gives_identical_output(self, client, analyze_body):
        # Determinism is what makes the phase C evaluation reproducible.
        first = client.post("/v1/triage", json=analyze_body).json()
        second = client.post("/v1/triage", json=analyze_body).json()
        assert first["output"] == second["output"]


class TestSummarize:
    def test_separates_stated_facts_from_inference(self, client, analyze_body):
        body = client.post("/v1/summarize", json=analyze_body).json()
        output = body["output"]

        assert body["feature"] == "summarize"
        assert output["headline"]
        # The distinction is the whole point: a guess must never be presented
        # as something the customer said.
        assert "extracted_facts" in output
        assert "inference" in output

    def test_facts_carry_grounded_evidence(self, client, analyze_body):
        output = client.post("/v1/summarize", json=analyze_body).json()["output"]
        source = analyze_body["ticket"]["messages"][0]["body"]
        for fact in output["extracted_facts"]:
            for item in fact["evidence"]:
                assert item["quote"] in source


class TestValidation:
    def test_rejects_a_ticket_with_no_messages(self, client, analyze_body):
        body = copy.deepcopy(analyze_body)
        body["ticket"]["messages"] = []
        assert client.post("/v1/triage", json=body).status_code == 422

    def test_rejects_an_empty_taxonomy(self, client, analyze_body):
        body = copy.deepcopy(analyze_body)
        body["taxonomy"]["queues"] = []
        assert client.post("/v1/triage", json=body).status_code == 422

    def test_rejects_a_missing_ticket(self, client, taxonomy):
        assert client.post("/v1/triage", json={"taxonomy": taxonomy}).status_code == 422
