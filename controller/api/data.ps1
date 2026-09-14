# postData 
$content = $postData | ConvertTo-Json

$dataPath = "$scriptPath/www/data"

$currentTime = Get-Date -f "yyyy-MM-dd-HH-mm-ss"

copy-item "$dataPath/daily-work.json" "$dataPath/daily-work-$currentTime.json"

$content | out-file "$dataPath/daily-work.json"

$response = @{
    status = "success"
    data = "$dataPath/daily-work-$currentTime.json"
}

Send-WebResponse $context $response