param(
  [ValidateSet('diario','preparar','imprimir')][string]$Modo='diario',
  [string]$Fecha='',
  [switch]$Reimprimir
)
$ErrorActionPreference='Stop'
try {
  $config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
  if ($Modo -eq 'diario' -and (Get-TimeZone).Id -ne 'Central Standard Time (Mexico)') {
    throw 'Windows debe usar la zona Ciudad de Mexico (Central Standard Time (Mexico)).'
  }
  if ($Modo -eq 'imprimir') {
    if (-not $Fecha) { $Fecha = Read-Host 'Fecha del servicio (AAAA-MM-DD)' }
    if ((Read-Host 'Se enviaran documentos a ambas impresoras. Escriba IMPRIMIR para confirmar') -cne 'IMPRIMIR') { exit 0 }
    if ($Reimprimir -and (Read-Host 'Revise antes papel y cola de Windows. Escriba REPETIR para autorizar duplicados') -cne 'REPETIR') { exit 0 }
  }
  if ($Modo -eq 'preparar' -and -not $Fecha) { $Fecha = Read-Host 'Fecha con pedidos para la prueba (AAAA-MM-DD)' }
  foreach ($nombre in @($config.comanda,$config.etiquetas)) {
    if (-not (Get-Printer | Where-Object Name -eq $nombre)) { throw "No esta instalada la impresora: $nombre" }
  }
  $secreto = Get-Content (Join-Path $PSScriptRoot 'clave.dpapi') -Raw | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secreto)
  try { $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $paquete = @{ config=$config; clave=$clave; modo=$Modo; fecha=$Fecha; reimprimir=[bool]$Reimprimir } | ConvertTo-Json -Compress -Depth 6
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $config.node
  $start.Arguments = '"' + (Join-Path $PSScriptRoot 'imprimir.mjs') + '"'
  $start.WorkingDirectory = $PSScriptRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.StandardInputEncoding = New-Object System.Text.UTF8Encoding($false)
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $start
  [void]$proc.Start()
  $proc.StandardInput.Write($paquete)
  $proc.StandardInput.Close()
  $clave=$null; $paquete=$null
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { throw 'No se completo. Revise impresion.log y las colas de Windows antes de repetir.' }
  if ($Modo -eq 'preparar') { Start-Process explorer.exe -ArgumentList ('"'+$config.carpeta+'"') }
  exit 0
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($Modo -ne 'diario') { Read-Host 'Presione Enter para cerrar' | Out-Null }
  exit 1
}
