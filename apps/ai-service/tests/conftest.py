import os

# Set before app import: config validates at module load, and the whole suite
# runs against the mock provider — no API key, no network, no cost.
os.environ.setdefault("AI_PROVIDER", "mock")
os.environ.pop("INTERNAL_TOKEN", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def taxonomy() -> dict:
    return {
        "categories": ["Incident", "Request", "Problem", "Change"],
        "queues": ["Technical Support", "Billing and Payments", "IT Support"],
        "priorities": ["Low", "Medium", "High"],
    }


@pytest.fixture
def ticket() -> dict:
    return {
        "subject": "Production API returning 500s since this morning",
        "status": "New",
        "customer_company": "Northwind Analytics",
        "messages": [
            {
                "id": "m1",
                "sender": "customer",
                "body": (
                    "Our production integration started returning 500 errors at "
                    "09:00 UTC and is completely blocked. This is urgent — "
                    "orders are not syncing."
                ),
            }
        ],
    }


@pytest.fixture
def analyze_body(ticket: dict, taxonomy: dict) -> dict:
    return {"ticket": ticket, "taxonomy": taxonomy, "org_tag": "org_test"}
