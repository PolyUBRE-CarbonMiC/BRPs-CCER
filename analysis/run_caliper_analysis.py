#!/usr/bin/env python3
"""Extract and summarize aggregation-trading Caliper results.

This script is intentionally table-only. It does not draw figures.
Use a separate plotting notebook/script after `caliper_analysis_tables.xlsx`
has been generated.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import tarfile
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


ANALYSIS_DIR = Path(__file__).resolve().parent
RESULTS_DIR = ANALYSIS_DIR.parent / "results"
ARCHIVE_PATH = RESULTS_DIR / "aggregation_trading_results.tar.gz"
RAW_BASE_DIR = RESULTS_DIR / "raw"
PROCESSED_DIR = RESULTS_DIR / "processed"

ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
CALIPER_ROW_RE = re.compile(
    r"^\|\s*(?P<name>open|transfer|Trading|trading)\s*"
    r"\|\s*(?P<succ>\d+)\s*"
    r"\|\s*(?P<fail>\d+)\s*"
    r"\|\s*(?P<send_rate>[-+]?\d+(?:\.\d+)?)\s*"
    r"\|\s*(?P<max_latency>[-+]?\d+(?:\.\d+)?)\s*"
    r"\|\s*(?P<min_latency>[-+]?\d+(?:\.\d+)?)\s*"
    r"\|\s*(?P<avg_latency>[-+]?\d+(?:\.\d+)?)\s*"
    r"\|\s*(?P<throughput>[-+]?\d+(?:\.\d+)?)\s*\|$"
)
TRADING_LOG_RE = re.compile(r"caliper_(?P<size>\d+)_r(?P<repeat>\d+)\.log$")
TRANSFER_LOG_RE = re.compile(r"caliper_transfer_(?P<size>\d+)_r(?P<repeat>\d+)\.log$")
TRANSFER_LEGACY_LOG_RE = re.compile(r"caliper_transfer_r(?P<repeat>\d+)\.log$")

T_CRIT_975 = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    20: 2.086,
    30: 2.042,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse Caliper logs and export analysis tables.")
    parser.add_argument("--archive", type=Path, default=ARCHIVE_PATH)
    parser.add_argument("--results-dir", type=Path, default=RESULTS_DIR)
    parser.add_argument(
        "--reuse-latest-raw",
        action="store_true",
        help="Use the newest results/raw/extract_* directory instead of extracting the archive again.",
    )
    return parser.parse_args()


def safe_extract_tar(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    destination_resolved = destination.resolve()
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            target = (destination / member.name).resolve()
            if not str(target).startswith(str(destination_resolved)):
                raise RuntimeError(f"Unsafe archive member: {member.name}")
        tar.extractall(destination)
    raw_root = destination / "aggregation_trading_results"
    if not raw_root.exists():
        raise FileNotFoundError(f"Archive did not create {raw_root}")
    return raw_root


def latest_raw_root(raw_base: Path) -> Path | None:
    candidates = sorted(raw_base.glob("extract_*/aggregation_trading_results"), key=lambda p: p.stat().st_mtime)
    return candidates[-1] if candidates else None


def prepare_raw_root(args: argparse.Namespace) -> Path:
    raw_base = args.results_dir / "raw"
    if args.reuse_latest_raw:
        latest = latest_raw_root(raw_base)
        if latest is not None:
            return latest

    archive = args.archive
    if not archive.exists():
        raise FileNotFoundError(f"Archive not found: {archive}")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    extract_dir = raw_base / f"extract_{stamp}"
    return safe_extract_tar(archive, extract_dir)


def parse_caliper_log(log_path: Path, expected_name: str) -> dict[str, Any]:
    text = log_path.read_text(encoding="utf-8", errors="replace")
    rows: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = ANSI_ESCAPE_RE.sub("", raw_line).strip()
        match = CALIPER_ROW_RE.match(line)
        if not match:
            continue
        row = match.groupdict()
        row["name"] = row["name"].lower()
        row["succ"] = int(row["succ"])
        row["fail"] = int(row["fail"])
        for key in ("send_rate", "max_latency", "min_latency", "avg_latency", "throughput"):
            row[key] = float(row[key])
        rows.append(row)

    selected = [row for row in rows if row["name"] == expected_name.lower()]
    if not selected:
        available = sorted({row["name"] for row in rows})
        raise ValueError(f"{log_path}: missing row {expected_name}; available={available}")

    row = selected[-1]
    total = row["succ"] + row["fail"]
    return {
        "round_name": row["name"],
        "succ": row["succ"],
        "fail": row["fail"],
        "total_tx": total,
        "success_rate": row["succ"] / total if total else np.nan,
        "send_rate_tps": row["send_rate"],
        "max_latency_s": row["max_latency"],
        "min_latency_s": row["min_latency"],
        "avg_latency_s": row["avg_latency"],
        "throughput_tps": row["throughput"],
        "mvcc_read_conflicts": len(re.findall(r"MVCC_READ_CONFLICT", text)),
        "commit_errors": len(re.findall(r"Commit error", text)),
        "source_log": str(log_path),
    }


def load_metadata(metadata_path: Path) -> dict[str, Any]:
    if not metadata_path.exists():
        return {}
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    config = metadata.get("config", {})
    summary = metadata.get("summary", {})
    return {
        "metadata_file": str(metadata_path),
        "seed_config": config.get("seed"),
        "seed_used": summary.get("seed_used"),
        "n_total": summary.get("n_total"),
        "n_buy": summary.get("n_buy"),
        "n_normal_sell": summary.get("n_normal_sell"),
        "n_small_sell": summary.get("n_small_sell"),
        "buy_sum": summary.get("buy_sum"),
        "sell_sum": summary.get("sell_sum"),
        "buy_minus_sell": summary.get("buy_minus_sell"),
        "attempts_used": summary.get("attempts_used"),
        "price_mean": summary.get("all_price_mean"),
        "price_population_sd": summary.get("all_price_population_sd"),
        "price_min": summary.get("all_price_min"),
        "price_max": summary.get("all_price_max"),
    }


def collect_trading_records(raw_root: Path, case: str) -> list[dict[str, Any]]:
    records = []
    trading_dir = raw_root / case / "trading"
    for log_path in sorted(trading_dir.glob("caliper_*_r*.log")):
        match = TRADING_LOG_RE.match(log_path.name)
        if not match:
            continue
        size = int(match.group("size"))
        repeat = int(match.group("repeat"))
        record = {
            "experiment": "main",
            "case": case,
            "aggregation": case == "with_aggregation",
            "workload": "trading",
            "request_size": size,
            "repeat": repeat,
            "threshold": 4000 if case == "with_aggregation" else np.nan,
        }
        record.update(parse_caliper_log(log_path, "trading"))
        record.update(load_metadata(trading_dir / f"metadata_{size}_r{repeat}.json"))
        records.append(record)
    return records


def collect_transfer_records(raw_root: Path, case: str) -> list[dict[str, Any]]:
    records = []
    transfer_dir = raw_root / case / "transfer"
    sized_keys: set[tuple[int, int]] = set()

    for log_path in sorted(transfer_dir.glob("caliper_transfer_*_r*.log")):
        match = TRANSFER_LOG_RE.match(log_path.name)
        if not match:
            continue
        size = int(match.group("size"))
        repeat = int(match.group("repeat"))
        sized_keys.add((size, repeat))
        record = {
            "experiment": "transfer_baseline",
            "case": case,
            "aggregation": case == "with_aggregation",
            "workload": "transfer",
            "request_size": size,
            "repeat": repeat,
            "threshold": 4000 if case == "with_aggregation" else np.nan,
        }
        record.update(parse_caliper_log(log_path, "transfer"))
        records.append(record)

    for log_path in sorted(transfer_dir.glob("caliper_transfer_r*.log")):
        match = TRANSFER_LEGACY_LOG_RE.match(log_path.name)
        if not match:
            continue
        repeat = int(match.group("repeat"))
        if (2000, repeat) in sized_keys:
            continue
        record = {
            "experiment": "transfer_baseline",
            "case": case,
            "aggregation": case == "with_aggregation",
            "workload": "transfer",
            "request_size": 2000,
            "repeat": repeat,
            "threshold": 4000 if case == "with_aggregation" else np.nan,
        }
        record.update(parse_caliper_log(log_path, "transfer"))
        records.append(record)

    return records


def collect_threshold_records(raw_root: Path) -> list[dict[str, Any]]:
    records = []
    for threshold_dir in sorted(raw_root.glob("threshold_*")):
        threshold_match = re.match(r"threshold_(\d+)$", threshold_dir.name)
        if not threshold_match:
            continue
        threshold = int(threshold_match.group(1))
        trading_dir = threshold_dir / "trading"
        for log_path in sorted(trading_dir.glob("caliper_*_r*.log")):
            match = TRADING_LOG_RE.match(log_path.name)
            if not match:
                continue
            size = int(match.group("size"))
            repeat = int(match.group("repeat"))
            record = {
                "experiment": "threshold",
                "case": threshold_dir.name,
                "aggregation": True,
                "workload": "trading",
                "request_size": size,
                "repeat": repeat,
                "threshold": threshold,
            }
            record.update(parse_caliper_log(log_path, "trading"))
            record.update(load_metadata(trading_dir / f"metadata_{size}_r{repeat}.json"))
            records.append(record)
    return records


def collect_records(raw_root: Path) -> pd.DataFrame:
    records: list[dict[str, Any]] = []
    for case in ("with_aggregation", "no_aggregation"):
        records.extend(collect_trading_records(raw_root, case))
        records.extend(collect_transfer_records(raw_root, case))
    records.extend(collect_threshold_records(raw_root))
    if not records:
        raise RuntimeError(f"No Caliper records found under {raw_root}")
    return pd.DataFrame(records).sort_values(
        ["experiment", "case", "workload", "request_size", "repeat"]
    ).reset_index(drop=True)


def ci95(series: pd.Series) -> float:
    values = series.dropna().astype(float)
    n = len(values)
    if n <= 1:
        return 0.0
    tcrit = T_CRIT_975.get(n - 1, 1.96)
    return float(tcrit * values.std(ddof=1) / math.sqrt(n))


def summarize(df: pd.DataFrame) -> pd.DataFrame:
    group_cols = ["experiment", "case", "aggregation", "workload", "request_size", "threshold"]
    metric_cols = [
        "succ",
        "fail",
        "total_tx",
        "success_rate",
        "send_rate_tps",
        "max_latency_s",
        "min_latency_s",
        "avg_latency_s",
        "throughput_tps",
        "mvcc_read_conflicts",
        "commit_errors",
    ]

    rows = []
    for keys, group in df.groupby(group_cols, dropna=False):
        row = dict(zip(group_cols, keys))
        row["n_runs"] = int(group["repeat"].nunique())
        row["repeats"] = ",".join(str(int(v)) for v in sorted(group["repeat"].unique()))
        for metric in metric_cols:
            values = group[metric].dropna().astype(float)
            row[f"{metric}_mean"] = float(values.mean()) if len(values) else np.nan
            row[f"{metric}_sd"] = float(values.std(ddof=1)) if len(values) > 1 else 0.0
            row[f"{metric}_ci95"] = ci95(values)
        for meta_col in ("n_total", "n_buy", "n_normal_sell", "n_small_sell", "seed_config"):
            if meta_col in group.columns:
                values = group[meta_col].dropna()
                row[meta_col] = values.iloc[0] if len(values) else np.nan
        rows.append(row)
    return pd.DataFrame(rows).sort_values(group_cols).reset_index(drop=True)


def make_improvement_table(summary: pd.DataFrame) -> pd.DataFrame:
    main = summary[(summary["experiment"] == "main") & (summary["workload"] == "trading")]
    with_agg = main[main["case"] == "with_aggregation"].set_index("request_size")
    no_agg = main[main["case"] == "no_aggregation"].set_index("request_size")
    rows = []
    for size in sorted(set(with_agg.index).intersection(no_agg.index)):
        w = with_agg.loc[size]
        n = no_agg.loc[size]
        rows.append(
            {
                "request_size": int(size),
                "throughput_with_aggregation": w["throughput_tps_mean"],
                "throughput_no_aggregation": n["throughput_tps_mean"],
                "throughput_improvement_pct": (
                    (w["throughput_tps_mean"] - n["throughput_tps_mean"])
                    / n["throughput_tps_mean"]
                    * 100.0
                ),
                "latency_with_aggregation_s": w["avg_latency_s_mean"],
                "latency_no_aggregation_s": n["avg_latency_s_mean"],
                "latency_reduction_pct": (
                    (n["avg_latency_s_mean"] - w["avg_latency_s_mean"])
                    / n["avg_latency_s_mean"]
                    * 100.0
                ),
            }
        )
    return pd.DataFrame(rows)


def make_overall_improvement_summary(improvement: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for scope, frame in [
        ("all_request_sizes", improvement),
        ("request_size_le_2000", improvement[improvement["request_size"] <= 2000]),
    ]:
        if frame.empty:
            continue
        rows.append(
            {
                "scope": scope,
                "n_request_sizes": len(frame),
                "min_request_size": int(frame["request_size"].min()),
                "max_request_size": int(frame["request_size"].max()),
                "mean_throughput_improvement_pct": frame["throughput_improvement_pct"].mean(),
                "sd_throughput_improvement_pct": frame["throughput_improvement_pct"].std(ddof=1),
                "mean_latency_reduction_pct": frame["latency_reduction_pct"].mean(),
                "sd_latency_reduction_pct": frame["latency_reduction_pct"].std(ddof=1),
            }
        )
    return pd.DataFrame(rows)


def write_outputs(raw_df: pd.DataFrame, summary: pd.DataFrame, improvement: pd.DataFrame) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    overall = make_overall_improvement_summary(improvement)
    outputs = {
        "caliper_raw_observations.csv": raw_df,
        "main_observations.csv": raw_df[raw_df["experiment"].isin(["main", "transfer_baseline"])],
        "main_summary_stats.csv": summary[summary["experiment"].isin(["main", "transfer_baseline"])],
        "threshold_observations.csv": raw_df[raw_df["experiment"] == "threshold"],
        "threshold_summary_stats.csv": summary[summary["experiment"] == "threshold"],
        "aggregation_improvement.csv": improvement,
        "overall_improvement_summary.csv": overall,
    }
    for filename, frame in outputs.items():
        frame.to_csv(PROCESSED_DIR / filename, index=False, encoding="utf-8-sig")

    with pd.ExcelWriter(PROCESSED_DIR / "caliper_analysis_tables.xlsx") as writer:
        raw_df.to_excel(writer, sheet_name="raw_observations", index=False)
        outputs["main_summary_stats.csv"].to_excel(writer, sheet_name="main_summary", index=False)
        outputs["threshold_summary_stats.csv"].to_excel(writer, sheet_name="threshold_summary", index=False)
        improvement.to_excel(writer, sheet_name="improvement", index=False)
        overall.to_excel(writer, sheet_name="overall_improvement", index=False)


def main() -> None:
    args = parse_args()
    global RESULTS_DIR, RAW_BASE_DIR, PROCESSED_DIR
    RESULTS_DIR = args.results_dir.resolve()
    RAW_BASE_DIR = RESULTS_DIR / "raw"
    PROCESSED_DIR = RESULTS_DIR / "processed"

    raw_root = prepare_raw_root(args)
    raw_df = collect_records(raw_root)
    summary = summarize(raw_df)
    improvement = make_improvement_table(summary)
    write_outputs(raw_df, summary, improvement)

    print(f"Raw result directory: {raw_root}")
    print(f"Parsed observations: {len(raw_df)}")
    print(f"Summary groups: {len(summary)}")
    print(f"Processed outputs: {PROCESSED_DIR}")
    print("Figure generation is intentionally not included in this script.")


if __name__ == "__main__":
    main()
