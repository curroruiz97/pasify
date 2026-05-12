# Pasify · Paso 1 — Autenticar Supabase CLI y linkear el proyecto
# Ejecutar desde la raiz del repo en PowerShell:
#     .\scripts\01-login-and-link.ps1
#
# Si PowerShell bloquea scripts: ejecuta primero como admin:
#     Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

$ErrorActionPreference = "Stop"
$PROJECT_REF = "ixkyfwzkknehvsqpopof"

Write-Host ""
Write-Host "=== Pasify Supabase CLI bootstrap ===" -ForegroundColor Cyan
Write-Host ""

# 1) Login interactivo (abre browser)
Write-Host "[1/3] Autenticando con Supabase (se abrirá el navegador)..." -ForegroundColor Yellow
supabase login

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Login falló. Asegúrate de tener acceso al dashboard." -ForegroundColor Red
    exit 1
}

# 2) Listar proyectos accesibles para confirmar permisos
Write-Host ""
Write-Host "[2/3] Listando proyectos accesibles..." -ForegroundColor Yellow
supabase projects list

Write-Host ""
Write-Host "👀  Verifica que ves '$PROJECT_REF' en la lista." -ForegroundColor Cyan
Write-Host "    Si NO aparece, tu cuenta no es miembro de la org de Pasify." -ForegroundColor Cyan
Write-Host "    Pide acceso al Owner o usa la cuenta correcta." -ForegroundColor Cyan
Read-Host "Pulsa ENTER para continuar con el link"

# 3) Link al proyecto
Write-Host ""
Write-Host "[3/3] Linkeando proyecto $PROJECT_REF..." -ForegroundColor Yellow
supabase link --project-ref $PROJECT_REF

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Listo. Ahora puedes ejecutar:" -ForegroundColor Green
    Write-Host "   .\scripts\02-set-secrets.ps1    # configurar secrets"
    Write-Host "   .\scripts\03-deploy-all.ps1     # deploy edge functions"
} else {
    Write-Host ""
    Write-Host "❌ Link falló. Si dice 'privileges', tu cuenta no es admin del proyecto." -ForegroundColor Red
}
