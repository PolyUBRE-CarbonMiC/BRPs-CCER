# Experiments Repository

This directory contains the reproducible materials for the revised manuscript on a blockchain-based framework for construction CER projects participating in carbon markets.

## What to Upload to GitHub

- `chaincode.go`
- `sdk_client/energy-app/`
- `reproducible_data/`
- `aggregation_trading/`
- `dapp_prototype/`
- `revenue_allocation_sensitivity/`
- `README.md`
- `REVISION_EXPERIMENT_RECORD.md`
- `reproducible_data/server_hf_correctness_commands.md`
- `aggregation_trading/server_aggregation_trading_commands.md`
- `reproducible_data/correctness_payloads/`
- `reproducible_data/evidence_dashboard/`
- `reproducible_data/generated/`
- `reproducible_data/paper_figures/`
- `aggregation_trading/caliper/`
- `aggregation_trading/chaincode_variants/`
- `aggregation_trading/analysis/`
- `aggregation_trading/results/processed/`
- `aggregation_trading/results/figures/`
- `aggregation_trading/results/raw/` only if you want to share raw benchmark logs
- `dapp_prototype/figures/`
- `dapp_prototype/standalone_prototype.html`
- `dapp_prototype/capture_pages_to_svg.py`
- `dapp_prototype/evidenceData.js`
- `revenue_allocation_sensitivity/figures/`
- `revenue_allocation_sensitivity/revenue_allocation_sensitivity_plot*.ipynb`

## What Should Stay Local

The following materials are working drafts, temporary outputs, or local runtime artifacts and should not be uploaded unless you explicitly want to share them:

- `manuscript_revision_texts/`
- `_local_archive_not_for_github/`
- `Response to Comments.docx`
- `碳市场区块链Framework-36-删减.docx`
- `投稿要求.pdf`
- `VM0008 - Weatherization Of Single-Family And Multi-Family Buildings.pdf`
- `智能合约伪代码.tex`
- `智能合约伪代码.aux`
- `correctness_results.tar.gz`
- `correctness_results/`
- `_tmp_check_results/`
- `aggregation_trading/results/*.tar.gz`
- `aggregation_trading/results/raw/extract_*/`
- `sdk_client/energy-app/node_modules/`
- `sdk_client/energy-app/wallet/`
- `dapp_prototype/BRP-CCER-DApp/node_modules/`
- `dapp_prototype/BRP-CCER-DApp/dist/`
- `dapp_prototype/BRP-CCER-DApp/preview.log`

## Reproducibility Scope

The uploaded materials support two experiment tracks:

1. Smart-contract correctness validation for project registration, CER accounting, and revenue allocation.
2. Aggregation/trading benchmark validation under simulated request workloads, including threshold sensitivity analysis.

## Regeneration

- Run `reproducible_data/generate_evidence_dashboard.mjs` to regenerate correctness evidence pages.
- Run `reproducible_data/generate_fabric_execution_report.mjs` to regenerate the ledger-evidence report.
- Run `reproducible_data/generate_standalone_dapp_prototype.mjs` and `dapp_prototype/capture_pages_to_svg.py` to regenerate the DApp figures.
- Run the scripts in `aggregation_trading/analysis/` to regenerate Caliper tables and figures.

## Notes

- Keep the manuscript PDF and reviewer response files out of the public repository.
- Keep local runtime dependencies out of the public repository.
- Prefer the processed tables and paper figures over raw intermediate extraction folders.
