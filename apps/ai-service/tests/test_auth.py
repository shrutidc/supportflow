"""
The shared-secret gate.

Written after the deployed service was found accepting unauthenticated
requests. The cause was a name mismatch — this service read `INTERNAL_TOKEN`
while Express sent `AI_INTERNAL_TOKEN` — so the service saw no token
configured, and "no token configured" means "accept everything". Nothing
failed, nothing logged, and the result was a public proxy to a paid model.

The rest of the suite runs with no token set, which is why it never noticed.
These tests build an app with one configured and assert it actually refuses.
"""

import importlib

import pytest
from fastapi.testclient import TestClient

TOKEN = "test-internal-token"


@pytest.fixture
def secured_client(monkeypatch) -> TestClient:
    """An app instance built with a token configured."""
    monkeypatch.setenv("AI_INTERNAL_TOKEN", TOKEN)
    monkeypatch.setenv("AI_PROVIDER", "mock")

    # config resolves settings at import, so both modules are reloaded to pick
    # the patched environment up.
    from app import config

    importlib.reload(config)
    from app import main

    importlib.reload(main)

    yield TestClient(main.app)

    # Restore the unconfigured app the rest of the suite expects.
    monkeypatch.delenv("AI_INTERNAL_TOKEN", raising=False)
    importlib.reload(config)
    importlib.reload(main)


BODY = {
    "ticket": {
        "subject": "Test",
        "status": "New",
        "messages": [{"id": "m1", "sender": "customer", "body": "Something is broken."}],
    },
    "taxonomy": {
        "categories": ["Incident"],
        "queues": ["Technical Support"],
        "priorities": ["Low", "Medium", "High"],
    },
}


class TestTokenIsEnforced:
    def test_a_request_with_no_token_is_refused(self, secured_client):
        response = secured_client.post("/v1/triage", json=BODY)
        assert response.status_code == 401

    def test_a_request_with_the_wrong_token_is_refused(self, secured_client):
        response = secured_client.post(
            "/v1/triage", json=BODY, headers={"X-Internal-Token": "not-the-token"}
        )
        assert response.status_code == 401

    def test_a_near_miss_token_is_refused(self, secured_client):
        # Trailing whitespace from a copy-paste is a realistic mistake and must
        # not be quietly accepted.
        response = secured_client.post(
            "/v1/triage", json=BODY, headers={"X-Internal-Token": TOKEN + " "}
        )
        assert response.status_code == 401

    def test_the_correct_token_is_accepted(self, secured_client):
        response = secured_client.post(
            "/v1/triage", json=BODY, headers={"X-Internal-Token": TOKEN}
        )
        assert response.status_code == 200

    def test_summarize_is_gated_too(self, secured_client):
        assert secured_client.post("/v1/summarize", json=BODY).status_code == 401

    def test_health_stays_open_for_probes(self, secured_client):
        # Deployment platforms need an unauthenticated liveness check.
        assert secured_client.get("/healthz").status_code == 200


class TestUnconfiguredIsOpen:
    """Documents the local-development behaviour, so that it is a deliberate
    choice rather than something discovered on a live deployment."""

    def test_without_a_token_every_request_is_accepted(self, client):
        assert client.post("/v1/triage", json=BODY).status_code == 200
