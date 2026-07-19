#!/usr/bin/env python3
"""
Freshket Sense — CSV Bundle Splitter
รัน: python3 splitter.py

อ่าน CSV ที่ export จาก BQ แล้ว split เป็นไฟล์ต่อ KAM และ upload ขึ้น R2

ต้องการ:
  pip install boto3

ตั้งค่า R2 credentials:
  R2_ENDPOINT  = https://<account-id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY
  R2_SECRET_KEY
  R2_BUCKET    = ชื่อ bucket
"""

import csv, os, re, sys
from collections import defaultdict
from pathlib import Path

# ── Config ───────────────────────────────────────────────────
R2_ENDPOINT   = os.environ.get('R2_ENDPOINT', '')
R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY', '')
R2_SECRET_KEY = os.environ.get('R2_SECRET_KEY', '')
R2_BUCKET     = os.environ.get('R2_BUCKET', 'freshket-sense')
OUTPUT_DIR    = Path('output_bundles')

# Input files (ผลจาก BQ export)
FILES = {
    'download_skus.csv':        'sense_skus_{key}.csv',        # SQL1
    'download_alts.csv':        'sense_alts_{key}.csv',        # SQL2
    'download_upsell_bulk.csv': 'sense_upsell_{key}.csv',      # q3c_bulk
    'download_sku_outlet.csv':  'sense_sku_outlet_{key}.csv',  # Q12B
}
# ── Helpers ──────────────────────────────────────────────────
def safe_key(email: str) -> str:
    """Mirrors _kamSafeKey() in app JS"""
    return re.sub(r'[^a-z0-9]', '_', email.lower())

def split_csv(input_path: str, output_pattern: str) -> dict:
    """Split CSV by first column (kam_email), remove first col from output"""
    buckets = defaultdict(list)
    with open(input_path, encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        out_header = header[1:]  # ตัด kam_email column แรกออก
        for row in reader:
            if not row or not row[0].strip():
                continue
            email = row[0].strip()
            buckets[email].append(row[1:])

    results = {}
    for email, rows in buckets.items():
        key = safe_key(email)
        filename = output_pattern.format(key=key)
        results[filename] = {'email': email, 'header': out_header, 'rows': rows}
    return results

def write_local(filename: str, header: list, rows: list) -> Path:
    OUTPUT_DIR.mkdir(exist_ok=True)
    path = OUTPUT_DIR / filename
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    return path

def upload_r2(local_path: Path, filename: str):
    try:
        import boto3
        s3 = boto3.client('s3',
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
        )
        with open(local_path, 'rb') as f:
            s3.put_object(Bucket=R2_BUCKET, Key=filename, Body=f,
                         ContentType='text/csv; charset=utf-8')
        return True
    except Exception as e:
        print(f"    ⚠️  R2 upload failed: {e}")
        return False

# ── Main ─────────────────────────────────────────────────────
def main():
    do_upload = bool(R2_ENDPOINT and R2_ACCESS_KEY and R2_SECRET_KEY)
    if not do_upload:
        print("ℹ️  R2 credentials not set — จะ write ไฟล์ local เท่านั้น")
        print("   ตั้งค่า env: R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET\n")

    total_files = 0
    for input_file, output_pattern in FILES.items():
        if not Path(input_file).exists():
            print(f"⏭️  ข้าม {input_file} (ไม่พบไฟล์)")
            continue

        print(f"\n📂 {input_file}  →  {output_pattern}")
        bundles = split_csv(input_file, output_pattern)
        print(f"   พบ {len(bundles)} KAM bundles")

        for filename, data in sorted(bundles.items()):
            rows = data['rows']
            local_path = write_local(filename, data['header'], rows)
            status = f"{len(rows)} rows"

            if do_upload:
                ok = upload_r2(local_path, filename)
                status += ' → R2 ✅' if ok else ' → R2 ❌'
            else:
                status += f' → {local_path}'

            print(f"   {filename:<50} {status}")
            total_files += 1

    print(f"\n✅ เสร็จ — {total_files} ไฟล์")
    if not do_upload:
        print(f"   ไฟล์อยู่ใน {OUTPUT_DIR}/")
        print("   upload ขึ้น R2 เองโดย:")
        print("   export R2_ENDPOINT=... R2_ACCESS_KEY=... R2_SECRET_KEY=... R2_BUCKET=...")
        print("   python3 splitter.py")

if __name__ == '__main__':
    main()
