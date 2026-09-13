# Daily Workbench — local HTTP server (stock Windows PowerShell / pwsh)
# Serves the static workbench from this script's directory.
# Reads/writes daily-work.json in the *working directory* (Get-Location).
# Host/port come from config.js (same file the browser loads).

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$cwd = (Get-Location).Path
$jsonPath = Join-Path $cwd "daily-work.json"
$configPath = Join-Path $scriptDir "config.js"

function Read-ServerConfig {
    $cfg = @{
        Host = "127.0.0.1"
        Port = 8787
        Path = "/api/data"
    }
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        return $cfg
    }
    $text = [System.IO.File]::ReadAllText($configPath)
    if ($text -match 'host\s*:\s*"([^"]+)"' -or $text -match "host\s*:\s*'([^']+)'") {
        $cfg.Host = $Matches[1].Trim()
    }
    if ($text -match 'port\s*:\s*(\d+)') {
        $cfg.Port = [int]$Matches[1]
    }
    if ($text -match 'path\s*:\s*"([^"]+)"' -or $text -match "path\s*:\s*'([^']+)'") {
        $p = $Matches[1].Trim()
        if (-not $p.StartsWith("/")) { $p = "/$p" }
        $p = $p.TrimEnd("/")
        if (-not $p) { $p = "/api/data" }
        $cfg.Path = $p
    }
    if (-not $cfg.Host) { $cfg.Host = "127.0.0.1" }
    if ($cfg.Port -lt 1 -or $cfg.Port -gt 65535) { $cfg.Port = 8787 }
    return $cfg
}

$cfg = Read-ServerConfig
$listenHost = $cfg.Host
$listenPort = $cfg.Port
$apiPath = $cfg.Path

$allowedStatic = @{
    "/"            = "index.html"
    "/index.html"  = "index.html"
    "/styles.css"  = "styles.css"
    "/app.js"      = "app.js"
    "/sw.js"       = "sw.js"
    "/config.js"   = "config.js"
    "/README.md"   = "README.md"
}

$contentTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".md"   = "text/markdown; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
}

function Get-EmptyEnvelopeJson {
    $exportedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    return (@'
{
  "version": 3,
  "app": "daily-workbench",
  "exportedAt": "EXPORTED_AT",
  "timezone": "Asia/Hong_Kong",
  "data": {
    "version": 3,
    "seeded": false,
    "tasksByDate": {},
    "events": [],
    "scratch": "",
    "notes": [],
    "waterReminder": {
      "enabled": false,
      "intervalMinutes": 60,
      "lastNotifiedAt": null
    }
  }
}
'@ -replace "EXPORTED_AT", $exportedAt)
}

function Add-CorsHeaders {
    param($response)
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $response.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
}

function Write-Bytes {
    param($response, [int]$status, [string]$contentType, [byte[]]$bytes, [switch]$Cors)
    if ($Cors) { Add-CorsHeaders $response }
    $response.StatusCode = $status
    if ($contentType) { $response.ContentType = $contentType }
    if ($null -eq $bytes) { $bytes = [byte[]]@() }
    $response.ContentLength64 = $bytes.Length
    if ($bytes.Length -gt 0) {
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $response.OutputStream.Close()
}

function Write-Text {
    param($response, [int]$status, [string]$contentType, [string]$text, [switch]$Cors)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    Write-Bytes $response $status $contentType $bytes -Cors:$Cors
}

function Get-SafeStaticFile {
    param([string]$rawPath)
    $key = $rawPath
    if ([string]::IsNullOrEmpty($key) -or $key -eq "/") { $key = "/" }
    if (-not $allowedStatic.ContainsKey($key)) { return $null }
    $name = $allowedStatic[$key]
    if ($name -match '[\\/]' -or $name.Contains("..")) { return $null }
    $full = Join-Path $scriptDir $name
    $fullResolved = [System.IO.Path]::GetFullPath($full)
    $rootResolved = [System.IO.Path]::GetFullPath($scriptDir)
    $rootPrefix = $rootResolved.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullResolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    if (-not (Test-Path -LiteralPath $fullResolved -PathType Leaf)) { return $null }
    return $fullResolved
}

function Handle-Request {
    param($context)
    $request = $context.Request
    $response = $context.Response
    $method = $request.HttpMethod.ToUpperInvariant()
    $path = $request.Url.AbsolutePath
    if ([string]::IsNullOrEmpty($path)) { $path = "/" }
    if ($path.Length -gt 1) { $path = $path.TrimEnd("/") }

    try {
        if ($path -eq $apiPath) {
            if ($method -eq "OPTIONS") {
                Add-CorsHeaders $response
                $response.StatusCode = 204
                $response.ContentLength64 = 0
                $response.OutputStream.Close()
                return
            }

            if ($method -eq "GET") {
                if (Test-Path -LiteralPath $jsonPath -PathType Leaf) {
                    $bytes = [System.IO.File]::ReadAllBytes($jsonPath)
                    Write-Bytes $response 200 "application/json; charset=utf-8" $bytes -Cors
                } else {
                    Write-Text $response 200 "application/json; charset=utf-8" (Get-EmptyEnvelopeJson) -Cors
                }
                return
            }

            if ($method -eq "POST") {
                $ms = New-Object System.IO.MemoryStream
                $request.InputStream.CopyTo($ms)
                $body = $ms.ToArray()
                $utf8NoBom = New-Object System.Text.UTF8Encoding $false
                if ($body.Length -eq 0) {
                    [System.IO.File]::WriteAllText($jsonPath, "", $utf8NoBom)
                } else {
                    [System.IO.File]::WriteAllBytes($jsonPath, $body)
                }
                Write-Text $response 200 "application/json; charset=utf-8" '{"ok":true}' -Cors
                return
            }

            Write-Text $response 405 "application/json; charset=utf-8" '{"ok":false,"error":"method not allowed"}' -Cors
            return
        }

        if ($method -eq "OPTIONS") {
            Add-CorsHeaders $response
            $response.StatusCode = 204
            $response.ContentLength64 = 0
            $response.OutputStream.Close()
            return
        }

        if ($method -ne "GET" -and $method -ne "HEAD") {
            Write-Text $response 405 "text/plain; charset=utf-8" "Method Not Allowed"
            return
        }

        $file = Get-SafeStaticFile $path
        if (-not $file) {
            Write-Text $response 404 "text/plain; charset=utf-8" "Not Found"
            return
        }

        $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        $ctype = "application/octet-stream"
        if ($contentTypes.ContainsKey($ext)) { $ctype = $contentTypes[$ext] }
        $bytes = [System.IO.File]::ReadAllBytes($file)
        if ($method -eq "HEAD") {
            Add-CorsHeaders $response
            $response.StatusCode = 200
            $response.ContentType = $ctype
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Close()
            return
        }
        Write-Bytes $response 200 $ctype $bytes
    } catch {
        try {
            $msg = ($_ | Out-String).Trim()
            $safe = ($msg -replace '\\', '\\' -replace '"', '\"')
            Write-Text $response 500 "application/json; charset=utf-8" "{`"ok`":false,`"error`":`"$safe`"}" -Cors
        } catch {
            try { $response.OutputStream.Close() } catch { }
        }
    }
}

function Try-StartListener {
    param([string]$prefix)
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    return $listener
}

$primaryPrefix = "http://${listenHost}:${listenPort}/"
$listenPrefix = $primaryPrefix
$listener = $null

try {
    $listener = Try-StartListener $primaryPrefix
} catch {
    Write-Warning "Cannot listen on $primaryPrefix : $($_.Exception.Message)"
    if ($listenHost -eq "127.0.0.1") {
        $fallback = "http://localhost:${listenPort}/"
        Write-Host "Retrying $fallback ..."
        try {
            $listener = Try-StartListener $fallback
            $listenPrefix = $fallback
        } catch {
            Write-Host ""
            Write-Host "Listen failed. If this is an access / reservation error, run as Administrator:"
            Write-Host "  netsh http add urlacl url=$primaryPrefix user=Everyone"
            Write-Host "Then also try:"
            Write-Host "  netsh http add urlacl url=$fallback user=Everyone"
            throw
        }
    } else {
        Write-Host ""
        Write-Host "Listen failed. If this is an access / reservation error, run as Administrator:"
        Write-Host "  netsh http add urlacl url=$primaryPrefix user=Everyone"
        throw
    }
}

Write-Host "Daily Workbench local server"
Write-Host "  Script directory : $scriptDir"
Write-Host "  Working directory: $cwd"
Write-Host "  JSON file        : $jsonPath"
Write-Host "  API              : $listenPrefix$($apiPath.TrimStart('/'))"
Write-Host "  Open in browser  : $listenPrefix"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $null
        try {
            $context = $listener.GetContext()
        } catch [System.Net.HttpListenerException] {
            break
        } catch [System.ObjectDisposedException] {
            break
        }
        if ($null -eq $context) { continue }
        Handle-Request $context
    }
} finally {
    try {
        if ($listener -and $listener.IsListening) { $listener.Stop() }
    } catch { }
    try {
        if ($listener) { $listener.Close() }
    } catch { }
    Write-Host "Server stopped."
}
