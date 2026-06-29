#!/usr/bin/env python3
"""Generate reproducible carbon-credit trading request data.

This script extracts the request-generation logic from the original
Framework+Aggregation notebook into a clean, repeatable workflow.
It writes one folder per request size with:

- Request.json: input for the Hyperledger Fabric/Caliper Trading workload
- Request.csv: tabular copy for inspection
- metadata.json: seed, parameters, and summary statistics

The default parameters follow the manuscript's simulated market setting:
buy requests, normal selling requests, and small selling requests are generated
at a 1:1:3 ratio; prices are drawn around 68 CNY/tCO2e and clipped to 67-69;
request amounts follow the same discrete ranges used in the original notebook.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean, pstdev
from typing import Iterable


DEFAULT_REQUEST_SIZES = [100, 300, 500, 700, 1000, 1300, 1500, 1800, 2000, 2300, 2500]


@dataclass(frozen=True)
class GenerationConfig:
    seed: int = 42
    buy_ratio: int = 1
    normal_sell_ratio: int = 1
    small_sell_ratio: int = 3
    price_mean: float = 68.0
    price_sd: float = 0.3
    price_min: float = 67.0
    price_max: float = 69.0
    buy_amount_min: int = 4000
    buy_amount_max: int = 9000
    buy_amount_step: int = 500
    normal_sell_amount_min: int = 4000
    normal_sell_amount_max: int = 6000
    normal_sell_amount_step: int = 400
    small_sell_amount_min: int = 300
    small_sell_amount_max: int = 700
    small_sell_amount_step: int = 100
    rp_low_min: int = 40
    rp_low_max: int = 60
    rp_mid_min: int = 60
    rp_mid_max: int = 80
    rp_high_min: int = 80
    rp_high_max: int = 100
    max_balance_gap: int = 100000
    max_tries: int = 800000


def stepped_values(start: int, stop: int, step: int) -> list[int]:
    return list(range(start, stop + 1, step))


def clipped_normal(rng: random.Random, mean_value: float, sd: float, low: float, high: float) -> float:
    return min(max(rng.gauss(mean_value, sd), low), high)


def generate_rp(rng: random.Random, n: int, config: GenerationConfig) -> list[int]:
    n1 = n // 3
    n2 = n // 3
    n3 = n - n1 - n2
    rp = (
        [rng.randint(config.rp_low_min, config.rp_low_max) for _ in range(n1)]
        + [rng.randint(config.rp_mid_min, config.rp_mid_max) for _ in range(n2)]
        + [rng.randint(config.rp_high_min, config.rp_high_max) for _ in range(n3)]
    )
    rng.shuffle(rp)
    return rp


def split_counts(n_total: int, config: GenerationConfig) -> tuple[int, int, int]:
    ratios = [config.buy_ratio, config.normal_sell_ratio, config.small_sell_ratio]
    if any(ratio < 0 for ratio in ratios) or sum(ratios) <= 0:
        raise ValueError("Request ratios must be non-negative and must not all be zero.")

    ratio_sum = sum(ratios)
    raw_counts = [n_total * ratio / ratio_sum for ratio in ratios]
    counts = [int(value) for value in raw_counts]
    remainder = n_total - sum(counts)

    # Largest-remainder allocation keeps the split exact when possible and
    # deterministic when n_total is not divisible by the ratio sum.
    fractional_order = sorted(
        range(len(raw_counts)),
        key=lambda idx: (raw_counts[idx] - counts[idx], ratios[idx]),
        reverse=True,
    )
    for idx in fractional_order[:remainder]:
        counts[idx] += 1

    return counts[0], counts[1], counts[2]


def generate_requests(n_total: int, config: GenerationConfig, seed_offset: int = 0) -> tuple[list[dict], dict]:
    rng = random.Random(config.seed + seed_offset)
    n_buy, n_sell_normal, n_sell_small = split_counts(n_total, config)

    ids = list(range(n_total))
    types = ["Buy"] * n_buy + ["Sell"] * (n_sell_normal + n_sell_small)
    rng.shuffle(types)

    buy_idx = [idx for idx, request_type in enumerate(types) if request_type == "Buy"]
    sell_idx = [idx for idx, request_type in enumerate(types) if request_type == "Sell"]

    sell_normal_idx = set(rng.sample(sell_idx, n_sell_normal))
    sell_small_idx = set(idx for idx in sell_idx if idx not in sell_normal_idx)

    buy_amount_values = stepped_values(
        config.buy_amount_min, config.buy_amount_max, config.buy_amount_step
    )
    normal_sell_amount_values = stepped_values(
        config.normal_sell_amount_min,
        config.normal_sell_amount_max,
        config.normal_sell_amount_step,
    )
    small_sell_amount_values = stepped_values(
        config.small_sell_amount_min, config.small_sell_amount_max, config.small_sell_amount_step
    )

    amounts = [0] * n_total
    buy_sum = 0
    sell_sum = 0
    attempts_used = 0
    for attempt in range(1, config.max_tries + 1):
        for idx in buy_idx:
            amounts[idx] = rng.choice(buy_amount_values)
        for idx in sell_normal_idx:
            amounts[idx] = rng.choice(normal_sell_amount_values)
        for idx in sell_small_idx:
            amounts[idx] = rng.choice(small_sell_amount_values)

        buy_sum = sum(amounts[idx] for idx in buy_idx)
        sell_sum = sum(amounts[idx] for idx in sell_idx)
        attempts_used = attempt
        if buy_sum > sell_sum and (buy_sum - sell_sum) <= config.max_balance_gap:
            break
    else:
        raise RuntimeError(
            "Failed to generate a request set satisfying the market-balance "
            f"constraint after {config.max_tries} attempts."
        )

    prices = [
        clipped_normal(rng, config.price_mean, config.price_sd, config.price_min, config.price_max)
        for _ in range(n_total)
    ]

    rp_values = [0] * n_total
    buy_rp = generate_rp(rng, n_buy, config)
    sell_rp = generate_rp(rng, len(sell_idx), config)
    for idx, rp in zip(buy_idx, buy_rp):
        rp_values[idx] = rp
    for idx, rp in zip(sell_idx, sell_rp):
        rp_values[idx] = rp

    records: list[dict] = []
    for idx in ids:
        request_type = types[idx]
        price = prices[idx]
        rp = rp_values[idx]
        pv = price * rp if request_type == "Buy" else 0.0
        records.append(
            {
                "ID": str(idx),
                "Type": request_type,
                "Amount": int(amounts[idx]),
                "Price": round(price, 10),
                "RP": int(rp),
                "Smallsell": 1 if idx in sell_small_idx else 0,
                "PV": round(pv, 10),
            }
        )

    summary = summarize_records(records)
    summary.update(
        {
            "n_total": n_total,
            "n_buy": n_buy,
            "n_normal_sell": n_sell_normal,
            "n_small_sell": n_sell_small,
            "buy_sum": buy_sum,
            "sell_sum": sell_sum,
            "buy_minus_sell": buy_sum - sell_sum,
            "attempts_used": attempts_used,
            "seed_used": config.seed + seed_offset,
        }
    )
    return records, summary


def summarize_records(records: list[dict]) -> dict:
    buy_records = [r for r in records if r["Type"] == "Buy"]
    sell_records = [r for r in records if r["Type"] == "Sell"]
    small_sell_records = [r for r in sell_records if r["Smallsell"] == 1]
    normal_sell_records = [r for r in sell_records if r["Smallsell"] == 0]

    def amount_stats(items: list[dict]) -> dict:
        amounts = [int(r["Amount"]) for r in items]
        if not amounts:
            return {"count": 0, "sum": 0, "mean": 0.0}
        return {"count": len(amounts), "sum": sum(amounts), "mean": mean(amounts)}

    prices = [float(r["Price"]) for r in records]
    return {
        "buy_amount": amount_stats(buy_records),
        "normal_sell_amount": amount_stats(normal_sell_records),
        "small_sell_amount": amount_stats(small_sell_records),
        "all_price_mean": mean(prices),
        "all_price_population_sd": pstdev(prices) if len(prices) > 1 else 0.0,
        "all_price_min": min(prices),
        "all_price_max": max(prices),
    }


def write_outputs(records: list[dict], metadata: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    json_path = output_dir / "Request.json"
    csv_path = output_dir / "Request.csv"
    metadata_path = output_dir / "metadata.json"

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["ID", "Type", "Amount", "Price", "RP", "Smallsell", "PV"])
        writer.writeheader()
        writer.writerows(records)

    with metadata_path.open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write("\n")


def write_run_summary(rows: Iterable[dict], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = list(rows)

    with (output_dir / "generation_summary.json").open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
        f.write("\n")

    fieldnames = [
        "n_total",
        "seed_used",
        "n_buy",
        "n_normal_sell",
        "n_small_sell",
        "buy_sum",
        "sell_sum",
        "buy_minus_sell",
        "attempts_used",
        "all_price_mean",
        "all_price_population_sd",
        "all_price_min",
        "all_price_max",
    ]
    with (output_dir / "generation_summary.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name) for name in fieldnames})


def parse_request_sizes(value: str) -> list[int]:
    return [int(item.strip()) for item in value.split(",") if item.strip()]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate reproducible simulated carbon-credit trading requests."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "generated",
        help="Directory for generated request folders.",
    )
    parser.add_argument(
        "--request-sizes",
        default=",".join(str(n) for n in DEFAULT_REQUEST_SIZES),
        help="Comma-separated request sizes. Defaults to the manuscript experiment sizes.",
    )
    parser.add_argument("--seed", type=int, default=42, help="Base random seed.")
    parser.add_argument("--buy-ratio", type=int, default=1, help="Buy-request ratio.")
    parser.add_argument(
        "--normal-sell-ratio",
        type=int,
        default=1,
        help="Normal selling request ratio.",
    )
    parser.add_argument(
        "--small-sell-ratio",
        type=int,
        default=3,
        help="Small selling request ratio.",
    )
    parser.add_argument(
        "--seed-step",
        type=int,
        default=1000,
        help="Seed offset step between request sizes.",
    )
    parser.add_argument(
        "--max-balance-gap",
        type=int,
        default=100000,
        help="Maximum allowed difference where total buy amount exceeds total sell amount.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    request_sizes = parse_request_sizes(args.request_sizes)
    config = GenerationConfig(
        seed=args.seed,
        buy_ratio=args.buy_ratio,
        normal_sell_ratio=args.normal_sell_ratio,
        small_sell_ratio=args.small_sell_ratio,
        max_balance_gap=args.max_balance_gap,
    )

    summary_rows = []
    for index, n_total in enumerate(request_sizes):
        records, summary = generate_requests(n_total, config, seed_offset=index * args.seed_step)
        metadata = {
            "purpose": "simulated_request_generation_for_BRP_CCER_aggregation_experiment",
            "config": asdict(config),
            "summary": summary,
        }
        output_dir = args.output_dir / f"{n_total}_requests"
        write_outputs(records, metadata, output_dir)
        summary_rows.append(summary)
        print(
            f"generated {n_total:>4} requests | "
            f"buy={summary['n_buy']}, normal_sell={summary['n_normal_sell']}, "
            f"small_sell={summary['n_small_sell']}, "
            f"buy-sell={summary['buy_minus_sell']}, seed={summary['seed_used']}"
        )

    write_run_summary(summary_rows, args.output_dir)
    print(f"\noutputs written to: {args.output_dir}")


if __name__ == "__main__":
    main()
