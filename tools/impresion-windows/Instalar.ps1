$ErrorActionPreference='Stop'
try {
  if ((Get-TimeZone).Id -ne 'Central Standard Time (Mexico)') {
    throw 'En Configuracion > Hora e idioma, seleccione Ciudad de Mexico. Luego vuelva a ejecutar.'
  }
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $node) { throw 'Instale Node.js LTS desde https://nodejs.org y vuelva a abrir Instalar.cmd.' }
  $version = & $node --version
  $major = $version.TrimStart('v').Split('.')[0]
  if ([int]$major -lt 22) { throw 'Se requiere Node.js 22 o posterior. Instale la version LTS.' }
  $sumatra = @(
    "$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe",
    "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe",
    "${env:ProgramFiles(x86)}\SumatraPDF\SumatraPDF.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $sumatra) { throw 'Instale SumatraPDF desde https://www.sumatrapdfreader.org/download-free-pdf-viewer y ejecute otra vez.' }
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $edge) { throw 'Se requiere Microsoft Edge instalado.' }
  $impresoras = @(Get-Printer | Sort-Object Name)
  Write-Host 'Impresoras instaladas:' -ForegroundColor Cyan
  for ($i=0; $i -lt $impresoras.Count; $i++) { Write-Host ("{0}. {1}" -f ($i+1),$impresoras[$i].Name) }
  function Elegir-Impresora($titulo) {
    $n=0
    $respuesta=Read-Host $titulo
    if (-not [int]::TryParse($respuesta,[ref]$n) -or $n -lt 1 -or $n -gt $impresoras.Count) { throw 'Seleccion de impresora invalida.' }
    return $impresoras[$n-1].Name
  }
  $etiquetas=Elegir-Impresora 'Numero de la Brother QL-800 (etiquetas 90 x 62 mm horizontal)'
  $comanda=Elegir-Impresora 'Numero de la VOLTECK POS58 (comanda de 58 mm)'
  if ($etiquetas -eq $comanda) { throw 'Seleccione las dos impresoras diferentes.' }
  $destino=Join-Path $env:LOCALAPPDATA 'GoLunchImpresion'
  if (Get-ScheduledTask -TaskName 'GoLunch-Impresion-2130' -ErrorAction SilentlyContinue) {
    throw 'La tarea ya existe. Para reinstalar, desactivela y eliminela primero en el Programador de tareas.'
  }
  New-Item -ItemType Directory -Path $destino -Force | Out-Null
  Get-ChildItem $PSScriptRoot -File | Copy-Item -Destination $destino -Force
  Push-Location $destino
  try {
    & npm.cmd ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias. Revise internet.' }
  } finally { Pop-Location }
  # DPAPI vincula la clave al usuario actual de esta PC. No se escribe en texto plano.
  $clave=Read-Host 'Contrasena del usuario gerente de Go Lunch' -AsSecureString
  if ($clave.Length -eq 0) { throw 'La contrasena no puede estar vacia.' }
  $clave | ConvertFrom-SecureString | Set-Content (Join-Path $destino 'clave.dpapi') -Encoding ASCII
  $config=@{
    base='https://glovis.cicsacomedores.com.mx'; etiquetas=$etiquetas; comanda=$comanda
    node=$node; sumatra=$sumatra; edge=$edge; carpeta=(Join-Path $destino 'documentos')
  }
  $config | ConvertTo-Json | Set-Content (Join-Path $destino 'config.json') -Encoding UTF8
  # PS 5 escribe BOM; Node lo elimina al leer stdin en el lanzador, no lee config directamente.
  Write-Host 'Preparando PDF de prueba. No se imprimira nada.' -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $destino 'Ejecutar.ps1') -Modo preparar
  if ($LASTEXITCODE -ne 0) { throw 'La prueba no termino bien. La tarea NO se ha activado.' }
  Write-Host 'Abra los PDF generados. Imprima una prueba de cada uno y compruebe tamano, texto y QR.'
  Write-Host 'Brother: rollo 62 mm, largo 90 mm, horizontal; POS58: rollo 58 mm; ambas al 100 %, sin ajustar a pagina.'
  if ((Read-Host 'Cuando las DOS pruebas fisicas salgan bien, escriba ACTIVAR. Cualquier otro texto sale sin programar') -cne 'ACTIVAR') {
    Write-Host 'No se activo ninguna tarea. Puede repetir la instalacion cuando termine de calibrar.'
    exit 0
  }
  $usuario=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $argumentos='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $destino 'Ejecutar.ps1')+'" -Modo diario'
  $accion=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentos -WorkingDirectory $destino
  $trigger=New-ScheduledTaskTrigger -Daily -At '21:30'
  $principal=New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
  $ajustes=New-ScheduledTaskSettingsSet -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
  Register-ScheduledTask -TaskName 'GoLunch-Impresion-2130' -Action $accion -Trigger $trigger -Principal $principal -Settings $ajustes -Description 'Comanda POS58 y etiquetas Brother 90x62 horizontal a las 21:30 para el dia siguiente.' | Out-Null
  Write-Host 'ACTIVADO: todos los dias a las 9:30 PM. Mantenga la sesion iniciada y la PC conectada.' -ForegroundColor Green
  Write-Host ('Documentos y registro: '+$config.carpeta)
  Read-Host 'Enter para cerrar' | Out-Null
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host 'Enter para cerrar' | Out-Null
  exit 1
}
