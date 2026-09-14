# PowerShell Web Server
Param(
    [parameter(Mandatory=$true)][Int]$port,
    [parameter(Mandatory=$false)][String]$webPath="www",
    [parameter(Mandatory=$false)][String]$controllerPath="controller"
)

$MIMEHASH = @{".avi"="video/x-msvideo"; ".crt"="application/x-x509-ca-cert"; ".css"="text/css"; ".der"="application/x-x509-ca-cert"; ".doc"="application/msword"; ".flv"="video/x-flv"; ".gif"="image/gif"; ".htm"="text/html"; ".html"="text/html"; ".ico"="image/x-icon"; ".jar"="application/java-archive"; ".jpeg"="image/jpeg"; ".jpg"="image/jpeg"; ".js"="application/javascript"; ".json"="application/json"; ".mjs"="application/javascript"; ".mov"="video/quicktime"; ".mp3"="audio/mpeg"; ".mp4"="video/mp4"; ".mpeg"="video/mpeg"; ".mpg"="video/mpeg"; ".pdf"="application/pdf"; ".pem"="application/x-x509-ca-cert"; ".pl"="application/x-perl"; ".png"="image/png"; ".rss"="application/rss+xml"; ".shtml"="text/html"; ".svg"="image/svg+xml"; ".txt"="text/plain"; ".war"="application/java-archive"; ".wmv"="video/x-ms-wmv"; ".xml"="application/xml"; ".xsl"="application/xml"}

Add-Type -AssemblyName System.Web

$scriptPath = $PSScriptRoot

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add("http://localhost:$port/")
$http.Start()

function ConvertTo-Base64($str){
    $result = [Convert]::ToBase64String([System.Text.UTF8Encoding]::UTF8.GetBytes($str))
    return $result
}

function ConvertFrom-Base64($str){
    $byteArray = [Convert]::FromBase64String($str)
    return [System.Text.UTF8Encoding]::UTF8.GetString($byteArray)
}

function Send-WebResponse($context, $content) {
    if($content.GetType().Name -ne "String"){
        $content = ConvertTo-JSON -Depth 7 $content
    }
    Write-Host "JSON Response: " 
    Write-Host ($content | Format-Table | Out-String)
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($content)
    $context.Response.ContentLength64 = $buffer.Length
    $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
}

function Send-CleanWebResponse($context, $content) {
    if($content.GetType().Name -ne "String"){
        $content = ConvertTo-JSON -Depth 7 $content
    }
    #Write-Host "JSON Response: " 
    #Write-Host ($content | Format-Table | Out-String)
    
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($content)
    $context.Response.ContentLength64 = $buffer.Length
    $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
}


function Get-GetQueryString($context) {
    $queryString = $context.Request.QueryString
    $result = @{}
    foreach($key in $queryString.AllKeys){
        $result[$key] = $queryString[$key]
    }
    Write-Host "$result"
    return $result
}

function Get-PostData($context) {
    $reader = new-object System.IO.StreamReader($context.Request.InputStream)
    $text = $reader.ReadToEnd()
    $text = [System.Web.HttpUtility]::UrlDecode($text)
    Write-Host "$text"
    return ConvertFrom-Json $text
}

if ($http.IsListening) {
    write-host "HTTP Server Ready!  " -f 'black' -b 'gre'
    write-host "$($http.Prefixes)" -f 'y'
}

# INFINTE LOOP, Used to listen for requests
while ($http.IsListening) {
    $context = $http.GetContext()
    $RequestUrl = $context.Request.Url.LocalPath
    
    Write-Host "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) : $($context.Request.Url)" -f 'mag'

    # Get Request Url
    if ($context.Request.HttpMethod -eq 'GET') {       
        # if request url starts with /api, handle by controllers
        if($RequestUrl.StartsWith("/api")){
            $controllerFile = "$scriptPath/$controllerPath/$RequestUrl.ps1"
            $jsonObj = @{}
            if(Test-Path $controllerFile){
                try{
                    $getData = Get-GetQueryString $context
                    . $controllerFile
                }
                catch{
                    $jsonObj.status = "error"
                    $jsonObj.message = $_.ToString()
                    Send-WebResponse $context $jsonObj
                }
            }
            else{
                $jsonObj.status = "error"
                $jsonObj.message = "Unsupported API $RequestUrl"
                Send-WebResponse $context $jsonObj
            }
            $context.Response.Close()
            continue
        }

        # Redirect root to index.html
        if($RequestUrl -eq "/") {
          $RequestUrl = "/index.html"
        }
        Write-Host "$scriptPath\$webPath\$RequestUrl"
        if(Test-Path "$scriptPath\$webPath\$RequestUrl"){
            $fileStream = [System.IO.File]::OpenRead( "$scriptPath\$webPath\$RequestUrl" )

           
            $ext = [IO.Path]::GetExtension($context.Request.Url.LocalPath)
            
            if ($MIMEHASH.ContainsKey($ext))
            { # known mime type for this file's extension available
                Write-Host $MIMEHASH.Item($ext)
                $Context.Response.ContentType = $MIMEHASH.Item($ext)
            }
            $context.Response.ContentLength64 = $fileStream.Length
            $fileStream.CopyTo( $Context.Response.OutputStream)
         
         
            $fileStream.Close()

        }
        else{
            Send-WebResponse $context "404 : Not found $RequestUrl"            
        }
        $context.Response.Close()
    }
    
    # Post for APIs, handle by controllers
    if($context.Request.HttpMethod -eq "POST"){
        $controllerFile = "$scriptPath/$controllerPath/$RequestUrl.ps1"
        $jsonObj = @{
            "status" = "error"
            "message" = "Unsupported API $RequestUrl"
        }
        if(Test-Path $controllerFile){
            try{
                $postData = Get-PostData $context  
                . $controllerFile
            }
            catch{
                $jsonObj.message = $_.ToString()
                Send-WebResponse $context $jsonObj
            }
        }
        else{
            Send-WebResponse $context $jsonObj
        }
        $context.Response.Close()
    }
    # powershell will continue looping and listen for new requests...
    # Exit Web Server if logout
    if($RequestUrl -eq "/logout.html"){
        Write-Host "Exit Web Server"
        $http.Close();
        $http.Dispose();
        exit;
    }
}
