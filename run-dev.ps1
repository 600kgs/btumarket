# ============================================================
#  BTU Marketplace - backend development server (one-click start)
#  Lives at the repo root, alongside backend/ and frontend/, then:
#  right-click -> "Run with PowerShell"
#
#  This starts the API only (port 8001). For the actual site UI, also run
#  `npm run dev` in frontend/ (port 5173, proxies API calls here) - :8001
#  alone has nothing to serve unless frontend/dist has been built.
# ============================================================

# --- Dev settings (safe defaults for your local PC only) ---
$env:MARKETPLACE_DEV = "1"                          # allows running without a secret key
$env:MARKETPLACE_REQUIRE_EMAIL_VERIFICATION = "0"   # register test accounts instantly
$env:MARKETPLACE_ADMINS = "your_username"           # <-- change to your username to test /admin
# Dev-mode "emails" are print()ed to this console; without this, the Georgian
# text in them crashes Python's print on Windows (cp1252 can't encode it),
# turning any email-sending endpoint into a 500 locally.
$env:PYTHONIOENCODING = "utf-8"

# Always run from the folder this script lives in
Set-Location $PSScriptRoot

# --- Find Python (works even when it's not on PATH) ---
$python = $null
foreach ($candidate in @("python", "py", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe")) {
    try {
        $v = & $candidate --version 2>$null
        if ($v -match "Python 3") { $python = $candidate; break }
    } catch { }
}
if (-not $python) {
    Write-Host "Could not find Python. Install it from python.org and tick 'Add to PATH'." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
Write-Host "Using Python: $python" -ForegroundColor DarkGray

# The app (main.py, marketplace.db, uploads/) lives in backend/ - everything
# below assumes that's the working directory (relative paths in main.py, e.g.
# the SQLite path and the frontend/dist static mount, depend on it).
Set-Location (Join-Path $PSScriptRoot "backend")

# Open the API docs in your browser after 3 seconds (gives the server time to
# boot) - not the site itself, since :8001 has no frontend to show unless
# frontend/dist was built. Run `npm run dev` in frontend/ for the real UI.
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://127.0.0.1:8001/docs"
} | Out-Null

# Best-effort: find this PC's LAN IP so you can open the same site on your
# phone (must be on the same WiFi). Uses whichever network adapter actually
# carries your internet connection (the default route) - simply excluding
# "virtual-sounding" adapter names isn't reliable, since things like a
# VirtualBox host-only network don't always have an obviously virtual name.
# Falls back gracefully if none is found - testing on this PC still works.
$lanIp = $null
try {
    $defaultRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop | Sort-Object -Property RouteMetric | Select-Object -First 1
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $defaultRoute.InterfaceIndex -ErrorAction Stop | Select-Object -First 1 -ExpandProperty IPAddress
} catch { }

Write-Host ""
Write-Host "  BTU Marketplace API starting on :8001..." -ForegroundColor Green
Write-Host "  API docs: http://127.0.0.1:8001/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "  For the actual site: also run 'npm run dev' in frontend/, then open:" -ForegroundColor Green
Write-Host "  Site:  http://127.0.0.1:5173" -ForegroundColor Cyan
if ($lanIp) {
    Write-Host "  Phone: http://${lanIp}:5173  (same WiFi as this PC)" -ForegroundColor Cyan
} else {
    Write-Host "  Phone: run 'ipconfig' to find this PC's IPv4 address, then open http://<that-ip>:5173 on your phone" -ForegroundColor DarkYellow
}
Write-Host "  Stop the server: press Ctrl+C in this window" -ForegroundColor Yellow
Write-Host ""

# --host 0.0.0.0 = accept connections from other devices on the network (not
# just this PC), which is what makes the phone URL above actually reachable.
# --reload = server restarts automatically whenever you save a code change
& $python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
