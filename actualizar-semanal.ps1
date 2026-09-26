# Actualizacion semanal del comparador de luz.
#
# Recoge el trabajo de la Plataforma de ForoCoches y del comparador de la CNMC,
# y publica SOLO la parte publica. Lo lanza una tarea programada, asi que corre
# sin sesion iniciada: todas las rutas son absolutas porque el entorno de logon
# no tiene PATH.
#
# Registrar la tarea: ver el final de este fichero.

$ErrorActionPreference = 'Stop'

# node escribe en UTF-8; sin esto el log guarda "Ôé¼" donde deberia poner "€".
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Node = 'C:\Program Files\nodejs\node.exe'
$Git  = 'C:\Program Files\Git\cmd\git.exe'
$Raiz = 'C:\luzapp'
$Log  = Join-Path $Raiz 'actualizar-semanal.log'

function Registro([string]$Texto) {
    $linea = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Texto
    Write-Host $linea
    Add-Content -LiteralPath $Log -Value $linea -Encoding UTF8
}

function Abortar([string]$Motivo) {
    Registro "ABORTADO: $Motivo"
    exit 1
}

# git y node escriben por stderr aunque todo vaya bien (el progreso del push, por
# ejemplo). Con ErrorActionPreference en Stop, PowerShell 5.1 lo toma por un
# fallo y revienta el script despues de haber hecho el trabajo. Aqui se baja la
# guardia solo durante la llamada y se mira el codigo de salida, que es el que
# de verdad dice si fue bien.
function Nativo {
    param([string]$Exe, [string[]]$Argumentos, [string]$Que, [switch]$Silencioso)
    $previo = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $salida = & $Exe @Argumentos 2>&1
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previo
    }
    if (-not $Silencioso) { $salida | ForEach-Object { Registro "  $_" } }
    if ($codigo -ne 0) { Abortar "$Que salio con codigo $codigo" }
    return $salida
}

Registro '--- empieza la actualizacion semanal ---'
Set-Location -LiteralPath $Raiz

# 1. Descargar, recalcular y verificar -------------------------------------
Nativo $Node @('actualizador\src\index.ts') 'el actualizador' | Out-Null

# 2. Que solo haya cambiado lo que puede cambiar ----------------------------
# Si aparece cualquier otro fichero, algo no va como esperamos: no se empuja.
$cambios = @(Nativo $Git @('status', '--porcelain') 'git status' -Silencioso)
if ($cambios.Count -eq 0) {
    Registro 'sin cambios que publicar'
    Registro '--- fin ---'
    exit 0
}

$permitidos = @('datos/tarifas-cnmc.json', 'app/public/tarifas-cnmc.json')
foreach ($linea in $cambios) {
    $ruta = ([string]$linea).Substring(3).Trim('"')
    if ($permitidos -notcontains $ruta) {
        Registro "cambio inesperado: $ruta"
        Abortar 'hay cambios fuera de los ficheros de datos publicos'
    }
}
Registro "cambios a publicar: $($cambios.Count) fichero(s)"

# 3. Barrido de secretos ANTES de empujar -----------------------------------
# El repo es publico. Esto mira lo que se va a empujar, no la carpeta entera.
Nativo $Git @('add', '-A') 'git add' -Silencioso | Out-Null

$patron = 'duckdns|no-ip\.|dyndns|([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|@gmail|api[_-]?key|password|ES[0-9]{16}'
$anyadidas = @(Nativo $Git @('diff', '--cached', '-U0') 'git diff' -Silencioso) |
    Where-Object { ([string]$_).StartsWith('+') }
$sospechoso = $anyadidas |
    Select-String -Pattern $patron |
    Select-String -Pattern '192\.168\.|127\.0\.0\.1|0\.0\.0\.0|localhost|js-tokens' -NotMatch

if ($sospechoso) {
    foreach ($s in $sospechoso) {
        $t = [string]$s
        Registro ("  sospechoso: " + $t.Substring(0, [Math]::Min(120, $t.Length)))
    }
    Nativo $Git @('reset') 'git reset' -Silencioso | Out-Null
    Abortar 'el barrido ha encontrado algo que no debe publicarse'
}
Registro 'barrido limpio'

# Y que el dataset curado de la Plataforma no se cuele nunca.
$curado = @(Nativo $Git @('ls-files', '--cached') 'git ls-files' -Silencioso) |
    Select-String -Pattern 'tarifas-excel\.json'
if ($curado) {
    Nativo $Git @('reset') 'git reset' -Silencioso | Out-Null
    Abortar 'tarifas-excel.json ha entrado en el indice'
}

# 4. Publicar ---------------------------------------------------------------
$fecha = Get-Date -Format 'yyyy-MM-dd'
$mensaje = @"
Tarifas de la CNMC al $fecha

Actualizacion automatica semanal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
"@
Nativo $Git @('-c', 'user.name=pacotegg', 'commit', '-q', '-m', $mensaje) 'el commit' | Out-Null
Nativo $Git @('push', 'origin', 'main') 'el push' | Out-Null

Registro 'publicado. GitHub Pages se reconstruye solo.'
Registro '--- fin ---'

# ---------------------------------------------------------------------------
# Para registrar la tarea (PowerShell como administrador):
#
#   $a = New-ScheduledTaskAction -Execute 'powershell.exe' `
#          -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\luzapp\actualizar-semanal.ps1'
#   $t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 09:00
#   $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
#   Register-ScheduledTask -TaskName 'ComparadorLuz-Semanal' -Action $a -Trigger $t -Settings $s
# ---------------------------------------------------------------------------
