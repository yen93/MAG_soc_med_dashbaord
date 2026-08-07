$ErrorActionPreference = "Continue"
Set-Location "C:\Users\Cloverly\claude_code\soc_med_dashbaord"

$logDir = "scripts\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logDir "$stamp.log"

Get-Content -Raw "scripts\daily-refresh-prompt.txt" | & "C:\Users\Cloverly\.local\bin\claude.exe" -p --permission-mode bypassPermissions --allowedTools "Bash Read Write Edit Glob Grep Artifact" *> $logFile

# Keep only the 30 most recent logs so this doesn't grow forever.
Get-ChildItem $logDir -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
