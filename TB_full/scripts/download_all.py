#!/usr/bin/env python3
import csv, pathlib, time, urllib.request, urllib.error, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
META = ROOT / 'metadata.csv'
UA = 'Mozilla/5.0 TB-Knowledge-Base/1.0 (+educational RAG corpus)'

def download(url, dest, retries=3):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1024:
        return 'exists'
    for attempt in range(1, retries+1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept':'application/pdf,*/*'})
            with urllib.request.urlopen(req, timeout=90) as r, open(dest, 'wb') as f:
                while True:
                    chunk = r.read(1024*1024)
                    if not chunk: break
                    f.write(chunk)
            if dest.stat().st_size < 1024:
                dest.unlink(missing_ok=True)
                raise RuntimeError('archivo demasiado pequeño')
            return 'ok'
        except Exception as e:
            if attempt == retries:
                return f'ERROR: {e}'
            time.sleep(attempt*3)

with open(META, encoding='utf-8', newline='') as f:
    rows=list(csv.DictReader(f))

failed=[]
for i,row in enumerate(rows,1):
    dest=ROOT / row['filename']
    print(f'[{i}/{len(rows)}] {dest.name}')
    status=download(row['source_url'], dest)
    print('   ',status)
    if status.startswith('ERROR'):
        failed.append((row['filename'],row['source_url'],status))

print(f'\nCompletado: {len(rows)-len(failed)}/{len(rows)}')
if failed:
    print('\nNo descargados:')
    for fn,url,err in failed:
        print(f'- {fn}\n  {url}\n  {err}')
    sys.exit(1)
