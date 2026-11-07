"""Construye el paquete público sin dependencias instaladas ni credenciales."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
src = root / 'tools' / 'impresion-windows'
nombres = [
    'Instalar.cmd', 'Instalar.ps1', 'Ejecutar.ps1', 'Preparar-prueba.cmd',
    'Imprimir-ahora.cmd', 'Reimprimir.cmd', 'imprimir.mjs', 'logica.mjs',
    'package.json', 'package-lock.json', 'LEEME.txt',
]
salida = root / 'public' / 'impresion-windows.zip'
with zipfile.ZipFile(salida, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for nombre in nombres:
        datos = (src / nombre).read_bytes()
        if nombre.endswith(('.ps1', '.cmd', '.txt')):
            datos = datos.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        info = zipfile.ZipInfo('GoLunch-Impresion/' + nombre, (2026, 11, 6, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, datos)
with zipfile.ZipFile(salida) as z:
    assert z.testzip() is None
    assert len(z.namelist()) == len(nombres)
print(f'{salida} ({salida.stat().st_size} bytes; {len(nombres)} archivos, sin claves)')
