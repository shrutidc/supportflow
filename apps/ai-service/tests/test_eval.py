"""
Evaluation scoring and the comparability guard.

The guard exists because the first evaluation run compared an LLM scored on 60
rows against a baseline scored on 6,530, and reported the difference as a
finding. Nothing errored — the numbers simply described different populations.
"""

import pytest

from app.eval import metrics
from app.eval.runner import check_same_rows, wald_margin


class TestScore:
    def test_perfect_predictions(self):
        result = metrics.score(["a", "b", "a"], ["a", "b", "a"], "t")
        assert result.accuracy == 1.0
        assert result.macro_f1 == 1.0

    def test_accuracy_and_per_class(self):
        truth = ["high", "low", "high", "medium"]
        predicted = ["high", "high", "high", "medium"]
        result = metrics.score(truth, predicted, "priority")

        assert result.accuracy == 0.75
        by_label = {c.label: c for c in result.per_class}
        # 'high' was predicted three times and correct twice.
        assert by_label["high"].precision == pytest.approx(2 / 3)
        assert by_label["high"].recall == 1.0
        # 'low' was never predicted, so recall is zero, not undefined.
        assert by_label["low"].recall == 0.0

    def test_macro_f1_does_not_let_a_rare_class_hide(self):
        # Nineteen easy negatives and one missed positive: accuracy stays high,
        # macro F1 does not — which is the point of using it.
        truth = ["low"] * 19 + ["high"]
        predicted = ["low"] * 20
        result = metrics.score(truth, predicted, "priority")
        assert result.accuracy == 0.95
        assert result.macro_f1 < 0.55

    def test_confusion_counts_every_pair(self):
        result = metrics.score(["a", "a", "b"], ["a", "b", "b"], "t")
        assert result.confusion["a"]["a"] == 1
        assert result.confusion["a"]["b"] == 1
        assert result.confusion["b"]["b"] == 1

    def test_mismatched_lengths_are_rejected(self):
        with pytest.raises(ValueError):
            metrics.score(["a"], ["a", "b"], "t")


class TestMajorityAndCalibration:
    def test_majority_class_accuracy(self):
        assert metrics.majority_class_accuracy(["a", "a", "a", "b"]) == 0.75

    def test_calibration_exposes_overconfidence(self):
        # Ten predictions at 0.9 confidence, three of them right. A model
        # claiming 0.9 should be right about 90% of the time.
        bins = metrics.calibration_bins([0.9] * 10, [True] * 3 + [False] * 7)
        top = [b for b in bins if b["range"] == "0.8-1.0"][0]
        assert top["n"] == 10
        assert top["accuracy"] == 0.3
        assert top["mean_confidence"] == 0.9

    def test_percentile_reports_the_tail(self):
        values = [1.0] * 95 + [50.0] * 5
        assert metrics.percentile(values, 50) == 1.0
        assert metrics.percentile(values, 95) == 1.0
        assert metrics.percentile(values, 99) == 50.0


class TestComparabilityGuard:
    """A gap between two numbers is only a finding if they measured the same
    thing."""

    def _results(self, majority: float, n: int = 60):
        return {"targets": {"type": {"accuracy": 0.7, "majority_class": majority, "n": n}}}

    def test_matching_rows_pass(self):
        baseline = {"type": {"accuracy": 0.9, "majority_class": 0.483, "n": 60}}
        assert check_same_rows(self._results(0.483), baseline) == []

    def test_rounding_differences_are_not_a_mismatch(self):
        # The two sides store the same fraction at different precision. An
        # exact comparison flagged identical rows as different, which is a
        # guard that would have been switched off rather than trusted.
        baseline = {"type": {"accuracy": 0.9, "majority_class": 0.4833333333, "n": 60}}
        assert check_same_rows(self._results(0.4833), baseline) == []

    def test_a_different_majority_class_is_caught(self):
        # The exact signature of the original bug: baseline measured on the
        # full test set, LLM on a 60-row sample.
        baseline = {"type": {"accuracy": 0.84, "majority_class": 0.392, "n": 6530}}
        problems = check_same_rows(self._results(0.483), baseline)
        assert len(problems) == 1
        assert "not scored on the same rows" in problems[0]

    def test_a_different_row_count_is_caught(self):
        baseline = {"type": {"accuracy": 0.9, "majority_class": 0.483, "n": 300}}
        problems = check_same_rows(self._results(0.483, n=60), baseline)
        assert "n=300" in problems[0]

    def test_a_missing_baseline_is_caught(self):
        problems = check_same_rows(self._results(0.483), {})
        assert "no baseline" in problems[0]


class TestConfidenceInterval:
    def test_a_small_sample_gets_a_wide_interval(self):
        # 60 rows at 40% is +/- 12.4 points; reporting it bare invites reading
        # a 60-row result as precise.
        assert wald_margin(0.4, 60) == pytest.approx(0.124, abs=0.005)

    def test_more_rows_narrow_it(self):
        assert wald_margin(0.4, 6530) < wald_margin(0.4, 60) / 5

    def test_no_rows_is_not_a_crash(self):
        assert wald_margin(0.4, 0) == 0.0
