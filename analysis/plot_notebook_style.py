#!/usr/bin/env python3
"""Plot aggregation-trading results using the original notebook style.

This script intentionally follows the plotting style in
``Framework+Aggregation-数据.ipynb``:

- ``plt.figure(figsize=(10, 6))``
- ``plt.plot(..., marker='o', color='C*', linestyle='*')``
- default matplotlib axes, legend, title, labels, and ``tight_layout``
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[3]
RESULTS_DIR = ROOT / "experiments" / "aggregation_trading" / "results"
PROCESSED_DIR = RESULTS_DIR / "processed"
FIGURES_DIR = RESULTS_DIR / "figures"
TABLE_DIR = RESULTS_DIR / "tables"


def ensure_dirs() -> None:
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    TABLE_DIR.mkdir(parents=True, exist_ok=True)


def is_true(value: object) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def load_main_result_like_notebook() -> pd.DataFrame:
    """Create a result table with the same columns expected by the old notebook."""
    summary = pd.read_csv(PROCESSED_DIR / "main_summary_stats.csv")

    trading = summary[(summary["experiment"] == "main") & (summary["workload"] == "trading")].copy()
    transfer = summary[
        (summary["experiment"] == "transfer_baseline") & (summary["workload"] == "transfer")
    ].copy()

    request_sizes = sorted(trading["request_size"].dropna().astype(int).unique())
    rows = []

    def add_row(source_row: pd.Series, request_size: int, name: str, aggregation: str) -> None:
        rows.append(
            {
                "Number of Requests": request_size,
                "Aggregation": aggregation,
                "Name": name,
                "Succ": source_row["succ_mean"],
                "Fail": source_row["fail_mean"],
                "Send Rate (TPS)": source_row["send_rate_tps_mean"],
                "Max Latency (s)": source_row["max_latency_s_mean"],
                "Min Latency (s)": source_row["min_latency_s_mean"],
                "Avg Latency (s)": source_row["avg_latency_s_mean"],
                "Throughput (TPS)": source_row["throughput_tps_mean"],
                "Success Rate": source_row["success_rate_mean"],
            }
        )

    for _, row in trading.iterrows():
        aggregation = "yes" if is_true(row["aggregation"]) else "no"
        add_row(row, int(row["request_size"]), "trading", aggregation)

    # Transfer was benchmarked as a fixed 2000-operation baseline. To match the
    # original notebook-style comparison figure, draw it across the same x-axis.
    for _, row in transfer.iterrows():
        aggregation = "yes" if is_true(row["aggregation"]) else "no"
        for request_size in request_sizes:
            add_row(row, request_size, "transfer", aggregation)

    result = pd.DataFrame(rows)
    result = result.sort_values(["Name", "Aggregation", "Number of Requests"]).reset_index(drop=True)
    result.to_csv(TABLE_DIR / "notebook_style_main_result.csv", index=False, encoding="utf-8-sig")
    result.to_excel(TABLE_DIR / "notebook_style_main_result.xlsx", index=False)
    return result


def plot_main_metric(result: pd.DataFrame, metric: str, ylabel: str, title: str, filename: str) -> None:
    df = result.copy()
    df["Name"] = df["Name"].str.lower()
    df["Aggregation"] = df["Aggregation"].str.lower()
    df = df[df["Name"].isin(["trading", "transfer"])].copy()
    df["Number of Requests"] = pd.to_numeric(df["Number of Requests"], errors="coerce")
    df["Number of Requests"] = df["Number of Requests"].ffill()

    plt.figure(figsize=(10, 6))

    colors = {
        ("trading", "no"): "C0",
        ("trading", "yes"): "C1",
        ("transfer", "no"): "C2",
        ("transfer", "yes"): "C3",
    }
    linestyles = {
        ("trading", "no"): "-",
        ("trading", "yes"): "--",
        ("transfer", "no"): "-.",
        ("transfer", "yes"): ":",
    }

    for name in ["trading", "transfer"]:
        for agg in ["no", "yes"]:
            group = df[(df["Name"] == name) & (df["Aggregation"] == agg)]
            if not group.empty:
                plt.plot(
                    group["Number of Requests"],
                    group[metric],
                    marker="o",
                    color=colors[(name, agg)],
                    linestyle=linestyles[(name, agg)],
                    label=f"{name.capitalize()}, aggregation={agg.capitalize()}",
                )

    plt.xlabel("Number of Requests")
    plt.ylabel(ylabel)
    plt.title(title)
    plt.legend()
    plt.xticks(sorted(df["Number of Requests"].unique()))
    plt.tight_layout()

    for suffix in ["png", "jpg", "svg", "pdf"]:
        plt.savefig(FIGURES_DIR / f"{filename}.{suffix}", dpi=300)
    plt.close()


def load_threshold_result_like_notebook() -> pd.DataFrame:
    threshold = pd.read_csv(PROCESSED_DIR / "threshold_summary_stats.csv")
    main = pd.read_csv(PROCESSED_DIR / "main_summary_stats.csv")
    no_aggregation = main[
        (main["experiment"] == "main")
        & (main["workload"] == "trading")
        & (main["case"] == "no_aggregation")
    ].copy()

    rows = []

    def add_threshold_row(row: pd.Series, label: str) -> None:
        rows.append(
            {
                "Number of Requests": int(row["request_size"]),
                "Threshold": label,
                "Avg Latency (s)": row["avg_latency_s_mean"],
                "Throughput (TPS)": row["throughput_tps_mean"],
            }
        )

    for _, row in threshold.iterrows():
        add_threshold_row(row, f"Threshold={int(row['threshold'])}")

    threshold_sizes = sorted(threshold["request_size"].dropna().astype(int).unique())
    for _, row in no_aggregation[no_aggregation["request_size"].isin(threshold_sizes)].iterrows():
        add_threshold_row(row, "No aggregation")

    result = pd.DataFrame(rows)
    result = result.sort_values(["Threshold", "Number of Requests"]).reset_index(drop=True)
    result.to_csv(TABLE_DIR / "notebook_style_threshold_result.csv", index=False, encoding="utf-8-sig")
    result.to_excel(TABLE_DIR / "notebook_style_threshold_result.xlsx", index=False)
    return result


def plot_threshold_metric(result: pd.DataFrame, metric: str, ylabel: str, title: str, filename: str) -> None:
    plt.figure(figsize=(10, 6))

    labels = ["Threshold=2000", "Threshold=4000", "Threshold=6000", "No aggregation"]
    colors = {
        "Threshold=2000": "C0",
        "Threshold=4000": "C1",
        "Threshold=6000": "C2",
        "No aggregation": "C3",
    }
    linestyles = {
        "Threshold=2000": "-",
        "Threshold=4000": "--",
        "Threshold=6000": "-.",
        "No aggregation": ":",
    }

    for label in labels:
        group = result[result["Threshold"] == label]
        if not group.empty:
            plt.plot(
                group["Number of Requests"],
                group[metric],
                marker="o",
                color=colors[label],
                linestyle=linestyles[label],
                label=label,
            )

    plt.xlabel("Number of Requests")
    plt.ylabel(ylabel)
    plt.title(title)
    plt.legend()
    plt.xticks(sorted(result["Number of Requests"].unique()))
    plt.tight_layout()

    for suffix in ["png", "jpg", "svg", "pdf"]:
        plt.savefig(FIGURES_DIR / f"{filename}.{suffix}", dpi=300)
    plt.close()


def main() -> None:
    ensure_dirs()
    main_result = load_main_result_like_notebook()
    plot_main_metric(
        main_result,
        "Throughput (TPS)",
        "Throughput (TPS)",
        "Throughput of Function Trading and Transfer",
        "notebook_style_main_throughput",
    )
    plot_main_metric(
        main_result,
        "Avg Latency (s)",
        "Avg Latency (s)",
        "Avg Latency of Function Trading and Transfer",
        "notebook_style_main_latency",
    )

    threshold_result = load_threshold_result_like_notebook()
    plot_threshold_metric(
        threshold_result,
        "Throughput (TPS)",
        "Throughput (TPS)",
        "Throughput under Different Aggregation Thresholds",
        "notebook_style_threshold_throughput",
    )
    plot_threshold_metric(
        threshold_result,
        "Avg Latency (s)",
        "Avg Latency (s)",
        "Avg Latency under Different Aggregation Thresholds",
        "notebook_style_threshold_latency",
    )

    print(f"Notebook-style tables: {TABLE_DIR}")
    print(f"Notebook-style figures: {FIGURES_DIR}")


if __name__ == "__main__":
    main()
