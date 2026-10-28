import os
import sys
import re
import csv
import json
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

def load_env(env_path='.env'):
    env = {}
    if not os.path.exists(env_path):
        raise FileNotFoundError(f"Archivo de configuración no encontrado: {env_path}")
    with open(env_path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip("'\"")
    return env

def parse_date(val):
    if not val:
        return None
    val = val.strip()
    if not val:
        return None
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', val)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year < 100:
            year += 2000
        try:
            return f"{year:04d}-{month:02d}-{day:02d}"
        except:
            return None
    if re.match(r'^\d{4}-\d{2}-\d{2}$', val):
        return val
    return None

def parse_num(val):
    if not val:
        return None
    val = val.strip().replace(' ', '')
    if not val or val in ('-', '--', 'N/A', '#N/A', '.', '-.'):
        return None
    is_neg = False
    if val.startswith('(') and val.endswith(')'):
        is_neg = True
        val = val[1:-1]
    if val.endswith('-'):
        is_neg = True
        val = val[:-1]
    val = val.replace('.', '').replace(',', '.')
    if not val or val == '-':
        return None
    try:
        n = float(val)
        return -n if is_neg else n
    except:
        return None

def post_batch(url, headers, batch, batch_idx, max_retries=4):
    payload = json.dumps(batch).encode('utf-8')
    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers, data=payload, method='POST')
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    return batch_idx, len(batch), None
                else:
                    return batch_idx, len(batch), f"Unexpected status: {resp.status}"
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='replace')
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries:
                time.sleep(attempt * 2)
                continue
            return batch_idx, 0, f"HTTPError {e.code}: {err_body[:200]}"
        except Exception as e:
            if attempt < max_retries:
                time.sleep(attempt * 2)
                continue
            return batch_idx, 0, str(e)

def get_row_count(url, headers):
    req = urllib.request.Request(f"{url}?limit=0", headers={**headers, 'Prefer': 'count=exact'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        cr = resp.headers.get('Content-Range', '')
        if '/' in cr:
            return int(cr.split('/')[-1])
    return None

def main():
    print("=== Cargador de Movimientos a Supabase (fc_mov) ===")
    
    # 1. Cargar credenciales desde .env
    env = load_env('.env')
    base_url = env.get('URL', '').rstrip('/')
    api_key = env.get('APIKEY', '')
    
    if not base_url or not api_key:
        print("ERROR: URL o APIKEY no encontrados en .env")
        sys.exit(1)
        
    endpoint = f"{base_url}/rest/v1/fc_mov"
    headers = {
        'apikey': api_key,
        'Authorization': f"Bearer {api_key}",
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    
    print(f"Conexión a Supabase:")
    print(f" - URL base: {base_url}")
    print(f" - Endpoint: {endpoint}")
    
    # 2. Verificar estado inicial
    try:
        initial_count = get_row_count(endpoint, headers)
        print(f" - Registros actuales en fc_mov: {initial_count}")
    except Exception as e:
        print(f"ERROR conectando a Supabase: {e}")
        sys.exit(1)

    # 3. Preparar archivo fuente
    source_file = 'movimientos_clean.csv'
    if not os.path.exists(source_file):
        print(f"Archivo limpio {source_file} no encontrado. Ejecute clean_csv.py primero.")
        sys.exit(1)
        
    print(f"\nLeyendo datos desde {source_file}...")
    
    # 4. Leer y transformar datos en batches
    BATCH_SIZE = 1000
    batches = []
    current_batch = []
    total_parsed = 0
    
    with open(source_file, 'r', encoding='cp850', errors='replace') as f:
        reader = csv.reader(f, delimiter=';')
        next(reader) # Cabecera
        for row in reader:
            if not any(c.strip() for c in row):
                continue
            while len(row) < 21:
                row.append('')
                
            record = {
                'es': row[1].strip() or None,
                'mes': row[2].strip() or None,
                'año': row[3].strip() or None,
                'clasificacion': row[4].strip() or None,
                'fecha': parse_date(row[5]),
                'banco': row[6].strip() or None,
                'documento': row[7].strip() or None,
                'tipo': row[8].strip() or None,
                'referencia': row[9].strip() or None,
                'tasa': parse_num(row[11]),
                'bcv_sap': parse_num(row[12]),
                'monto': parse_num(row[13]),
                'division': row[14].strip() or None,
                'beneficiario': row[15].strip() or None,
                'concepto': row[16].strip() or None,
                'texto': row[17].strip() or None,
                'concepto1': row[18].strip() or None,
                'clas': row[19].strip() or None,
                'medio_ejecucion': row[20].strip() or None
            }
            current_batch.append(record)
            total_parsed += 1
            
            if len(current_batch) >= BATCH_SIZE:
                batches.append(current_batch)
                current_batch = []
                
        if current_batch:
            batches.append(current_batch)

    total_batches = len(batches)
    print(f"Total de registros a cargar: {total_parsed:,} distribuidos en {total_batches:,} lotes de {BATCH_SIZE}.")
    
    # 5. Carga concurrente a Supabase
    print("\nIniciando carga concurrente...")
    start_time = time.time()
    inserted_records = 0
    errors = []
    
    MAX_WORKERS = 5
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(post_batch, endpoint, headers, batch, idx): idx
            for idx, batch in enumerate(batches, start=1)
        }
        
        completed = 0
        for future in as_completed(futures):
            batch_idx, count, err = future.result()
            completed += 1
            if err:
                errors.append((batch_idx, err))
                print(f"[Error Lote {batch_idx}]: {err}")
            else:
                inserted_records += count
                
            if completed % 20 == 0 or completed == total_batches:
                elapsed = time.time() - start_time
                rate = inserted_records / elapsed if elapsed > 0 else 0
                pct = (inserted_records / total_parsed) * 100
                print(f"[Progreso {completed}/{total_batches}] {inserted_records:,} / {total_parsed:,} ({pct:.1f}%) | {rate:,.0f} reg/seg | Tiempo: {elapsed:.1f}s")

    total_time = time.time() - start_time
    print(f"\nCarga completada en {total_time:.2f} segundos.")
    print(f"Registros insertados: {inserted_records:,}")
    if errors:
        print(f"Lotes con error: {len(errors)}")
    else:
        print("Todos los lotes se insertaron exitosamente sin errores.")
        
    # 6. Verificación final de conteo en Supabase
    try:
        final_count = get_row_count(endpoint, headers)
        print(f"\nVerificación en Supabase:")
        print(f" - Conteo final reportado por fc_mov: {final_count:,}")
    except Exception as e:
        print(f"No se pudo consultar conteo final: {e}")

if __name__ == '__main__':
    main()
