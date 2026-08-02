# TB Knowledge Base (2020-2026)

Repositorio base para construir un chatbot RAG sobre tuberculosis.

## Descargar los PDF

### macOS / Linux
```bash
python3 scripts/download_all.py
```

### Windows
```powershell
py scripts\download_all.py
```

El script descarga los documentos desde OMS, ECDC, CDC y Ministerio de Sanidad y los guarda en sus carpetas. Algunos servidores, especialmente WHO IRIS, pueden devolver `403`; en ese caso abre la URL indicada en `metadata.csv` con el navegador y guarda el PDF con el nombre especificado.

## Subir a GitHub

1. Descomprime el ZIP.
2. Ejecuta el descargador.
3. Crea en GitHub un repositorio llamado `TB-Knowledge-Base`.
4. Sube el contenido de esta carpeta a la raíz del repositorio.

## Límite de GitHub

GitHub bloquea archivos individuales superiores a 100 MB. Para colecciones grandes, usa Git LFS o deja los PDF fuera del repositorio y conserva solo `metadata.csv` y el descargador.

## Uso en un chatbot

Indexa las carpetas `01_WHO`, `02_CDC`, `03_ECDC` y `04_Spain`. Divide cada PDF en fragmentos de 700-1200 tokens con solapamiento de 100-200 tokens. Guarda como metadatos el título, año, organismo, URL y página.

## Control de versiones

Los informes globales antiguos no deben usarse para responder cifras actuales si existe una edición posterior. Conserva el año en los metadatos y prioriza siempre el documento más reciente.
