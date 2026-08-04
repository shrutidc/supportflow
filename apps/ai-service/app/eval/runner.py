"""
Runs triage over the held-out set and scores it against the human labels.

    python -m app.eval.runner --limit 60 [--provider gemini]

Deliberately paced: the free tier allows 20 requests per minute, so this waits
between calls rather than racing the limiter and reporting the resulting 429s
as model failures. A run of 60 tickets takes roughly seven minutes.

Scores the **same rows** the TF-IDF baseline was measured on. Comparing a
baseline evaluated on thousands of examples against an LLM evaluated on a few
hundred different ones would produce a number that means nothing, however
favourable it looked.
"""

import argparse
import asyncio
import json
import time
from pathlib import Path

from ..contracts import AnalyzeRequest
from ..features.triage import triage
from ..providers.base import ProviderError, ProviderRateLimited
from . import metrics

DATA_DIR = Path(__file__).parent / "data"
HELDOUT = DATA_DIR / "heldout.jsonl"
# Scored on the same rows this runner scores. NOT baseline_scores.json, which
# covers the full 6,530-row test set: comparing that against a 60-row LLM run
# is comparing two different populations. The first version of this file did
# exactly that, and the giveaway was the majority-class rate differing by nine
# points between the two — a number that should be identical if the rows are.
BASELINE = DATA_DIR / "baseline_on_scored_rows.json"
RESULTS = DATA_DIR / "llm_scores.json"

# The application's vocabulary. The dataset's `type` and `queue` values are the
# ground truth, so the taxonomy offered to the model has to be exactly those —
# scoring a model against labels it was never allowed to produce measures the
# harness, not the model.
PRIORITIES = ["low", "medium", "high"]

SECONDS_BETWEEN_CALLS = 4.0
RATE_LIMIT_BACKOFF = 35.0


def load_heldout(limit: int | None) -> list[dict]:
    if not HELDOUT.exists():
        raise SystemExit(
            f"{HELDOUT} not found — run notebooks/02-triage-baseline.ipynb first. "
            "It is gitignored because it is ticket text from a corpus that is "
            "not ours to redistribute."
        )
    rows = [json.loads(line) for line in HELDOUT.read_text().splitlines() if line.strip()]
    return rows[:limit] if limit else rows


def build_request(row: dict, categories: list[str], queues: list[str]) -> AnalyzeRequest:
    return AnalyzeRequest.model_validate(
        {
            "ticket": {
                "subject": row["subject"],
                "status": "New",
                "messages": [{"id": "m1", "sender": "customer", "body": row["body"]}],
            },
            "taxonomy": {
                "categories": categories,
                "queues": queues,
                "priorities": PRIORITIES,
            },
            "org_tag": "eval",
        }
    )


async def run(limit: int | None) -> dict:
    rows = load_heldout(limit)

    # Taken from the held-out set itself so the model can reach every label it
    # will be scored on.
    categories = sorted({r["type"] for r in rows})
    queues = sorted({r["queue"] for r in rows})

    predictions: dict[str, list[str]] = {"type": [], "queue": [], "priority": []}
    truths: dict[str, list[str]] = {"type": [], "queue": [], "priority": []}
    confidences: list[float] = []
    priority_correct: list[bool] = []
    latencies: list[float] = []
    tokens_in = tokens_out = 0
    failures = 0

    print(f"scoring {len(rows)} tickets · {len(categories)} types · {len(queues)} queues")

    for index, row in enumerate(rows, start=1):
        try:
            response = await triage(build_request(row, categories, queues))
        except ProviderRateLimited:
            # Pacing was still too fast. Back off and retry this row rather
            # than recording a rate limit as a wrong answer — that would score
            # the quota, not the model.
            print(f"  [{index}] rate limited, backing off {RATE_LIMIT_BACKOFF:.0f}s")
            await asyncio.sleep(RATE_LIMIT_BACKOFF)
            try:
                response = await triage(build_request(row, categories, queues))
            except ProviderError:
                failures += 1
                continue
        except ProviderError as exc:
            failures += 1
            print(f"  [{index}] failed: {exc}")
            continue

        output = response.output
        predictions["type"].append(output.category)
        predictions["queue"].append(output.recommended_queue)
        predictions["priority"].append(output.priority.lower())
        truths["type"].append(row["type"])
        truths["queue"].append(row["queue"])
        truths["priority"].append(row["priority"].lower())

        confidences.append(response.confidence)
        priority_correct.append(output.priority.lower() == row["priority"].lower())
        latencies.append(response.latency_ms)
        tokens_in += response.usage.input_tokens
        tokens_out += response.usage.output_tokens

        if index % 10 == 0:
            print(f"  [{index}/{len(rows)}] scored")

        await asyncio.sleep(SECONDS_BETWEEN_CALLS)

    scored = {
        target: metrics.score(truths[target], predictions[target], target).to_dict()
        for target in ("type", "queue", "priority")
        if truths[target]
    }
    for target, result in scored.items():
        result["majority_class"] = round(metrics.majority_class_accuracy(truths[target]), 4)

    total = len(latencies)
    return {
        "model": response.model if total else None,
        "prompt_version": response.prompt_version if total else None,
        "n_scored": total,
        "n_failed": failures,
        "targets": scored,
        "calibration": metrics.calibration_bins(confidences, priority_correct),
        "latency_ms": {
            "mean": round(sum(latencies) / total, 1) if total else 0,
            "p50": metrics.percentile(latencies, 50),
            "p95": metrics.percentile(latencies, 95),
        },
        "tokens": {"input": tokens_in, "output": tokens_out},
        # Free tier, so the honest figure is zero. Recorded anyway because the
        # token counts are what a paid deployment would be billed on, and a
        # cost comparison with the baseline is the point of the exercise.
        "estimated_cost_usd": 0.0,
    }


def wald_margin(accuracy: float, n: int) -> float:
    """95% margin of error. A 60-row run is not a precise measurement, and
    printing a bare percentage invites reading it as one."""
    if n <= 0:
        return 0.0
    return 1.96 * (accuracy * (1 - accuracy) / n) ** 0.5


def check_same_rows(results: dict, baseline: dict) -> list[str]:
    """
    The two scores must come from the same rows to be comparable.

    Majority-class rate is the cheap invariant: it depends only on the labels
    present, so identical rows give an identical value. A mismatch is proof the
    populations differ — which is what exposed the original bug, where the
    baseline covered 6,530 rows and the LLM 60.
    """
    # A tenth of a percentage point: loose enough to survive the two sides
    # storing the same fraction at different precision (0.4833 vs 0.483333),
    # tight enough that the mismatch this exists to catch — 39.2% against
    # 48.3% — is nowhere near it. An exact comparison flagged identical rows
    # as different, which is a guard nobody would keep.
    tolerance = 1e-3

    problems = []
    for target, result in results["targets"].items():
        base = baseline.get(target)
        if not base:
            problems.append(f"{target}: no baseline scored on these rows")
            continue
        if abs(base["majority_class"] - result["majority_class"]) > tolerance:
            problems.append(
                f"{target}: majority-class differs "
                f"(baseline {base['majority_class']:.1%} vs run {result['majority_class']:.1%}) "
                "— the two were not scored on the same rows"
            )
        elif base.get("n") not in (None, result["n"]):
            problems.append(f"{target}: baseline n={base['n']} but run n={result['n']}")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=60)
    args = parser.parse_args()

    started = time.time()
    results = asyncio.run(run(args.limit))
    results["wall_seconds"] = round(time.time() - started, 1)

    for target, result in results["targets"].items():
        margin = wald_margin(result["accuracy"], result["n"])
        result["accuracy_ci95"] = [
            round(max(0.0, result["accuracy"] - margin), 4),
            round(min(1.0, result["accuracy"] + margin), 4),
        ]

    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
    results["baseline"] = baseline
    results["comparison_warnings"] = check_same_rows(results, baseline) if baseline else [
        f"{BASELINE.name} not found — run notebooks/02-triage-baseline.ipynb, "
        "then score the baseline on these rows before comparing"
    ]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(results, indent=2))

    print(f"\nscored {results['n_scored']}, failed {results['n_failed']}")
    for target, result in results["targets"].items():
        base = baseline.get(target, {})
        margin = wald_margin(result["accuracy"], result["n"]) * 100
        gap = (result["accuracy"] - base.get("accuracy", 0)) * 100 if base else 0.0
        # Flagged rather than reported as a result: a gap inside the interval
        # is not a finding, and a table of bare percentages hides that.
        verdict = "within noise" if base and abs(gap) < margin else ""
        print(
            f"  {target:9s} llm {result['accuracy']:5.1%} (+/-{margin:.1f})"
            f"  baseline {base.get('accuracy', 0):5.1%}"
            f"  majority {result['majority_class']:5.1%}"
            f"  gap {gap:+5.1f} pts {verdict}"
        )

    for warning in results["comparison_warnings"]:
        print(f"\n  WARNING  {warning}")

    print(f"\nwrote {RESULTS}")


if __name__ == "__main__":
    main()
