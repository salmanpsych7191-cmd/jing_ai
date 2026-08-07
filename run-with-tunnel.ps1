$workspace = "D:\projects1\azure\Jing_ai"
$backendLog = "$workspace\.backend.log"
$backendErrLog = "$workspace\.backend.err.log"
$tunnelLog = "$workspace\.tunnel.log"
$pythonExe = "$workspace\.venv-1\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    Write-Host "Virtual environment not found at $pythonExe" -ForegroundColor Red
    Write-Host "Run: python -m venv .venv-1 ; .venv-1\Scripts\python.exe -m pip install -r requirements.txt" -ForegroundColor Yellow
    pause
    exit 1
}

Remove-Item $backendLog, $backendErrLog, $tunnelLog -Force -ErrorAction SilentlyContinue

# Start the Cloudflare tunnel FIRST so we know the public URL before the backend
# starts — the app needs PUBLIC_BASE_URL at startup for Twilio signature checks
# and for building the correct wss:// media-stream URL for phone calls.
$tunnelProcess = Start-Process -FilePath "$workspace\cloudflared.exe" `
    -ArgumentList "tunnel --logfile `"$tunnelLog`" --url http://127.0.0.1:8000" `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Starting public tunnel ..." -ForegroundColor Cyan

$url = $null
for ($i = 0; $i -lt 60; $i++) {
    if (Test-Path $tunnelLog) {
        $content = Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $url = $matches[0]
            break
        }
    }
    Start-Sleep -Milliseconds 500
}

if (-not $url) {
    Write-Host "Tunnel URL not found. Check $tunnelLog" -ForegroundColor Red
    Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    pause
    exit 1
}

Write-Host "Tunnel URL: $url" -ForegroundColor Green

# Start backend with PUBLIC_BASE_URL set to this run's tunnel URL (dotenv won't
# override an already-set env var, so this takes precedence over the blank
# value in .env).
$env:PUBLIC_BASE_URL = $url
Start-Process -FilePath $pythonExe `
    -ArgumentList "-m uvicorn restaurant_agent.app:app --host 127.0.0.1 --port 8000" `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErrLog

Write-Host "Starting backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -Method GET -TimeoutSec 1 | Out-Null
        $ready = $true
        break
    } catch {}
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Write-Host "Backend failed to start. Check $backendLog / $backendErrLog" -ForegroundColor Red
    Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    pause
    exit 1
}

Write-Host "Backend is ready." -ForegroundColor Green

# Read dashboard credentials from .env to display them
$dashboardUser = (Get-Content "$workspace\.env" | Where-Object { $_ -match '^DASHBOARD_USERNAME=' }) -replace '^DASHBOARD_USERNAME=', ''
$dashboardPass = (Get-Content "$workspace\.env" | Where-Object { $_ -match '^DASHBOARD_PASSWORD=' }) -replace '^DASHBOARD_PASSWORD=', ''

$webhookUrl = "$url/webhook/whatsapp"
$sandboxNumber = "+14155238886"
$sandboxCode = "black-hour"
$sandboxLink = "https://api.whatsapp.com/send/?phone=14155238886&text=join%20$sandboxCode&type=phone_number&app_absent=0"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "Public URL:      $url" -ForegroundColor Green
Write-Host "Dashboard login: $dashboardUser / $dashboardPass" -ForegroundColor Green
Write-Host "WhatsApp webhook:$webhookUrl" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Paste the WhatsApp webhook URL into Twilio Sandbox 'When a message comes in':" -ForegroundColor Yellow
Write-Host $webhookUrl -ForegroundColor Yellow
Write-Host ""
Write-Host "Twilio WhatsApp Sandbox number: $sandboxNumber" -ForegroundColor Cyan
Write-Host "Sandbox join link: $sandboxLink" -ForegroundColor Cyan
Write-Host ""
Write-Host "Phone calling is NOT demoable yet: TWILIO_VOICE_NUMBER and STAFF_TRANSFER_NUMBER are still blank in .env." -ForegroundColor DarkYellow
Write-Host ""

try {
    Set-Clipboard -Value $webhookUrl
    Write-Host "(Webhook URL copied to clipboard)" -ForegroundColor Gray
} catch {
    Write-Host "(Could not copy to clipboard automatically)" -ForegroundColor Gray
}

Start-Process $url

Write-Host ""
Write-Host "Keep this window open. Press any key to stop backend and tunnel..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object { $_.CommandLine -like "*uvicorn*restaurant_agent*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Stopped." -ForegroundColor Green
