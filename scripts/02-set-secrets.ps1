# Pasify · Paso 2 — Configurar Supabase secrets para edge functions
#
# 1. Copia secrets.template.env → secrets.env (NO commitear ese archivo)
# 2. Rellena las keys reales (Stripe, Resend, FCM, etc.)
# 3. Ejecuta: .\scripts\02-set-secrets.ps1
#
# El script lee secrets.env línea por línea y los manda a Supabase.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$secretsFile = Join-Path $repoRoot "secrets.env"
$templateFile = Join-Path $repoRoot "secrets.template.env"

Write-Host ""
Write-Host "=== Pasify · Set Supabase secrets ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $secretsFile)) {
    Write-Host "❌ No existe secrets.env" -ForegroundColor Red
    if (Test-Path $templateFile) {
        Write-Host "👉  Copia el template y rellena las claves:" -ForegroundColor Yellow
        Write-Host "    Copy-Item secrets.template.env secrets.env" -ForegroundColor Yellow
        Write-Host "    notepad secrets.env"
    } else {
        Write-Host "👉  Tampoco existe secrets.template.env. Crea manualmente secrets.env con KEY=value (uno por línea)."
    }
    exit 1
}

# Asegurar .gitignore
$gitignore = Join-Path $repoRoot ".gitignore"
if (Test-Path $gitignore) {
    $content = Get-Content $gitignore -Raw
    if ($content -notmatch "secrets\.env") {
        Add-Content $gitignore "`nsecrets.env`n"
        Write-Host "✓ Añadido secrets.env a .gitignore"
    }
}

# Leer secrets.env y construir argumentos
$lines = Get-Content $secretsFile | Where-Object {
    $_ -and $_ -notmatch "^\s*#" -and $_ -match "="
}

if ($lines.Count -eq 0) {
    Write-Host "❌ secrets.env vacío o solo comentarios" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Aplicando $($lines.Count) secrets a Supabase..." -ForegroundColor Yellow
Write-Host ""

# Pasamos los pares como argumentos
$args = @()
foreach ($line in $lines) {
    $line = $line.Trim()
    if ($line) {
        $args += $line
        $key = ($line -split "=", 2)[0]
        Write-Host "  → $key" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Ejecutando: supabase secrets set ..." -ForegroundColor Yellow
& supabase secrets set @args

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Secrets configurados. Verifica con: supabase secrets list" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Falló al setear secrets. Verifica permisos." -ForegroundColor Red
    exit 1
}
