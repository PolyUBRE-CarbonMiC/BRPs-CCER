# BRP-CCER Blockchain Prototype and Evaluation

This repository contains the experimental code and reproducibility materials for a blockchain-based framework that supports construction-sector carbon emission reduction (CER) projects participating in carbon markets. The prototype is built around a representative building retrofit project (BRP) scenario and uses CCER-oriented business logic as the demonstration context.

The code does four main things:

1. Implements selected carbon-market business functions as Hyperledger Fabric chaincode.
2. Validates project registration, CER accounting, and revenue allocation through SDK-based invocation and ledger evidence.
3. Provides a DApp-style prototype interface that visualizes project information, CER results, revenue allocation, and ledger confirmation.
4. Benchmarks an aggregation-based trading mechanism with Hyperledger Caliper under simulated carbon-credit request workloads.

## Repository Structure

```text
experiments/
├── chaincode.go
├── sdk_client/
│   └── energy-app/
├── reproducible_data/
├── dapp_prototype/
├── aggregation_trading/
├── revenue_allocation_sensitivity/
├── correctness_results/
├── README.md
└── REVISION_EXPERIMENT_RECORD.md
```

## 1. Smart Contract Prototype

`chaincode.go` contains the Hyperledger Fabric chaincode used in the prototype. It implements the main on-chain functions used in the paper:

- `register`: records BRP project information.
- `QueryProject`: queries registered project metadata.
- `EmissionReduction`: calculates unit-level CER from baseline energy use, post-retrofit monitored energy use, and emission factors.
- `QueryEmissionResult`: retrieves CER accounting results from the ledger state.
- `RevenueAllocation`: allocates carbon-credit revenue according to predefined contractual rules after CER results are available.
- `QueryRevenueRecord` and `QueryLastRevenueAllocation`: query revenue allocation records.
- `Trading`: processes buying and selling requests, including the aggregation mechanism for small selling requests.
- `QueryTransaction`: queries trading records.
- `open` and `transfer`: support account initialization and transfer-baseline tests.

The prototype focuses on selected business logic that can be encoded and tested on-chain. It does not replace off-chain CCER approval, third-party verification, legal contracting, registry issuance, or production deployment.

## 2. SDK-Based Correctness Validation

The folder `sdk_client/energy-app/` contains a Node.js client based on the Hyperledger Fabric SDK. It connects to a deployed Fabric network, invokes the chaincode, and prints returned results.

The correctness validation tests whether selected functions can be:

- submitted through an application-layer SDK client,
- committed to the ledger,
- queried from world state,
- confirmed with block-level Fabric CLI evidence,
- rejected when invalid inputs are submitted.

The validation covers:

- valid project registration,
- duplicate project registration rejection,
- valid CER accounting,
- unsupported energy type rejection,
- valid revenue allocation,
- manual revenue input rejection.

Representative input payloads are stored in:

```text
reproducible_data/correctness_payloads/
```

The server-side command record for the correctness-validation workflow is:

```text
reproducible_data/server_hf_correctness_commands.md
```

Recorded ledger evidence and logs are stored in:

```text
correctness_results/
```

## 3. Evidence Dashboard and DApp Prototype

The prototype interface is a static, stakeholder-facing visualization generated from recorded evidence. It is intended to show how BRP stakeholders could inspect project information, CER accounting results, revenue allocation outcomes, and ledger confirmation records.

Main files:

```text
dapp_prototype/standalone_prototype.html
dapp_prototype/evidenceData.js
dapp_prototype/figures/
```

The generated figures used for the manuscript are available in:

```text
dapp_prototype/figures/
reproducible_data/paper_figures/
```

The static DApp prototype does not directly connect to Fabric. The actual Fabric invocation is performed by the SDK client in `sdk_client/energy-app/`; the DApp prototype visualizes the recorded validation evidence.

To regenerate the standalone prototype and screenshots:

```powershell
node experiments/reproducible_data/generate_standalone_dapp_prototype.mjs
py experiments/dapp_prototype/capture_pages_to_svg.py
```

## 4. Simulated Request Data

The folder `reproducible_data/` contains scripts and generated datasets for simulated carbon-credit request workloads.

The request generator creates buying requests, normal selling requests, and small selling requests for BRP-oriented carbon-credit trading experiments. The default request sizes are:

```text
100, 300, 500, 700, 1000, 1300, 1500, 1800, 2000, 2300, 2500
```

The default request composition is:

```text
buy : normal sell : small sell = 1 : 1 : 3
```

Each generated request-size folder contains:

- `Request.json`: chaincode/Caliper input payload,
- `Request.csv`: tabular version for inspection,
- `metadata.json`: generation seed, parameters, and summary statistics.

To regenerate the request datasets:

```powershell
python experiments/reproducible_data/generate_requests.py
```

## 5. Aggregation Trading Benchmark

The folder `aggregation_trading/` contains the Hyperledger Caliper benchmark workflow for evaluating the aggregation mechanism.

The benchmark compares:

- `Trading` with aggregation,
- `Trading` without aggregation,
- `Transfer` as a baseline workload,
- threshold-sensitivity cases with aggregation thresholds of 2,000, 4,000, and 6,000 credits.

The aggregation mechanism groups small selling requests into larger aggregated selling requests before matching. The main threshold is 4,000 credits, corresponding to the lower bound of normal selling requests in the simulated scenario.

Core files:

```text
aggregation_trading/caliper/
aggregation_trading/chaincode_variants/
aggregation_trading/tools/
aggregation_trading/analysis/
aggregation_trading/results/
```

Caliper configuration and workload callbacks:

```text
aggregation_trading/caliper/config-trading.yaml
aggregation_trading/caliper/config-transfer-baseline.yaml
aggregation_trading/caliper/Open.js
aggregation_trading/caliper/Trading.js
aggregation_trading/caliper/Transfer.js
```

Chaincode variants:

```text
aggregation_trading/chaincode_variants/chaincode_with_aggregation.go
aggregation_trading/chaincode_variants/chaincode_no_aggregation.go
aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_2000.go
aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_4000.go
aggregation_trading/chaincode_variants/chaincode_with_aggregation_threshold_6000.go
```

The full server command record for running the Caliper experiments is:

```text
aggregation_trading/server_aggregation_trading_commands.md
```

Processed benchmark outputs are stored in:

```text
aggregation_trading/results/processed/
```

Important processed files include:

- `caliper_raw_observations.csv`: one row per Caliper run,
- `main_summary_stats.csv`: repeated-run summary for the main comparison,
- `threshold_summary_stats.csv`: threshold-sensitivity summary,
- `aggregation_improvement.csv`: improvements relative to no aggregation,
- `overall_improvement_summary.csv`: overall performance-improvement summary,
- `caliper_analysis_tables.xlsx`: Excel workbook with processed tables.

Paper figures are stored in:

```text
aggregation_trading/results/figures/
```

To parse Caliper results and regenerate processed tables:

```powershell
python experiments/aggregation_trading/analysis/run_caliper_analysis.py
```

or:

```powershell
powershell -ExecutionPolicy Bypass -File experiments/aggregation_trading/analysis/run_caliper_analysis.ps1
```

To regenerate the paper-style benchmark figures:

```powershell
python experiments/aggregation_trading/analysis/plot_notebook_style.py
```

## 6. Revenue Allocation Sensitivity

The folder `revenue_allocation_sensitivity/` contains a deterministic sensitivity analysis for alternative facility-manager fee rates and owner-tenant sharing ratios.

This analysis examines how contractual coefficients change revenue shares. It does not change the blockchain execution workflow or claim that any single allocation rule is universally fair.

Outputs are stored in:

```text
revenue_allocation_sensitivity/figures/
```

## 7. Main Reproducibility Workflows

### Correctness Evidence

```powershell
node experiments/reproducible_data/generate_evidence_dashboard.mjs
node experiments/reproducible_data/generate_fabric_execution_report.mjs
```

### DApp Prototype Figures

```powershell
node experiments/reproducible_data/generate_standalone_dapp_prototype.mjs
py experiments/dapp_prototype/capture_pages_to_svg.py
```

### Request Data

```powershell
python experiments/reproducible_data/generate_requests.py
```

### Aggregation Benchmark Tables and Figures

```powershell
python experiments/aggregation_trading/analysis/run_caliper_analysis.py
python experiments/aggregation_trading/analysis/plot_notebook_style.py
```

## 8. Environment Notes

The prototype was developed for a Hyperledger Fabric 1.4.x-style environment with Golang chaincode, Node.js Fabric SDK clients, Docker-based Fabric deployment, and Hyperledger Caliper for performance benchmarking.

Typical tools used in the workflows include:

- Go for chaincode development,
- Node.js for Fabric SDK clients and static evidence-page generation,
- Python, pandas, matplotlib, and openpyxl for result analysis and plotting,
- Hyperledger Caliper for benchmark execution,
- Docker for the Fabric network environment.

Some commands depend on a running Fabric network, deployed chaincode, Fabric identities, and server-specific paths. The command records under `reproducible_data/` and `aggregation_trading/` document the exact workflows used in the experiments.

## 9. Scope of the Materials

These materials support prototype-level validation and benchmark evaluation for the paper. They are designed to make the experimental logic, simulated data, chaincode functions, ledger-evidence workflow, and Caliper results inspectable and reproducible.

The materials do not provide a production carbon-market platform. Real CCER participation would still require project documentation, methodology review, third-party validation and verification, registry interaction, market integration, privacy and security hardening, and legally validated stakeholder agreements.
