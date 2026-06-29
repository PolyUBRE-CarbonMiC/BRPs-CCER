$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..\..\..")
$ProcessedDir = Join-Path $Root "experiments\aggregation_trading\results\processed"

$MainSummary = Join-Path $ProcessedDir "main_summary_stats.csv"
$ThresholdSummary = Join-Path $ProcessedDir "threshold_summary_stats.csv"
$PlotSuffix = ([string][char]0x7ED8) + ([string][char]0x56FE) + ".xlsx"
$MainOut = Join-Path $ProcessedDir ("main" + $PlotSuffix)
$SensitivityOut = Join-Path $ProcessedDir ("sensitivity" + $PlotSuffix)

function Escape-XmlText([object]$Value) {
    if ($null -eq $Value) { return "" }
    return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Write-Utf8File([string]$Path, [string]$Value) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Write-XlsxSheet([string]$Path, [object[]]$Rows, [string[]]$Columns) {
    $xml = [System.Text.StringBuilder]::new()
    [void]$xml.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$xml.AppendLine('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    [void]$xml.AppendLine('<sheetData>')
    [void]$xml.AppendLine('<row r="1">')
    foreach ($column in $Columns) {
        [void]$xml.AppendLine("<c t=""inlineStr""><is><t>$(Escape-XmlText $column)</t></is></c>")
    }
    [void]$xml.AppendLine('</row>')

    $rowIndex = 2
    foreach ($row in $Rows) {
        [void]$xml.AppendLine("<row r=""$rowIndex"">")
        foreach ($column in $Columns) {
            [void]$xml.AppendLine("<c t=""inlineStr""><is><t>$(Escape-XmlText $row.$column)</t></is></c>")
        }
        [void]$xml.AppendLine('</row>')
        $rowIndex += 1
    }
    [void]$xml.AppendLine('</sheetData>')
    [void]$xml.AppendLine('</worksheet>')
    Write-Utf8File $Path $xml.ToString()
}

function Export-SimpleXlsx([string]$Path, [hashtable]$Sheets, [hashtable]$ColumnMap) {
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("plot_xlsx_" + [guid]::NewGuid().ToString("N"))
    $xlDir = Join-Path $tempRoot "xl"
    $worksheetsDir = Join-Path $xlDir "worksheets"
    $relsDir = Join-Path $tempRoot "_rels"
    $xlRelsDir = Join-Path $xlDir "_rels"
    New-Item -ItemType Directory -Force $worksheetsDir, $relsDir, $xlRelsDir | Out-Null

    Write-Utf8File (Join-Path $tempRoot "[Content_Types].xml") @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>
'@
    Write-Utf8File (Join-Path $relsDir ".rels") @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
'@

    $sheetNames = @($Sheets.Keys)
    $workbook = [System.Text.StringBuilder]::new()
    $workbookRels = [System.Text.StringBuilder]::new()
    [void]$workbook.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$workbook.AppendLine('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>')
    [void]$workbookRels.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$workbookRels.AppendLine('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')

    for ($i = 0; $i -lt $sheetNames.Count; $i++) {
        $sheetId = $i + 1
        $sheetName = $sheetNames[$i]
        [void]$workbook.AppendLine("<sheet name=""$(Escape-XmlText $sheetName)"" sheetId=""$sheetId"" r:id=""rId$sheetId""/>")
        [void]$workbookRels.AppendLine("<Relationship Id=""rId$sheetId"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"" Target=""worksheets/sheet$sheetId.xml""/>")
        Write-XlsxSheet (Join-Path $worksheetsDir "sheet$sheetId.xml") @($Sheets[$sheetName]) ([string[]]$ColumnMap[$sheetName])
    }

    [void]$workbook.AppendLine('</sheets></workbook>')
    [void]$workbookRels.AppendLine('</Relationships>')
    Write-Utf8File (Join-Path $xlDir "workbook.xml") $workbook.ToString()
    Write-Utf8File (Join-Path $xlRelsDir "workbook.xml.rels") $workbookRels.ToString()

    if (Test-Path $Path) { Remove-Item -LiteralPath $Path -Force }
    $zipPath = "$Path.zip"
    if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $tempRoot "*") -DestinationPath $zipPath -Force
    Move-Item -LiteralPath $zipPath -Destination $Path -Force
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

function Is-TrueValue([object]$Value) {
    return ([string]$Value).Trim().ToLowerInvariant() -in @("true", "1", "yes")
}

function Select-PlotColumns([object[]]$Rows) {
    $columns = @(
        "series", "case", "aggregation", "workload", "threshold", "request_size",
        "n_runs", "repeats", "succ_mean", "fail_mean", "success_rate_mean",
        "throughput_tps_mean", "throughput_tps_ci95",
        "avg_latency_s_mean", "avg_latency_s_ci95"
    )
    $Rows | ForEach-Object {
        $ordered = [ordered]@{}
        foreach ($column in $columns) {
            $ordered[$column] = $_.$column
        }
        [pscustomobject]$ordered
    }
}

if (!(Test-Path $MainSummary)) { throw "Missing $MainSummary" }
if (!(Test-Path $ThresholdSummary)) { throw "Missing $ThresholdSummary" }

$main = @(Import-Csv $MainSummary)
$threshold = @(Import-Csv $ThresholdSummary)

$mainPlot = @(
    $main |
    Where-Object { $_.workload -in @("trading", "transfer") } |
    ForEach-Object {
        $agg = if (Is-TrueValue $_.aggregation) { "with aggregation" } else { "no aggregation" }
        $_ | Add-Member -NotePropertyName series -NotePropertyValue "$((Get-Culture).TextInfo.ToTitleCase($_.workload)) ($agg)" -Force
        $_
    } |
    Sort-Object series, {[int]$_.request_size}
)
$mainPlot = @(Select-PlotColumns $mainPlot)

$thresholdSizes = @($threshold | ForEach-Object { [int]$_.request_size } | Sort-Object -Unique)
$thresholdPlot = @(
    $threshold |
    Where-Object { $_.workload -eq "trading" } |
    ForEach-Object {
        $_ | Add-Member -NotePropertyName series -NotePropertyValue "Threshold = $([int][double]$_.threshold)" -Force
        $_
    }
)
$noAgg = @(
    $main |
    Where-Object { $_.workload -eq "trading" -and $_.case -eq "no_aggregation" -and $thresholdSizes -contains [int]$_.request_size } |
    ForEach-Object {
        $_.threshold = ""
        $_ | Add-Member -NotePropertyName series -NotePropertyValue "Trading (no aggregation)" -Force
        $_
    }
)
$sensitivityPlot = @($thresholdPlot + $noAgg | Sort-Object series, {[int]$_.request_size})
$sensitivityPlot = @(Select-PlotColumns $sensitivityPlot)

$transferReference = @(
    $main |
    Where-Object { $_.workload -eq "transfer" } |
    ForEach-Object {
        $agg = if (Is-TrueValue $_.aggregation) { "with aggregation" } else { "no aggregation" }
        $_ | Add-Member -NotePropertyName series -NotePropertyValue "Transfer ($agg)" -Force
        $_
    } |
    Sort-Object series, {[int]$_.request_size}
)
$transferReference = @(Select-PlotColumns $transferReference)

$columns = @(
    "series", "case", "aggregation", "workload", "threshold", "request_size",
    "n_runs", "repeats", "succ_mean", "fail_mean", "success_rate_mean",
    "throughput_tps_mean", "throughput_tps_ci95",
    "avg_latency_s_mean", "avg_latency_s_ci95"
)

Export-SimpleXlsx $MainOut @{ "main_plot" = $mainPlot } @{ "main_plot" = $columns }
Export-SimpleXlsx $SensitivityOut @{
    "sensitivity_plot" = $sensitivityPlot
    "transfer_reference" = $transferReference
} @{
    "sensitivity_plot" = $columns
    "transfer_reference" = $columns
}

Write-Host "Wrote $MainOut"
Write-Host "Wrote $SensitivityOut"
