#!/usr/bin/env python3
"""Create compact Excel tables for plotting aggregation-trading figures."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[3]
PROCESSED_DIR = ROOT / "experiments" / "aggregation_trading" / "results" / "processed"

MAIN_SUMMARY = PROCESSED_DIR / "main_summary_stats.csv"
THRESHOLD_SUMMARY = PROCESSED_DIR / "threshold_summary_stats.csv"

MAIN_OUT = PROCESSED_DIR / "main绘图.xlsx"
SENSITIVITY_OUT = PROCESSED_DIR / "sensitivity绘图.xlsx"

PLOT_COLUMNS = [
    "series",
    "case",
    "aggregation",
    "workload",
    "threshold",
    "request_size",
    "n_runs",
    "repeats",
    "succ_mean",
    "fail_mean",
    "success_rate_mean",
    "throughput_tps_mean",
    "throughput_tps_ci95",
    "avg_latency_s_mean",
    "avg_latency_s_ci95",
]


def normalize_bool(value: object) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def add_main_series_labels(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    def label(row: pd.Series) -> str:
        agg = "with aggregation" if normalize_bool(row["aggregation"]) else "no aggregation"
        return f"{str(row['workload']).capitalize()} ({agg})"

    df["series"] = df.apply(label, axis=1)
    return df


def add_sensitivity_series_labels(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    def label(row: pd.Series) -> str:
        if str(row["case"]) == "no_aggregation":
            return "Trading (no aggregation)"
        return f"Threshold = {int(float(row['threshold']))}"

    df["series"] = df.apply(label, axis=1)
    return df


def select_columns(df: pd.DataFrame) -> pd.DataFrame:
    existing = [col for col in PLOT_COLUMNS if col in df.columns]
    return df[existing].sort_values(["series", "request_size"]).reset_index(drop=True)


def build_main_plot_table() -> pd.DataFrame:
    main = pd.read_csv(MAIN_SUMMARY)
    # Main performance figure: Trading and Transfer, each under with/no aggregation.
    main = main[main["workload"].isin(["trading", "transfer"])].copy()
    main = add_main_series_labels(main)
    return select_columns(main)


def build_sensitivity_plot_table() -> tuple[pd.DataFrame, pd.DataFrame]:
    threshold = pd.read_csv(THRESHOLD_SUMMARY)
    main = pd.read_csv(MAIN_SUMMARY)

    threshold = threshold[threshold["workload"].eq("trading")].copy()
    threshold_sizes = sorted(threshold["request_size"].dropna().astype(int).unique())

    # The correct baseline for threshold sensitivity is Trading without aggregation,
    # not Transfer. Transfer remains useful for the main performance figure.
    no_aggregation = main[
        (main["workload"].eq("trading"))
        & (main["case"].eq("no_aggregation"))
        & (main["request_size"].isin(threshold_sizes))
    ].copy()
    no_aggregation["threshold"] = pd.NA

    sensitivity = pd.concat([threshold, no_aggregation], ignore_index=True)
    sensitivity = add_sensitivity_series_labels(sensitivity)
    sensitivity = select_columns(sensitivity)

    transfer_reference = main[main["workload"].eq("transfer")].copy()
    transfer_reference = add_main_series_labels(transfer_reference)
    transfer_reference = select_columns(transfer_reference)
    return sensitivity, transfer_reference


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    main_plot = build_main_plot_table()
    sensitivity_plot, transfer_reference = build_sensitivity_plot_table()

    with pd.ExcelWriter(MAIN_OUT) as writer:
        main_plot.to_excel(writer, sheet_name="main_plot", index=False)

    with pd.ExcelWriter(SENSITIVITY_OUT) as writer:
        sensitivity_plot.to_excel(writer, sheet_name="sensitivity_plot", index=False)
        transfer_reference.to_excel(writer, sheet_name="transfer_reference", index=False)

    print(f"Wrote {MAIN_OUT}")
    print(f"Wrote {SENSITIVITY_OUT}")


if __name__ == "__main__":
    main()
