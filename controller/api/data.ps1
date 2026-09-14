# postData
$content = $postData | ConvertTo-Json -Depth 100

$dataPath = "$scriptPath/www/data"
if (-not (Test-Path $dataPath)) {
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
}

$currentTime = Get-Date -f "yyyy-MM-dd-HH-mm-ss"
$jsonPath = "$dataPath/daily-work.json"
$backupPath = "$dataPath/daily-work-$currentTime.json"

if (Test-Path $jsonPath) {
    Copy-Item $jsonPath $backupPath
}

$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($jsonPath, $content, $utf8)

$response = @{
    status = "success"
    data = $(if (Test-Path $backupPath) { $backupPath } else { $jsonPath })
}

Send-WebResponse $context $response
