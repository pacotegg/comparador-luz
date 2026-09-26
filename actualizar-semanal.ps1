# Actualizacion semanal del comparador de luz.
#
# Recoge el trabajo de la Plataforma de ForoCoches y del comparador de la CNMC,
# y publica SOLO la parte publica. Lo lanza una tarea programada, asi que corre
# sin sesion iniciada: todas las rutas son absolutas porque el entorno de logon
# no tiene PATH.
#
# Registrar la tarea:  ver el final de este fichero.

$ErrorActionPreference = 'Stop'

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

Registro '--- empieza la actualizacion semanal ---'
Set-Location -LiteralPath $Raiz

# 1. Descargar, recalcular y verificar -------------------------------------
& $Node 'actualizador\src\index.ts' 2>&1 | ForEach-Object { Registro "  $_" }
if ($LASTEXITCODE -ne 0) { Abortar "el actualizador salio con codigo $LASTEXITCODE" }

# 2. Que solo haya cambiado lo que puede cambiar ----------------------------
# Si aparece cualquier otro fichero, algo no va como esperamos: no se empuja.
$cambios = & $Git status --porcelain
if (-not $cambios) { Registro 'sin cambios que publicar'; Registro '--- fin ---'; exit 0 }

$permitidos = @('datos/tarifas-cnmc.json', 'app/public/tarifas-cnmc.json')
foreach ($linea in $cambios) {
    $ruta = ($linea.Substring(3)).Trim('"')
    if ($permitidos -notcontains $ruta) {
        Registro "cambio inesperado: $ruta"
        Abortar 'hay cambios fuera de los ficheros de datos publicos'
    }
}
Registro "cambios a publicar: $($cambios.Count) fichero(s)"

# 3. Barrido de secretos ANTES de empujar -----------------------------------
# El repo es publico. Esto mira lo que se va a empujar, no la carpeta entera.
& $Git add -A
$patron = 'duckdns|no-ip\.|dyndns|([0-9]{1,3}\.){3}[0-9]{1,3}|([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|@gmail|api[_-]?key|password|ES[0-9]{16}'
$sospechoso = & $Git diff --cached -U0 |
    Select-String -Pattern '^\+' |
    Select-String -Pattern $patron |
    Select-String -Pattern '192\.168\.|127\.0\.0\.1|0\.0\.0\.0|localhost|js-tokens' -NotMatch

if ($sospechoso) {
    foreach ($s in $sospechoso) { Registro "  sospechoso: $($s.Line.Substring(0, [Math]::Min(120, $s.Line.Length)))" }
    & $Git reset | Out-Null
    Abortar 'el barrido ha encontrado algo que no debe publicarse'
}
Registro 'barrido limpio'

# Y que el dataset curado de la Plataforma no se cuele nunca.
$curado = & $Git ls-files --cached | Select-String -Pattern 'tarifas-excel\.json'
if ($curado) { & $Git reset | Out-Null; Abortar 'tarifas-excel.json ha entrado en el indice' }

# 4. Publicar ---------------------------------------------------------------
$fecha = Get-Date -Format 'yyyy-MM-dd'
& $Git -c user.name='pacotegg' commit -q -m "Tarifas de la CNMC al $fecha

Actualizacion automatica semanal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
if ($LASTEXITCODE -ne 0) { Abortar "el commit fallo con codigo $LASTEXITCODE" }

& $Git push origin main 2>&1 | ForEach-Object { Registro "  $_" }
if ($LASTEXITCODE -ne 0) { Abortar "el push fallo con codigo $LASTEXITCODE" }

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
