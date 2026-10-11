# Lumen one-shot Windows setup. Installs Node, Git and Java 21 (via winget), fetches and builds Lumen,
# downloads Ghidra 12.1.4, and points Lumen at Ghidra + JAVA_HOME. Run in PowerShell:
#   irm https://raw.githubusercontent.com/stoicops/lumen/claude/new-session-d87n5v/scripts/setup-windows.ps1 | iex
$ErrorActionPreference = 'Stop'
$branch  = 'claude/new-session-d87n5v'
$repo    = 'https://github.com/stoicops/lumen.git'
$dest    = Join-Path $HOME 'Desktop\lumen'
$ghRoot  = 'C:\ghidra_12.1.4_PUBLIC'
function Say($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path','Machine')
  $u = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = ($m, $u | Where-Object { $_ }) -join ';'
}
function Need-Winget {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is not available. Install 'App Installer' from the Microsoft Store, then re-run this script."
  }
}
function Winget-Install($id) {
  Say "Installing $id"
  winget install --id $id -e --source winget --accept-source-agreements --accept-package-agreements --silent 2>$null
  Refresh-Path
}

Need-Winget
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Winget-Install 'OpenJS.NodeJS.LTS' }
if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { Winget-Install 'Git.Git' }
Winget-Install 'EclipseAdoptium.Temurin.21.JDK'

# Resolve the installed JDK 21 and set JAVA_HOME (user scope) so Ghidra can find Java.
Say "Locating Java 21"
$jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
       Where-Object { $_.Name -like 'jdk-21*' } | Sort-Object Name -Descending | Select-Object -First 1
if ($jdk) { [Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk.FullName, 'User'); $env:JAVA_HOME = $jdk.FullName; Write-Host "JAVA_HOME = $($jdk.FullName)" }
else { Write-Warning "Could not find a jdk-21 folder; set the Java home in Lumen Settings later." }

# Get the Lumen source and build the app.
Say "Fetching Lumen source"
if (Test-Path (Join-Path $dest '.git')) { git -C $dest fetch origin; git -C $dest checkout $branch; git -C $dest pull --ff-only origin $branch }
else { git clone $repo $dest; git -C $dest checkout $branch }
Set-Location $dest
Say "Installing dependencies (a few minutes)"; npm install
Say "Building the Windows app (a few minutes)"; npm run dist:win

# Download and extract Ghidra 12.1.4 (asset name carries a build date, so resolve it from the GitHub API).
if (-not (Test-Path (Join-Path $ghRoot 'Ghidra\application.properties'))) {
  Say "Finding the Ghidra 12.1.4 download"
  $asset = (Invoke-RestMethod 'https://api.github.com/repos/NationalSecurityAgency/ghidra/releases' -Headers @{ 'User-Agent' = 'lumen-setup' }) |
    ForEach-Object { $_.assets } | Where-Object { $_.name -match 'ghidra_12\.1\.4_PUBLIC.*\.zip' } | Select-Object -First 1
  if (-not $asset) { throw "Could not find the Ghidra 12.1.4 release asset. Download it manually and set the folder in Lumen Settings." }
  $zip = Join-Path $env:TEMP $asset.name
  Say "Downloading $($asset.name) (~400 MB)"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip
  Say "Extracting to C:\"
  Expand-Archive -Path $zip -DestinationPath 'C:\' -Force
  Remove-Item $zip -ErrorAction SilentlyContinue
} else { Say "Ghidra already present at $ghRoot" }

# Point Lumen at Ghidra (its settings live in %APPDATA%\Lumen\settings.json).
Say "Configuring Lumen"
$cfgDir = Join-Path $env:APPDATA 'Lumen'
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$settings = @{ ghidraDir = $ghRoot; ghidraMaxMem = '4G' }
if ($jdk) { $settings.javaHome = $jdk.FullName }
$settings | ConvertTo-Json | Set-Content -Path (Join-Path $cfgDir 'settings.json') -Encoding UTF8

$installer = Get-ChildItem (Join-Path $dest 'release') -Filter 'Lumen Setup*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
Say "Done."
if ($installer) {
  Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green
  Write-Host "JAVA_HOME and the Ghidra folder are set. Run the installer, then open Lumen and analyse a .exe." -ForegroundColor Green
  Start-Process explorer.exe -ArgumentList "/select,`"$($installer.FullName)`""
} else {
  Write-Warning "Build finished but no installer was found under $dest\release. Check the npm output above."
}
