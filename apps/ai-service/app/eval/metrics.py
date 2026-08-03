"""
Scoring for classification predictions.

Written by hand rather than pulled from scikit-learn because this package ships
to a serverless function where the dependency would be several hundred
megabytes for four formulas. The notebook, which already has scikit-learn,
uses that; this agrees with it.
"""

from collections import Counter
from dataclasses import dataclass, field


@dataclass
class ClassScore:
    label: str
    support: int
    precision: float
    recall: float
    f1: float


@dataclass
class TargetScore:
    target: str
    n: int
    accuracy: float
    macro_f1: float
    per_class: list[ClassScore] = field(default_factory=list)
    confusion: dict[str, dict[str, int]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "n": self.n,
            "accuracy": round(self.accuracy, 4),
            "macro_f1": round(self.macro_f1, 4),
            "per_class": [
                {
                    "label": c.label,
                    "support": c.support,
                    "precision": round(c.precision, 4),
                    "recall": round(c.recall, 4),
                    "f1": round(c.f1, 4),
                }
                for c in self.per_class
            ],
            "confusion": self.confusion,
        }


def score(truth: list[str], predicted: list[str], target: str) -> TargetScore:
    if len(truth) != len(predicted):
        raise ValueError("truth and predicted must be the same length")
    if not truth:
        raise ValueError("nothing to score")

    labels = sorted(set(truth) | set(predicted))
    correct = sum(t == p for t, p in zip(truth, predicted))

    per_class: list[ClassScore] = []
    for label in labels:
        tp = sum(t == label and p == label for t, p in zip(truth, predicted))
        fp = sum(t != label and p == label for t, p in zip(truth, predicted))
        fn = sum(t == label and p != label for t, p in zip(truth, predicted))

        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class.append(
            ClassScore(label=label, support=tp + fn, precision=precision, recall=recall, f1=f1)
        )

    # Macro, not weighted: every class counts equally, so a model that ignores
    # a small but important class cannot hide behind the majority.
    macro_f1 = sum(c.f1 for c in per_class) / len(per_class) if per_class else 0.0

    confusion: dict[str, dict[str, int]] = {a: {b: 0 for b in labels} for a in labels}
    for t, p in zip(truth, predicted):
        confusion[t][p] += 1

    return TargetScore(
        target=target,
        n=len(truth),
        accuracy=correct / len(truth),
        macro_f1=macro_f1,
        per_class=per_class,
        confusion=confusion,
    )


def majority_class_accuracy(truth: list[str]) -> float:
    """The floor: always predict whatever is most common."""
    if not truth:
        return 0.0
    return Counter(truth).most_common(1)[0][1] / len(truth)


def calibration_bins(
    confidences: list[float], correct: list[bool], bins: int = 5
) -> list[dict]:
    """
    Does stated confidence track being right?

    A model claiming 0.9 should be right about 90% of the time. Systematic
    overconfidence matters more than raw accuracy for a feature a human is
    meant to review: a wrong answer presented tentatively invites a check,
    while a wrong answer presented at 0.95 does not.
    """
    out = []
    for index in range(bins):
        low, high = index / bins, (index + 1) / bins
        # The last bin includes 1.0.
        members = [
            ok
            for conf, ok in zip(confidences, correct)
            if (low <= conf < high) or (index == bins - 1 and conf == 1.0)
        ]
        if not members:
            continue
        out.append(
            {
                "range": f"{low:.1f}-{high:.1f}",
                "n": len(members),
                "accuracy": round(sum(members) / len(members), 4),
                "mean_confidence": round(
                    sum(c for c, ok in zip(confidences, correct) if (low <= c < high) or (index == bins - 1 and c == 1.0))
                    / len(members),
                    4,
                ),
            }
        )
    return out


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank. Reported alongside the mean because latency is skewed and
    a mean hides the slow tail a user actually notices."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, min(len(ordered), int(round(p / 100 * len(ordered)))))
    return ordered[rank - 1]
