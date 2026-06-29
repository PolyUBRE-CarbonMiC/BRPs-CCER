param(
    [string]$ResultsDir = "",
    [string]$Archive = "",
    [switch]$NoExtract,
    [switch]$ForceExtract
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ResultsDir)) {
    $ResultsDir = Join-Path (Split-Path -Parent $ScriptDir) "results"
}
if ([string]::IsNullOrWhiteSpace($Archive)) {
    $Archive = Join-Path $ResultsDir "aggregation_trading_results.tar.gz"
}

$RawBaseDir = Join-Path $ResultsDir "raw"
$RawRoot = Join-Path $RawBaseDir "aggregation_trading_results"
$ProcessedDir = Join-Path $ResultsDir "processed"
$FiguresDir = Join-Path $ResultsDir "figures"
$AnsiPattern = "$([char]27)\[[0-?]*[ -/]*[@-~]"
$RowPattern = '^\|\s*(open|transfer|Trading|trading)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([-+]?\d+(?:\.\d+)?)\s*\|\s*([-+]?\d+(?:\.\d+)?)\s*\|\s*([-+]?\d+(?:\.\d+)?)\s*\|\s*([-+]?\d+(?:\.\d+)?)\s*\|\s*([-+]?\d+(?:\.\d+)?)\s*\|$'

function Ensure-RawResults {
    if ($ForceExtract) {
        if (!(Test-Path $Archive)) {
            throw "Archive not found: $Archive"
        }
        $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $extractDir = Join-Path $RawBaseDir "extract_$stamp"
        New-Item -ItemType Directory -Force $extractDir | Out-Null
        Write-Host "Extracting archive to fresh directory: $extractDir"
        tar -xzf $Archive -C $extractDir
        $script:RawRoot = Join-Path $extractDir "aggregation_trading_results"
        if (!(Test-Path $script:RawRoot)) {
            throw "Archive did not create expected directory: $script:RawRoot"
        }
        return
    }
    if (Test-Path $RawBaseDir) {
        $latestExtract = Get-ChildItem $RawBaseDir -Directory -Filter "extract_*" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($null -ne $latestExtract) {
            $candidate = Join-Path $latestExtract.FullName "aggregation_trading_results"
            if (Test-Path $candidate) {
                $script:RawRoot = $candidate
                return
            }
        }
    }
    if (Test-Path $RawRoot) {
        return
    }
    if ($NoExtract) {
        throw "Raw result directory not found: $RawRoot"
    }
    if (!(Test-Path $Archive)) {
        throw "Archive not found: $Archive"
    }
    New-Item -ItemType Directory -Force $RawBaseDir | Out-Null
    Write-Host "Extracting archive: $Archive"
    tar -xzf $Archive -C $RawBaseDir
    if (!(Test-Path $RawRoot)) {
        throw "Archive did not create expected directory: $RawRoot"
    }
}

function Get-TCritical975([int]$Df) {
    $table = @{
        1 = 12.706; 2 = 4.303; 3 = 3.182; 4 = 2.776; 5 = 2.571;
        6 = 2.447; 7 = 2.365; 8 = 2.306; 9 = 2.262; 10 = 2.228;
        11 = 2.201; 12 = 2.179; 13 = 2.160; 14 = 2.145; 15 = 2.131;
        16 = 2.120; 17 = 2.110; 18 = 2.101; 19 = 2.093; 20 = 2.086;
        21 = 2.080; 22 = 2.074; 23 = 2.069; 24 = 2.064; 25 = 2.060;
        26 = 2.056; 27 = 2.052; 28 = 2.048; 29 = 2.045; 30 = 2.042
    }
    if ($table.ContainsKey($Df)) { return [double]$table[$Df] }
    return 1.96
}

function Get-Mean([double[]]$Values) {
    if ($Values.Count -eq 0) { return $null }
    $sum = 0.0
    foreach ($value in $Values) { $sum += $value }
    return $sum / $Values.Count
}

function Get-SampleSd([double[]]$Values) {
    if ($Values.Count -le 1) { return 0.0 }
    $mean = Get-Mean $Values
    $sumSq = 0.0
    foreach ($value in $Values) { $sumSq += [math]::Pow($value - $mean, 2) }
    return [math]::Sqrt($sumSq / ($Values.Count - 1))
}

function Get-Ci95([double[]]$Values) {
    if ($Values.Count -le 1) { return 0.0 }
    $sd = Get-SampleSd $Values
    $t = Get-TCritical975 ($Values.Count - 1)
    return $t * $sd / [math]::Sqrt($Values.Count)
}

function Parse-CaliperLog([string]$Path, [string]$ExpectedName) {
    $text = Get-Content $Path -Raw -Encoding UTF8
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($rawLine in ($text -split "`r?`n")) {
        $line = ($rawLine -replace $AnsiPattern, "").Trim()
        $match = [regex]::Match($line, $RowPattern)
        if (!$match.Success) { continue }
        $rows.Add([pscustomobject]@{
            round_name = $match.Groups[1].Value.ToLowerInvariant()
            succ = [int]$match.Groups[2].Value
            fail = [int]$match.Groups[3].Value
            send_rate_tps = [double]$match.Groups[4].Value
            max_latency_s = [double]$match.Groups[5].Value
            min_latency_s = [double]$match.Groups[6].Value
            avg_latency_s = [double]$match.Groups[7].Value
            throughput_tps = [double]$match.Groups[8].Value
        })
    }
    $expected = $ExpectedName.ToLowerInvariant()
    $selected = @($rows | Where-Object { $_.round_name -eq $expected })
    if ($selected.Count -eq 0) {
        throw "Could not find Caliper table row '$ExpectedName' in $Path"
    }
    $row = $selected[$selected.Count - 1]
    $total = $row.succ + $row.fail
    return @{
        round_name = $row.round_name
        succ = $row.succ
        fail = $row.fail
        total_tx = $total
        success_rate = $(if ($total -gt 0) { $row.succ / $total } else { $null })
        send_rate_tps = $row.send_rate_tps
        max_latency_s = $row.max_latency_s
        min_latency_s = $row.min_latency_s
        avg_latency_s = $row.avg_latency_s
        throughput_tps = $row.throughput_tps
        mvcc_read_conflicts = ([regex]::Matches($text, "MVCC_READ_CONFLICT")).Count
        commit_errors = ([regex]::Matches($text, "Commit error")).Count
        source_log = $Path
    }
}

function Load-Metadata([string]$Path) {
    $result = @{
        metadata_file = $null; seed_config = $null; seed_used = $null; n_total = $null;
        n_buy = $null; n_normal_sell = $null; n_small_sell = $null; buy_sum = $null;
        sell_sum = $null; buy_minus_sell = $null; attempts_used = $null;
        price_mean = $null; price_population_sd = $null; price_min = $null; price_max = $null;
        aggregation_threshold = $null
    }
    if (!(Test-Path $Path)) { return $result }
    $metadata = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $result.metadata_file = $Path
    $result.seed_config = $metadata.config.seed
    $result.seed_used = $metadata.summary.seed_used
    $result.n_total = $metadata.summary.n_total
    $result.n_buy = $metadata.summary.n_buy
    $result.n_normal_sell = $metadata.summary.n_normal_sell
    $result.n_small_sell = $metadata.summary.n_small_sell
    $result.buy_sum = $metadata.summary.buy_sum
    $result.sell_sum = $metadata.summary.sell_sum
    $result.buy_minus_sell = $metadata.summary.buy_minus_sell
    $result.attempts_used = $metadata.summary.attempts_used
    $result.price_mean = $metadata.summary.all_price_mean
    $result.price_population_sd = $metadata.summary.all_price_population_sd
    $result.price_min = $metadata.summary.all_price_min
    $result.price_max = $metadata.summary.all_price_max
    if ($metadata.config.PSObject.Properties.Name -contains "aggregation_threshold") {
        $result.aggregation_threshold = $metadata.config.aggregation_threshold
    }
    return $result
}

function New-Record([hashtable]$Base, [hashtable]$Metrics, [hashtable]$Metadata) {
    $ordered = [ordered]@{}
    foreach ($key in $Base.Keys) { $ordered[$key] = $Base[$key] }
    foreach ($key in $Metrics.Keys) { $ordered[$key] = $Metrics[$key] }
    foreach ($key in $Metadata.Keys) { $ordered[$key] = $Metadata[$key] }
    return [pscustomobject]$ordered
}

function Collect-Records {
    $records = New-Object System.Collections.Generic.List[object]
    foreach ($case in @("with_aggregation", "no_aggregation")) {
        $tradingDir = Join-Path $RawRoot "$case\trading"
        if (Test-Path $tradingDir) {
            foreach ($log in (Get-ChildItem $tradingDir -Filter "caliper_*_r*.log" | Sort-Object Name)) {
                $match = [regex]::Match($log.Name, '^caliper_(\d+)_r(\d+)\.log$')
                if (!$match.Success) { continue }
                $size = [int]$match.Groups[1].Value
                $repeat = [int]$match.Groups[2].Value
                $base = @{
                    experiment = "main"; case = $case; aggregation = ($case -eq "with_aggregation");
                    workload = "trading"; request_size = $size; repeat = $repeat;
                    threshold = $(if ($case -eq "with_aggregation") { 4000 } else { $null })
                }
                $records.Add((New-Record $base (Parse-CaliperLog $log.FullName "trading") (Load-Metadata (Join-Path $tradingDir "metadata_${size}_r${repeat}.json"))))
            }
        }
        $transferDir = Join-Path $RawRoot "$case\transfer"
        if (Test-Path $transferDir) {
            foreach ($log in (Get-ChildItem $transferDir -Filter "caliper_transfer*.log" | Sort-Object Name)) {
                $sizeMatch = [regex]::Match($log.Name, '^caliper_transfer_(\d+)_r(\d+)\.log$')
                $legacyMatch = [regex]::Match($log.Name, '^caliper_transfer_r(\d+)\.log$')
                if ($sizeMatch.Success) {
                    $transferSize = [int]$sizeMatch.Groups[1].Value
                    $repeat = [int]$sizeMatch.Groups[2].Value
                } elseif ($legacyMatch.Success) {
                    $transferSize = 2000
                    $repeat = [int]$legacyMatch.Groups[1].Value
                } else {
                    continue
                }
                $base = @{
                    experiment = "transfer_baseline"; case = $case; aggregation = ($case -eq "with_aggregation");
                    workload = "transfer"; request_size = $transferSize; repeat = $repeat;
                    threshold = $(if ($case -eq "with_aggregation") { 4000 } else { $null })
                }
                $records.Add((New-Record $base (Parse-CaliperLog $log.FullName "transfer") @{}))
            }
        }
    }
    foreach ($thresholdDir in (Get-ChildItem $RawRoot -Directory -Filter "threshold_*" | Sort-Object Name)) {
        $thresholdMatch = [regex]::Match($thresholdDir.Name, '^threshold_(\d+)$')
        if (!$thresholdMatch.Success) { continue }
        $threshold = [int]$thresholdMatch.Groups[1].Value
        $tradingDir = Join-Path $thresholdDir.FullName "trading"
        foreach ($log in (Get-ChildItem $tradingDir -Filter "caliper_*_r*.log" | Sort-Object Name)) {
            $match = [regex]::Match($log.Name, '^caliper_(\d+)_r(\d+)\.log$')
            if (!$match.Success) { continue }
            $size = [int]$match.Groups[1].Value
            $repeat = [int]$match.Groups[2].Value
            $base = @{
                experiment = "threshold"; case = $thresholdDir.Name; aggregation = $true;
                workload = "trading"; request_size = $size; repeat = $repeat; threshold = $threshold
            }
            $records.Add((New-Record $base (Parse-CaliperLog $log.FullName "trading") (Load-Metadata (Join-Path $tradingDir "metadata_${size}_r${repeat}.json"))))
        }
    }
    return $records.ToArray()
}

function Build-Summary([object[]]$Records) {
    $groupColumns = @("experiment", "case", "aggregation", "workload", "request_size", "threshold")
    $metricColumns = @("succ", "fail", "total_tx", "success_rate", "send_rate_tps", "max_latency_s", "min_latency_s", "avg_latency_s", "throughput_tps", "mvcc_read_conflicts", "commit_errors")
    $groups = $Records | Group-Object {
        $parts = foreach ($column in $groupColumns) {
            $value = $_.$column
            if ($null -eq $value) { "" } else { [string]$value }
        }
        $parts -join "||"
    }
    $summary = New-Object System.Collections.Generic.List[object]
    foreach ($group in $groups) {
        $first = $group.Group[0]
        $row = [ordered]@{}
        foreach ($column in $groupColumns) { $row[$column] = $first.$column }
        $repeats = @($group.Group | ForEach-Object { [int]$_.repeat } | Sort-Object -Unique)
        $row.n_runs = $repeats.Count
        $row.repeats = ($repeats -join ",")
        foreach ($metric in $metricColumns) {
            $values = @($group.Group | Where-Object { $null -ne $_.$metric } | ForEach-Object { [double]$_.$metric })
            $row["${metric}_mean"] = Get-Mean $values
            $row["${metric}_sd"] = Get-SampleSd $values
            $row["${metric}_ci95"] = Get-Ci95 $values
        }
        foreach ($meta in @("n_total", "n_buy", "n_normal_sell", "n_small_sell", "seed_config")) {
            $nonNull = @($group.Group | Where-Object { $null -ne $_.$meta -and $_.$meta -ne "" } | Select-Object -First 1)
            $row[$meta] = $(if ($nonNull.Count -gt 0) { $nonNull[0].$meta } else { $null })
        }
        $summary.Add([pscustomobject]$row)
    }
    return @($summary.ToArray() | Sort-Object experiment, case, workload, request_size, repeat)
}

function Build-Improvement([object[]]$Summary) {
    $main = @($Summary | Where-Object { $_.experiment -eq "main" -and $_.workload -eq "trading" })
    $rows = New-Object System.Collections.Generic.List[object]
    $sizes = @($main | Select-Object -ExpandProperty request_size -Unique | Sort-Object)
    foreach ($size in $sizes) {
        $with = $main | Where-Object { $_.case -eq "with_aggregation" -and $_.request_size -eq $size } | Select-Object -First 1
        $without = $main | Where-Object { $_.case -eq "no_aggregation" -and $_.request_size -eq $size } | Select-Object -First 1
        if ($null -eq $with -or $null -eq $without) { continue }
        $rows.Add([pscustomobject]@{
            request_size = $size
            throughput_with_aggregation = $with.throughput_tps_mean
            throughput_no_aggregation = $without.throughput_tps_mean
            throughput_improvement_pct = (($with.throughput_tps_mean - $without.throughput_tps_mean) / $without.throughput_tps_mean * 100.0)
            latency_with_aggregation_s = $with.avg_latency_s_mean
            latency_no_aggregation_s = $without.avg_latency_s_mean
            latency_reduction_pct = (($without.avg_latency_s_mean - $with.avg_latency_s_mean) / $without.avg_latency_s_mean * 100.0)
            success_rate_with_aggregation = $with.success_rate_mean
            success_rate_no_aggregation = $without.success_rate_mean
            success_rate_delta_percentage_points = (($with.success_rate_mean - $without.success_rate_mean) * 100.0)
        })
    }
    return $rows.ToArray()
}

function Build-OverallImprovementSummary([object[]]$Improvement) {
    $rows = @($Improvement)
    if ($rows.Count -eq 0) { return @() }
    $scopes = @(
        @{ name = "all_request_sizes"; data = $rows },
        @{ name = "request_size_le_2000"; data = @($rows | Where-Object { [int]$_.request_size -le 2000 }) }
    )
    return @($scopes | ForEach-Object {
        $scopeRows = @($_.data)
        if ($scopeRows.Count -eq 0) { return }
        $throughput = @($scopeRows | ForEach-Object { [double]$_.throughput_improvement_pct })
        $latency = @($scopeRows | ForEach-Object { [double]$_.latency_reduction_pct })
        [pscustomobject]@{
            scope = $_.name
            n_request_sizes = $scopeRows.Count
            min_request_size = ($scopeRows | Measure-Object request_size -Minimum).Minimum
            max_request_size = ($scopeRows | Measure-Object request_size -Maximum).Maximum
            mean_throughput_improvement_pct = Get-Mean $throughput
            sd_throughput_improvement_pct = Get-SampleSd $throughput
            mean_latency_reduction_pct = Get-Mean $latency
            sd_latency_reduction_pct = Get-SampleSd $latency
        }
    })
}

function Svg-Escape([string]$Text) {
    return $Text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
}

function Scale-Linear([double]$Value, [double]$DomainMin, [double]$DomainMax, [double]$RangeMin, [double]$RangeMax) {
    if ([math]::Abs($DomainMax - $DomainMin) -lt 0.0000001) { return ($RangeMin + $RangeMax) / 2.0 }
    return $RangeMin + (($Value - $DomainMin) / ($DomainMax - $DomainMin)) * ($RangeMax - $RangeMin)
}

function Add-Panel([System.Text.StringBuilder]$Svg, [double]$X, [double]$Y, [double]$W, [double]$H, [object[]]$Series, [string]$Metric, [string]$YLabel, [string]$Letter, [string]$Title, [string]$LegendPosition = "lower-left", [switch]$PercentAxis, [switch]$Legend) {
    $allRows = @($Series | ForEach-Object { $_.data })
    if ($allRows.Count -eq 0) { return }
    $xValues = @($allRows | ForEach-Object { [double]$_.request_size })
    $yValues = @($allRows | ForEach-Object {
        $meanName = "${Metric}_mean"
        $ciName = "${Metric}_ci95"
        [double]$_.$meanName - [double]$_.$ciName
        [double]$_.$meanName + [double]$_.$ciName
    })
    $xMin = ($xValues | Measure-Object -Minimum).Minimum
    $xMax = ($xValues | Measure-Object -Maximum).Maximum
    $yMin = 0
    $yMax = ($yValues | Measure-Object -Maximum).Maximum
    if ($PercentAxis) { $yMin = 0; $yMax = 1.005 }
    $padY = [math]::Max(($yMax - $yMin) * 0.08, 0.01)
    $yMax += $padY

    if (![string]::IsNullOrWhiteSpace($Letter)) {
        [void]$Svg.AppendLine("<text x='$($X - 18)' y='$($Y - 14)' font-size='15' font-weight='700'>$Letter</text>")
    }
    if (![string]::IsNullOrWhiteSpace($Title)) {
        [void]$Svg.AppendLine("<text x='$($X + $W / 2)' y='$($Y - 12)' text-anchor='middle' font-size='11'>$(Svg-Escape $Title)</text>")
    }
    [void]$Svg.AppendLine("<rect x='$X' y='$Y' width='$W' height='$H' fill='white' stroke='#111' stroke-width='1.6'/>")
    for ($i = 0; $i -le 4; $i++) {
        $tickValue = $yMin + ($yMax - $yMin) * $i / 4.0
        $py = Scale-Linear $tickValue $yMin $yMax ($Y + $H) $Y
        $label = if ($PercentAxis) { "{0:N0}%" -f ($tickValue * 100.0) } else { "{0:N1}" -f $tickValue }
        [void]$Svg.AppendLine("<line x1='$($X - 5)' y1='$py' x2='$X' y2='$py' stroke='#111' stroke-width='1.2'/>")
        [void]$Svg.AppendLine("<text x='$($X - 8)' y='$($py + 4)' text-anchor='end' font-size='11' font-weight='700' fill='#222'>$label</text>")
    }
    $xTicks = @($xValues | Sort-Object -Unique)
    foreach ($tickValue in $xTicks) {
        $px = Scale-Linear $tickValue $xMin $xMax $X ($X + $W)
        [void]$Svg.AppendLine("<line x1='$px' y1='$($Y + $H)' x2='$px' y2='$($Y + $H + 5)' stroke='#111' stroke-width='1.2'/>")
        [void]$Svg.AppendLine("<text x='$px' y='$($Y + $H + 20)' text-anchor='middle' font-size='10' font-weight='700' fill='#222'>$([int]$tickValue)</text>")
    }
    [void]$Svg.AppendLine("<text x='$($X + $W / 2)' y='$($Y + $H + 42)' text-anchor='middle' font-size='13' font-weight='700'>Number of trading requests</text>")
    [void]$Svg.AppendLine("<text transform='translate($($X - 55),$($Y + $H / 2)) rotate(-90)' text-anchor='middle' font-size='13' font-weight='700'>$(Svg-Escape $YLabel)</text>")

    if ($Legend) {
        if ($LegendPosition -eq "top") {
            $legendHeight = 48
            $legendWidth = $W
            $legendX = $X
            $legendY = $Y - 62
        } else {
            $legendHeight = 8 + 15 * $Series.Count
            $legendWidth = 178
        }
        if ($LegendPosition -eq "right") {
            $legendX = $X + $W + 18
            $legendY = $Y + 12
        } elseif ($LegendPosition -eq "upper-left") {
            $legendX = $X + 8
            $legendY = $Y + 8
        } elseif ($LegendPosition -ne "top") {
            $legendX = $X + 8
            $legendY = $Y + $H - $legendHeight - 8
        }
        [void]$Svg.AppendLine("<rect x='$legendX' y='$legendY' width='$legendWidth' height='$legendHeight' fill='white' stroke='#cccccc' stroke-width='0.8' opacity='0.92'/>")
        $legendItemY = $legendY + 15
        $legendIndex = 0
    } else {
        $legendY = $Y + 2
        $legendItemY = $legendY
        $legendIndex = 0
    }
    foreach ($series in $Series) {
        $points = New-Object System.Collections.Generic.List[string]
        foreach ($row in @($series.data | Sort-Object request_size)) {
            $meanName = "${Metric}_mean"
            $ciName = "${Metric}_ci95"
            $px = Scale-Linear ([double]$row.request_size) $xMin $xMax $X ($X + $W)
            $py = Scale-Linear ([double]$row.$meanName) $yMin $yMax ($Y + $H) $Y
            $ci = [double]$row.$ciName
            $pyLow = Scale-Linear ([double]$row.$meanName - $ci) $yMin $yMax ($Y + $H) $Y
            $pyHigh = Scale-Linear ([double]$row.$meanName + $ci) $yMin $yMax ($Y + $H) $Y
            $points.Add(("{0:N2},{1:N2}" -f $px, $py))
            [void]$Svg.AppendLine("<circle cx='$px' cy='$py' r='3' fill='$($series.color)'/>")
        }
        $dashAttr = $(if ($series.dash) { " stroke-dasharray='$($series.dash)'" } else { "" })
        [void]$Svg.AppendLine("<polyline points='$($points -join " ")' fill='none' stroke='$($series.color)' stroke-width='2'$dashAttr/>")
        if ($Legend) {
            if ($LegendPosition -eq "top") {
                $itemX = $legendX + 12 + (($legendIndex % 2) * ($legendWidth / 2))
                $itemY = $legendY + 16 + ([math]::Floor($legendIndex / 2) * 20)
            } else {
                $itemX = $legendX + 8
                $itemY = $legendItemY
                $legendItemY += 15
            }
            [void]$Svg.AppendLine("<line x1='$itemX' y1='$itemY' x2='$($itemX + 22)' y2='$itemY' stroke='$($series.color)' stroke-width='2.4'$dashAttr/>")
            [void]$Svg.AppendLine("<circle cx='$($itemX + 11)' cy='$itemY' r='3.2' fill='$($series.color)'/>")
            [void]$Svg.AppendLine("<text x='$($itemX + 30)' y='$($itemY + 4)' font-size='11' font-weight='700'>$(Svg-Escape $series.label)</text>")
            $legendIndex += 1
        }
    }
}

function Build-TransferBaselineData([object[]]$Summary, [object[]]$RequestSizes, [string]$Case) {
    $transfer = @($Summary | Where-Object { $_.experiment -eq "transfer_baseline" -and $_.workload -eq "transfer" -and $_.case -eq $Case })
    if ($transfer.Count -eq 0) { return @() }
    $throughputMean = Get-Mean @($transfer | ForEach-Object { [double]$_.throughput_tps_mean })
    $latencyMean = Get-Mean @($transfer | ForEach-Object { [double]$_.avg_latency_s_mean })
    return @($RequestSizes | Sort-Object -Unique | ForEach-Object {
        [pscustomobject]@{
            request_size = [int]$_
            throughput_tps_mean = $throughputMean
            throughput_tps_ci95 = 0.0
            avg_latency_s_mean = $latencyMean
            avg_latency_s_ci95 = 0.0
        }
    })
}

function Write-MainSvg([object[]]$Summary) {
    $main = @($Summary | Where-Object { $_.experiment -eq "main" -and $_.workload -eq "trading" })
    $requestSizes = @($main | Select-Object -ExpandProperty request_size -Unique | Sort-Object)
    $transferNoAggregation = Build-TransferBaselineData $Summary $requestSizes "no_aggregation"
    $transferWithAggregation = Build-TransferBaselineData $Summary $requestSizes "with_aggregation"
    $series = @(
        @{ label = "Trading, aggregation=No"; color = "#1f77b4"; data = @($main | Where-Object { $_.case -eq "no_aggregation" }) },
        @{ label = "Trading, aggregation=Yes"; color = "#ff7f0e"; dash = "5 3"; data = @($main | Where-Object { $_.case -eq "with_aggregation" }) },
        @{ label = "Transfer, aggregation=No"; color = "#2ca02c"; dash = "7 3 2 3"; data = $transferNoAggregation },
        @{ label = "Transfer, aggregation=Yes"; color = "#d62728"; dash = "2 3"; data = $transferWithAggregation }
    )
    $svg = [System.Text.StringBuilder]::new()
    [void]$svg.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='1800' height='560' viewBox='0 0 1800 560'>")
    [void]$svg.AppendLine("<rect width='100%' height='100%' fill='white'/>")
    [void]$svg.AppendLine("<g font-family='Arial, Helvetica, sans-serif' fill='#222'>")
    Add-Panel $svg 90 120 700 310 $series "throughput_tps" "Throughput (TPS)" "" "" "top" -Legend
    Add-Panel $svg 1000 120 700 310 $series "avg_latency_s" "Avg Latency (s)" "" "" "top" -Legend
    [void]$svg.AppendLine("</g></svg>")
    Set-Content -Path (Join-Path $FiguresDir "main_performance.svg") -Value $svg.ToString() -Encoding UTF8

    $throughputSvg = [System.Text.StringBuilder]::new()
    [void]$throughputSvg.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='940' height='560' viewBox='0 0 940 560'>")
    [void]$throughputSvg.AppendLine("<rect width='100%' height='100%' fill='white'/>")
    [void]$throughputSvg.AppendLine("<g font-family='Arial, Helvetica, sans-serif' fill='#222'>")
    Add-Panel $throughputSvg 92 120 790 310 $series "throughput_tps" "Throughput (TPS)" "" "" "top" -Legend
    [void]$throughputSvg.AppendLine("</g></svg>")
    Set-Content -Path (Join-Path $FiguresDir "main_throughput.svg") -Value $throughputSvg.ToString() -Encoding UTF8

    $latencySvg = [System.Text.StringBuilder]::new()
    [void]$latencySvg.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='940' height='560' viewBox='0 0 940 560'>")
    [void]$latencySvg.AppendLine("<rect width='100%' height='100%' fill='white'/>")
    [void]$latencySvg.AppendLine("<g font-family='Arial, Helvetica, sans-serif' fill='#222'>")
    Add-Panel $latencySvg 92 120 790 310 $series "avg_latency_s" "Avg Latency (s)" "" "" "top" -Legend
    [void]$latencySvg.AppendLine("</g></svg>")
    Set-Content -Path (Join-Path $FiguresDir "main_latency.svg") -Value $latencySvg.ToString() -Encoding UTF8
}

function Write-ThresholdSvg([object[]]$Summary) {
    $threshold = @($Summary | Where-Object { $_.experiment -eq "threshold" -and $_.workload -eq "trading" })
    $thresholdSizes = @($threshold | Select-Object -ExpandProperty request_size -Unique | Sort-Object)
    $noAggregation = @($Summary | Where-Object {
        $_.experiment -eq "main" -and $_.workload -eq "trading" -and $_.case -eq "no_aggregation" -and $thresholdSizes -contains $_.request_size
    })
    $colors = @{ 2000 = "#0072B2"; 4000 = "#E69F00"; 6000 = "#009E73" }
    $series = @()
    foreach ($value in @($threshold | Select-Object -ExpandProperty threshold -Unique | Sort-Object)) {
        $dash = $(if ([int]$value -eq 2000) { "" } elseif ([int]$value -eq 4000) { "7 3" } else { "7 3 2 3" })
        $series += @{ label = "Threshold = $value"; color = $colors[[int]$value]; dash = $dash; data = @($threshold | Where-Object { [int]$_.threshold -eq [int]$value }) }
    }
    $series += @{ label = "No aggregation"; color = "#D55E00"; dash = "2 3"; data = $noAggregation }
    $svg = [System.Text.StringBuilder]::new()
    [void]$svg.AppendLine("<svg xmlns='http://www.w3.org/2000/svg' width='1800' height='560' viewBox='0 0 1800 560'>")
    [void]$svg.AppendLine("<rect width='100%' height='100%' fill='white'/>")
    [void]$svg.AppendLine("<g font-family='Arial, Helvetica, sans-serif' fill='#222'>")
    Add-Panel $svg 90 120 700 310 $series "throughput_tps" "Throughput (TPS)" "" "" "top" -Legend
    Add-Panel $svg 1000 120 700 310 $series "avg_latency_s" "Avg Latency (s)" "" "" "top" -Legend
    [void]$svg.AppendLine("</g></svg>")
    Set-Content -Path (Join-Path $FiguresDir "threshold_sensitivity.svg") -Value $svg.ToString() -Encoding UTF8
}

function Escape-XmlText([object]$Value) {
    if ($null -eq $Value) { return "" }
    return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Write-Utf8File([string]$Path, [string]$Value) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Write-XlsxSheet([string]$Path, [object[]]$Rows) {
    $columns = @()
    if ($Rows.Count -gt 0) {
        $columns = @($Rows[0].PSObject.Properties | ForEach-Object { $_.Name })
    }
    $xml = [System.Text.StringBuilder]::new()
    [void]$xml.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$xml.AppendLine('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    [void]$xml.AppendLine('<sheetData>')

    [void]$xml.AppendLine('<row r="1">')
    foreach ($column in $columns) {
        [void]$xml.AppendLine("<c t=""inlineStr""><is><t>$(Escape-XmlText $column)</t></is></c>")
    }
    [void]$xml.AppendLine('</row>')

    $rowIndex = 2
    foreach ($row in $Rows) {
        [void]$xml.AppendLine("<row r=""$rowIndex"">")
        foreach ($column in $columns) {
            [void]$xml.AppendLine("<c t=""inlineStr""><is><t>$(Escape-XmlText $row.$column)</t></is></c>")
        }
        [void]$xml.AppendLine('</row>')
        $rowIndex += 1
    }

    [void]$xml.AppendLine('</sheetData>')
    [void]$xml.AppendLine('</worksheet>')
    Write-Utf8File $Path $xml.ToString()
}

function Export-SimpleXlsx([string]$Path, [hashtable]$Sheets) {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("caliper_xlsx_" + [guid]::NewGuid().ToString("N"))
    $xlDir = Join-Path $tempRoot "xl"
    $worksheetsDir = Join-Path $xlDir "worksheets"
    $relsDir = Join-Path $tempRoot "_rels"
    $xlRelsDir = Join-Path $xlDir "_rels"
    New-Item -ItemType Directory -Force $worksheetsDir, $relsDir, $xlRelsDir | Out-Null

    $sheetNames = @($Sheets.Keys)
    $contentTypes = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>
'@
    Write-Utf8File (Join-Path $tempRoot "[Content_Types].xml") $contentTypes

    $rootRels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
'@
    Write-Utf8File (Join-Path $relsDir ".rels") $rootRels

    $workbook = [System.Text.StringBuilder]::new()
    [void]$workbook.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$workbook.AppendLine('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>')

    $workbookRels = [System.Text.StringBuilder]::new()
    [void]$workbookRels.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$workbookRels.AppendLine('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')

    for ($i = 0; $i -lt $sheetNames.Count; $i++) {
        $sheetId = $i + 1
        $sheetName = $sheetNames[$i]
        $safeSheetName = Escape-XmlText $sheetName
        [void]$workbook.AppendLine("<sheet name=""$safeSheetName"" sheetId=""$sheetId"" r:id=""rId$sheetId""/>")
        [void]$workbookRels.AppendLine("<Relationship Id=""rId$sheetId"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"" Target=""worksheets/sheet$sheetId.xml""/>")
        Write-XlsxSheet (Join-Path $worksheetsDir "sheet$sheetId.xml") @($Sheets[$sheetName])
    }

    [void]$workbook.AppendLine('</sheets></workbook>')
    [void]$workbookRels.AppendLine('</Relationships>')
    Write-Utf8File (Join-Path $xlDir "workbook.xml") $workbook.ToString()
    Write-Utf8File (Join-Path $xlRelsDir "workbook.xml.rels") $workbookRels.ToString()

    if (Test-Path $Path) {
        Remove-Item -LiteralPath $Path -Force
    }
    $zipPath = "$Path.zip"
    if (Test-Path $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path (Join-Path $tempRoot "*") -DestinationPath $zipPath -Force
    Move-Item -LiteralPath $zipPath -Destination $Path -Force
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Host "Starting aggregation-trading Caliper analysis (PowerShell version)..."
Write-Host "Results directory: $ResultsDir"
Ensure-RawResults
Write-Host "Raw result directory: $RawRoot"
New-Item -ItemType Directory -Force $ProcessedDir, $FiguresDir | Out-Null

$records = Collect-Records
if ($records.Count -eq 0) { throw "No Caliper records found under $RawRoot" }
$summary = Build-Summary $records
$improvement = Build-Improvement $summary
$overallImprovement = Build-OverallImprovementSummary $improvement

$records | Export-Csv (Join-Path $ProcessedDir "caliper_raw_observations.csv") -NoTypeInformation -Encoding UTF8
$records | Where-Object { $_.experiment -in @("main", "transfer_baseline") } | Export-Csv (Join-Path $ProcessedDir "main_observations.csv") -NoTypeInformation -Encoding UTF8
$summary | Where-Object { $_.experiment -in @("main", "transfer_baseline") } | Export-Csv (Join-Path $ProcessedDir "main_summary_stats.csv") -NoTypeInformation -Encoding UTF8
$records | Where-Object { $_.experiment -eq "threshold" } | Export-Csv (Join-Path $ProcessedDir "threshold_observations.csv") -NoTypeInformation -Encoding UTF8
$summary | Where-Object { $_.experiment -eq "threshold" } | Export-Csv (Join-Path $ProcessedDir "threshold_summary_stats.csv") -NoTypeInformation -Encoding UTF8
$improvement | Export-Csv (Join-Path $ProcessedDir "aggregation_improvement.csv") -NoTypeInformation -Encoding UTF8
$overallImprovement | Export-Csv (Join-Path $ProcessedDir "overall_improvement_summary.csv") -NoTypeInformation -Encoding UTF8

Export-SimpleXlsx (Join-Path $ProcessedDir "caliper_analysis_tables.xlsx") @{
    raw_observations = $records
    main_summary = @($summary | Where-Object { $_.experiment -in @("main", "transfer_baseline") })
    threshold_summary = @($summary | Where-Object { $_.experiment -eq "threshold" })
    improvement = $improvement
    overall_improvement = $overallImprovement
}

Write-Host "Parsed observations: $($records.Count)"
Write-Host "Summary groups: $($summary.Count)"
Write-Host "Processed tables:"
Get-ChildItem $ProcessedDir -File | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host "Figure generation skipped. Use plot_notebook_style.py after these processed tables are created."
