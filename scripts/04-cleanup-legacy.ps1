# Pasify · Paso 4 — Limpieza de archivos legacy Students Life
#
# Este script borra del disco los archivos del antiguo "Students Life"
# que ya fueron desconectados del routing en App.tsx (rutas y lazy imports
# eliminados), pero que aún viven como código muerto en src/.
#
# Antes de ejecutar:
#   1. Asegúrate de que `npx tsc --noEmit` pasa sin errores
#   2. Asegúrate de tener commit limpio (`git status`) por si quieres
#      revertir.
#
# Para correr:
#   .\scripts\04-cleanup-legacy.ps1
#
# Si quieres ver qué hará SIN borrar nada:
#   .\scripts\04-cleanup-legacy.ps1 -DryRun

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repoRoot "src"

Write-Host ""
Write-Host "=== Pasify · Cleanup legacy Students Life ===" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "MODO DRY-RUN — nada se borrará, solo se listará." -ForegroundColor Yellow
}
Write-Host ""

# ============ Páginas legacy ============
$legacyPages = @(
    "pages\Social.tsx",
    "pages\Chats.tsx",
    "pages\ChatConversation.tsx",
    "pages\Badges.tsx",
    "pages\UserProfile.tsx"
)

# ============ Carpetas de componentes legacy ============
$legacyDirs = @(
    "components\social",
    "components\chat",
    "components\quiz"
)

# ============ Componentes legacy sueltos ============
$legacyComponents = @(
    "components\shared\UploadSheet.tsx",
    "components\admin\AdminChats.tsx",
    "components\partner\PartnerSocialProfile.tsx"
)

# ============ Hooks legacy ============
$legacyHooks = @(
    "hooks\useQuizLeaderboard.ts",
    "hooks\useQuizMatch.ts",
    "hooks\useQuizMatchmaking.ts",
    "hooks\useQuizMusic.ts",
    "hooks\useChat.ts",
    "hooks\useTypingIndicator.ts",
    "hooks\useOnlinePresence.ts",
    "hooks\useGlobalTyping.ts",
    "hooks\useUnreadMessages.ts",
    "hooks\useUnreadNotifications.ts",
    "hooks\useNotificationSound.ts"
)

$totalDeleted = 0
$totalMissing = 0

function Remove-LegacyItem($relPath, $isDir = $false) {
    $abs = Join-Path $src $relPath
    if (-not (Test-Path $abs)) {
        Write-Host "  · skip (no existe) $relPath" -ForegroundColor DarkGray
        $script:totalMissing++
        return
    }
    if ($DryRun) {
        Write-Host "  · WOULD DELETE $relPath" -ForegroundColor Yellow
    } else {
        if ($isDir) {
            Remove-Item -Path $abs -Recurse -Force -Confirm:$false
        } else {
            Remove-Item -Path $abs -Force -Confirm:$false
        }
        Write-Host "  ✓ DELETED $relPath" -ForegroundColor Green
    }
    $script:totalDeleted++
}

Write-Host "[1/4] Páginas legacy..." -ForegroundColor Cyan
foreach ($p in $legacyPages) { Remove-LegacyItem $p }
Write-Host ""

Write-Host "[2/4] Carpetas de componentes legacy..." -ForegroundColor Cyan
foreach ($d in $legacyDirs) { Remove-LegacyItem $d $true }
Write-Host ""

Write-Host "[3/4] Componentes legacy sueltos..." -ForegroundColor Cyan
foreach ($c in $legacyComponents) { Remove-LegacyItem $c }
Write-Host ""

Write-Host "[4/4] Hooks legacy..." -ForegroundColor Cyan
foreach ($h in $legacyHooks) { Remove-LegacyItem $h }
Write-Host ""

# ============ Resumen ============
Write-Host "=== Resumen ===" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "📋 Habrían sido eliminados: $totalDeleted artefactos" -ForegroundColor Yellow
} else {
    Write-Host "🗑  Eliminados: $totalDeleted artefactos" -ForegroundColor Green
}
Write-Host "↩  Ya no existían: $totalMissing artefactos" -ForegroundColor DarkGray
Write-Host ""

if (-not $DryRun) {
    Write-Host "Siguiente paso recomendado:" -ForegroundColor Cyan
    Write-Host "  npx tsc --noEmit          # verificar que el build sigue ok" -ForegroundColor White
    Write-Host "  git status                # revisar la diff antes de commit" -ForegroundColor White
    Write-Host ""
}
