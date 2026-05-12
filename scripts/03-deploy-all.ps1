# Pasify · Paso 3 — Deploy de todas las edge functions
# Itera sobre supabase/functions/* (excepto _shared) y deploya cada función.

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $repoRoot "supabase\functions"

Write-Host ""
Write-Host "=== Pasify · Deploy Edge Functions ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $functionsDir)) {
    Write-Host "❌ No existe $functionsDir" -ForegroundColor Red
    exit 1
}

# Listar carpetas de funciones (excluyendo _shared y _tests)
$functions = Get-ChildItem -Path $functionsDir -Directory | Where-Object {
    $_.Name -notlike "_*"
}

if ($functions.Count -eq 0) {
    Write-Host "❌ No se encontraron funciones para deploy" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Funciones a deployar: $($functions.Count)" -ForegroundColor Yellow
$functions | ForEach-Object { Write-Host "  • $($_.Name)" -ForegroundColor DarkGray }
Write-Host ""

$ok = 0
$failed = @()

foreach ($fn in $functions) {
    $name = $fn.Name
    Write-Host "🚀 Deploying $name..." -ForegroundColor Yellow
    & supabase functions deploy $name
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✓ $name OK" -ForegroundColor Green
        $ok++
    } else {
        Write-Host "   ✗ $name FAILED" -ForegroundColor Red
        $failed += $name
    }
    Write-Host ""
}

Write-Host ""
Write-Host "=== Resultado ===" -ForegroundColor Cyan
Write-Host "✅ Exitosas: $ok" -ForegroundColor Green
if ($failed.Count -gt 0) {
    Write-Host "❌ Fallidas: $($failed.Count)" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "   • $_" -ForegroundColor Red }
    exit 1
}

Write-Host ""
Write-Host "🎉 Todas las edge functions deployadas." -ForegroundColor Green
Write-Host "Verifica con: supabase functions list" -ForegroundColor DarkGray
