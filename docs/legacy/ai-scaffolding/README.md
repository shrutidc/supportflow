# Legacy AI Scaffolding (quarantined 2026-07-14)

These files were committed to `server/` as groundwork for AI features but were
**never imported or wired into the running application**. They are preserved
here as design reference and removed from the app source to keep it clean.

## What's here

| File | What it was |
|---|---|
| `llm-client.js` | Provider-abstraction LLM client (IBM watsonx + mock provider). Never imported. |
| `models/AgentDecision.js` | Per-agent decision log (triage/duplicate/resolution/...). Never imported. |
| `models/KnowledgeArticle.js` | Knowledge base article with embedding field. Never imported. |
| `models/SentimentLog.js` | Sentiment/churn-risk log. Never imported. |
| `models/WeeklyReport.js` | AI-generated weekly ops report. Never imported. |
| `models/EvaluationRun.js` | Evaluation harness results. Never imported (the harness itself was never written; the `npm run eval` script it referenced crashed). |
| `models/Ticket.aiAssist-expanded.js` | An uncommitted expansion of the live `Ticket` schema embedding triage/routing/resolution results in an `aiAssist` sub-document. Reverted from the live model. |

## Why quarantined instead of wired

The target architecture (see the SupportFlow transformation plan) differs from
this scaffolding in load-bearing ways:

- **AI provider**: Anthropic Claude + OpenAI embeddings via a Python/FastAPI
  AI service — not an in-process watsonx client.
- **Data model**: normalized `AIDecision` collection with `organizationId`,
  prompt versions, evidence, cost/latency, and human accept/override tracking —
  not an embedded `aiAssist` sub-document on `Ticket`.
- **Tenancy**: every collection carries `organizationId`; none of these models do.

Rebuilding these features against the target schema (Phases 4–8) is cheaper
and safer than migrating this unwired draft. The mock-response patterns in
`llm-client.js` remain useful as fixtures for tests and local development.
