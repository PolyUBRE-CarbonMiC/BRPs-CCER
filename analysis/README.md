# Aggregation Trading Caliper Analysis

这个目录用于处理服务器下载回来的 Caliper 实验结果。分析和绘图分开：

- `run_caliper_analysis.py` / `run_caliper_analysis.ps1`：只解析 Caliper 日志、汇总统计、导出 CSV/XLSX。
- `plot_notebook_style.py`：读取已处理好的表格，单独绘图。

原始压缩包可以继续放在：

`experiments/aggregation_trading/results`

脚本会自动组织为：

- `results/raw/`: 解压后的 Caliper 原始日志、HTML report、metadata。
- `results/processed/`: 可直接用于论文表格和复核的 CSV/XLSX。
- `results/figures/`: 单独运行绘图脚本后生成论文图。

## 运行

在项目根目录运行：

```powershell
python experiments\aggregation_trading\analysis\run_caliper_analysis.py
```

如果本机 Python 或 pip 不可用，直接运行不依赖 Python 包的 PowerShell 版本：

```powershell
powershell -ExecutionPolicy Bypass -File experiments\aggregation_trading\analysis\run_caliper_analysis.ps1
```

如果刚从服务器下载了新的 `aggregation_trading_results.tar.gz`，并且需要覆盖本地已解压的旧结果：

```powershell
powershell -ExecutionPolicy Bypass -File experiments\aggregation_trading\analysis\run_caliper_analysis.ps1 -ForceExtract
```

如果要完全复用旧 notebook 的 matplotlib 绘图风格，先用 PowerShell 脚本生成 `processed` 表格，然后运行：

```powershell
python experiments\aggregation_trading\analysis\plot_notebook_style.py
```

该脚本会额外生成：

- `results/tables/notebook_style_main_result.xlsx`
- `results/tables/notebook_style_threshold_result.xlsx`
- `results/figures/notebook_style_main_throughput.png/jpg/svg/pdf`
- `results/figures/notebook_style_main_latency.png/jpg/svg/pdf`
- `results/figures/notebook_style_threshold_throughput.png/jpg/svg/pdf`
- `results/figures/notebook_style_threshold_latency.png/jpg/svg/pdf`

如果本机没有把 `python` 加入 PATH，也可以用你常用的 Anaconda Prompt 或 PyCharm 终端运行同一条命令。

需要的 Python 包：

```powershell
python -m pip install pandas numpy matplotlib openpyxl
```

先检查当前 Python 环境是否能运行分析：

```powershell
python experiments\aggregation_trading\analysis\check_python_environment.py
```

## 输出文件

`results/processed/caliper_raw_observations.csv`

每一次 Caliper 运行一行，包含：

- `experiment`: `main`, `transfer_baseline`, `threshold`
- `case`: `with_aggregation`, `no_aggregation`, `threshold_2000`, `threshold_4000`, `threshold_6000`
- `request_size`, `repeat`, `threshold`
- `succ`, `fail`, `success_rate`
- `send_rate_tps`, `throughput_tps`
- `avg_latency_s`, `max_latency_s`, `min_latency_s`
- `mvcc_read_conflicts`, `commit_errors`
- metadata 中的 `seed_used`, `n_total`, `n_buy`, `n_normal_sell`, `n_small_sell`

`results/processed/main_summary_stats.csv`

主实验的 3 次重复统计。每个规模分别给出均值、样本标准差和 95% confidence interval。95% CI 使用小样本 t 分布系数，而不是简单的 1.96。

`results/processed/threshold_summary_stats.csv`

阈值敏感性分析的统计结果，覆盖阈值 2000/4000/6000 和规模 1000/2000/2500。

`results/processed/aggregation_improvement.csv`

相对 no aggregation 的改进幅度：

- `throughput_improvement_pct`
- `latency_reduction_pct`
- `success_rate_delta_percentage_points`

`results/processed/overall_improvement_summary.csv`

主实验所有 request size 上的平均提升，用于论文正文的一句话总结。

`results/processed/aggregation_trading_caliper_summary.xlsx`

同一批结果的 Excel 工作簿，便于人工检查和放入补充材料。

## 绘图

先完成 Caliper 结果提取：

```powershell
powershell -ExecutionPolicy Bypass -File experiments\aggregation_trading\analysis\run_caliper_analysis.ps1
```

然后单独绘图：

```powershell
python experiments\aggregation_trading\analysis\plot_notebook_style.py
```

绘图脚本会导出：

- `results/figures/notebook_style_main_throughput.png/jpg/svg/pdf`
- `results/figures/notebook_style_main_latency.png/jpg/svg/pdf`
- `results/figures/notebook_style_threshold_throughput.png/jpg/svg/pdf`
- `results/figures/notebook_style_threshold_latency.png/jpg/svg/pdf`

这些图的绘图代码单独维护，不影响 Caliper 解析和统计结果。

## 对 reviewer 意见的对应关系

- 多次重复实验：主实验和敏感性分析均按 `repeat=1,2,3` 统计。
- 平均值和误差：输出均值、样本标准差和 95% CI，图中使用 95% CI 阴影。
- 随机性说明：从 `metadata_*.json` 提取 `seed_used` 和请求组成，可用于方法或补充材料。
- 对照组：保留 Transfer baseline，并比较 with aggregation 与 no aggregation。
- 敏感性分析：单独统计阈值 2000/4000/6000。
