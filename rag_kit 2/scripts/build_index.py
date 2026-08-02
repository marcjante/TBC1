#!/usr/bin/env python3
"""
Extrae texto de los PDF de TB_full/, los trocea en fragmentos con metadata,
y genera chunks.json listo para usar como base del RAG en la Cloud Function.

Requisitos:
    pip install pypdf --break-system-packages   (o en un venv normal)

Uso (ejecutar desde la carpeta que contiene TB_full/):
    python3 build_index.py

Salida:
    chunks.json  -> cópialo a functions/data/chunks.json en el repo TBC1
"""
import csv
import json
import pathlib
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("Falta pypdf. Instala con: pip install pypdf --break-system-packages")

ROOT = pathlib.Path(__file__).resolve().parents[1] if (pathlib.Path(__file__).resolve().parents[1] / "TB_full").exists() else pathlib.Path.cwd()
TB_DIR = ROOT / "TB_full"
META = TB_DIR / "metadata.csv"
OUT = ROOT / "chunks.json"

# Tamaño de fragmento en palabras (aprox. 800-1000 tokens) y solapamiento
CHUNK_WORDS = 220
OVERLAP_WORDS = 40


def clean_text(t: str) -> str:
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def chunk_text(text: str, chunk_words=CHUNK_WORDS, overlap=OVERLAP_WORDS):
    words = text.split()
    if not words:
        return []
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_words, len(words))
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        if end == len(words):
            break
        start = end - overlap
    return chunks


def main():
    if not META.exists():
        sys.exit(f"No encuentro {META}. Ejecuta este script desde la carpeta que contiene TB_full/.")

    with open(META, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    all_chunks = []
    chunk_id = 0
    missing = []

    for row in rows:
        pdf_path = ROOT / row["filename"]
        if not pdf_path.exists():
            missing.append(row["filename"])
            continue

        try:
            reader = PdfReader(str(pdf_path))
        except Exception as e:
            print(f"  ERROR leyendo {pdf_path.name}: {e}")
            continue

        print(f"Procesando {pdf_path.name} ({len(reader.pages)} páginas)...")

        for page_num, page in enumerate(reader.pages, start=1):
            try:
                raw = page.extract_text() or ""
            except Exception:
                raw = ""
            text = clean_text(raw)
            if len(text) < 40:
                continue

            for piece in chunk_text(text):
                all_chunks.append({
                    "id": chunk_id,
                    "text": piece,
                    "category": row["category"],
                    "year": row["year"],
                    "title": row["title"],
                    "filename": row["filename"],
                    "source_url": row["source_url"],
                    "page": page_num,
                })
                chunk_id += 1

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False)

    print(f"\nGenerados {len(all_chunks)} fragmentos en {OUT}")
    if missing:
        print(f"\nAviso: {len(missing)} PDF de metadata.csv no se encontraron en disco (¿aún no descargados?):")
        for m in missing:
            print(f"  - {m}")


if __name__ == "__main__":
    main()
