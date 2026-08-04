# SupportFlow AI service

Ticket text in, schema-validated JSON out. Two features: **summarize** and
**triage**.

## The design decision that matters

**This service holds no database credentials and never sees a ticket id.**

Express authorizes the request, scopes it to an organization, assembles the
ticket content, calls this service, and stores whatever comes back. So the AI
cannot modify a ticket, read another tenant's data, or reach anything it was
not handed — not because the code declines to, but because it has no way to.
That property survives a compromised service and a successful prompt injection
alike.

The application's vocabulary also arrives with each request. Categories,
queues, and priorities belong to the product, not here, so the taxonomy can
change without touching this service.

## Pipeline

Every feature runs the same deterministic sequence — no agent loop, no tool
calling, no self-directed retries:

```
redact → build prompt → call model → validate schema → verify quotes
       → adjust confidence → return
```

Determinism is what makes evaluation possible. A pipeline that wanders cannot
be scored.

## Treating ticket text as hostile

Ticket bodies are written by whoever opens a ticket. Three defences, in order
of how much weight they carry:

1. **The output schema.** The provider is constrained to emit JSON matching a
   declared shape. A ticket saying *"ignore your instructions"* still has to
   produce a valid `TriageOutput` — there is no channel to return prose, call a
   tool, or reach anything.
2. **Grounding.** Every quote is checked against the message it cites. Quotes
   that fail are discarded, and discarding any lowers the confidence of the
   whole result. A model that cites four sources and invents two is not 90%
   confident in any sense worth reporting.
3. **Delimiting and labelling** in the prompt. Useful, and the weakest of the
   three — which is why it is not relied on alone.

Classifications are additionally snapped back onto the caller's vocabulary, so
an invented queue can never be routed to.

## Redaction

Secret-shaped strings — API keys, JWTs, private key blocks, card numbers,
labelled passwords — are removed in **every** mode, including `off`. Sending a
live credential to a third-party provider is not a trade-off a caller should be
able to configure away.

Personal data (emails, phone numbers) is removed only in `strict`, because a
customer's own email is often the context that makes a ticket answerable.

## Running it

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m pytest tests/ -q          # 71 tests, no key needed
./.venv/bin/uvicorn app.main:app --port 8000
```

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | `mock` or `gemini` |
| `GEMINI_API_KEY` | — | Required only when `AI_PROVIDER=gemini` |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | See the note below |
| `AI_INTERNAL_TOKEN` | — | Shared secret with Express; **empty accepts every request** |

**Mock is the default on purpose.** Tests, CI, and the deployed demo all run
with no API key, no network, and no cost. It is deterministic and lifts its
evidence quotes verbatim from the ticket, so the grounding checks pass honestly
rather than being bypassed.

### On the model choice

**Lite, chosen by measurement.** `gemini-flash-latest` resolves to a premium
model with a free allowance of **20 requests** — exhausted in an afternoon —
answering in 10–15 seconds. `gemini-flash-lite-latest` resolves to
`gemini-3.5-flash-lite`, returns the **same classification** on the same
tickets in **~1.3 seconds**, and has quota left. Triage is short-form
classification, which is what lite models are built for; the larger model was
buying nothing.

Still a floating alias rather than a pinned version, because every *pinned*
model tested reports `limit: 0` — there is no free quota to pin to. The
provider records the **resolved** version from each response, so results stay
attributable as the alias moves.

### On rate limits

Free-tier quota is per model and easily exhausted. Two rules learned the hard
way:

- **A 429 is never retried on a short backoff.** Google's `retryDelay` is
  typically ~30s, so a 1s/3s backoff fails every attempt *and spends three more
  requests against the exhausted quota*. It is parsed and honoured instead.
- **A rate limit is not an outage.** It surfaces as 429 with `Retry-After`, so
  the caller is told to wait rather than that the service is broken.

503 and 500 are momentary and still retried. 400 and 401 never are — they will
not clear.

## Endpoints

```
GET  /healthz        → {"status":"ok","provider":"mock"}
POST /v1/summarize   → AnalyzeResponse
POST /v1/triage      → AnalyzeResponse
```

Both take `{ticket, taxonomy, org_tag?, redaction?}` and return the output plus
`model`, `prompt_version`, `latency_ms`, `usage`, `grounding`, and a
grounding-adjusted `confidence`. `org_tag` is an opaque tracing label — it is
never used to fetch anything and never sent to a provider.

Interactive docs are disabled: the schemas describe an internal contract with
no reason to be published.
