#!/usr/bin/env python3
"""
sales_csv_splitter.py — Split batch BigQuery export into per-rep CSVs and upload to R2

Usage:
  python3 sales_csv_splitter.py portview   download_sales_portview.csv
  python3 sales_csv_splitter.py skus       download_sales_skus.csv
  python3 sales_csv_splitter.py alts       download_sales_alts.csv

Requirements:
  pip install boto3
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, R2_ENDPOINT_URL ต้องตั้งใน env
  หรือแก้ R2_* constants ด้านล่างตรงๆ

Output filename pattern:
  portview  → sales_portview_{safeKey}.csv
  skus      → sense_skus_{safeKey}.csv
  alts      → sense_alts_{safeKey}.csv
"""

import sys, csv, re, os, io
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────
R2_BUCKET   = "freshket-data"
R2_ENDPOINT = os.getenv("R2_ENDPOINT_URL", "https://<ACCOUNT_ID>.r2.cloudflarestorage.com")
R2_KEY_ID   = os.getenv("AWS_ACCESS_KEY_ID", "")
R2_SECRET   = os.getenv("AWS_SECRET_ACCESS_KEY", "")

FILE_PATTERNS = {
    "portview": "sales_portview_{key}.csv",
    "skus":     "sense_skus_{key}.csv",
    "alts":     "sense_alts_{key}.csv",
}

def safe_key(email: str) -> str:
    return re.sub(r"[^a-z0-9]", "_", email.lower())

def split_csv(file_type: str, input_path: str):
    if file_type not in FILE_PATTERNS:
        print(f"❌ Unknown type: {file_type}. Use: portview | skus | alts")
        sys.exit(1)

    pattern = FILE_PATTERNS[file_type]
    groups  = defaultdict(list)
    header  = None

    print(f"📂 Reading {input_path} ...")
    with open(input_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            if i == 0:
                if row[0] not in ("sales_email", "kam_email"):
                    print(f"❌ First column must be 'sales_email', got '{row[0]}'")
                    sys.exit(1)
                header = row[1:]   # strip email col from header
                continue
            if not row:
                continue
            email = row[0].strip().lower()
            if not email:
                continue
            groups[email].append(row[1:])  # strip email col from data

    print(f"✅ Found {len(groups)} reps, {sum(len(v) for v in groups.values())} rows total")
    print()

    # ── Upload to R2 ───────────────────────────────────────────────────
    try:
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_KEY_ID,
            aws_secret_access_key=R2_SECRET,
        )
        upload_available = bool(R2_KEY_ID and R2_SECRET and R2_ENDPOINT != "https://<ACCOUNT_ID>.r2.cloudflarestorage.com")
    except ImportError:
        s3 = None
        upload_available = False
        print("⚠️  boto3 not installed — will write local files only (no R2 upload)")

    local_dir = f"output_{file_type}"
    os.makedirs(local_dir, exist_ok=True)

    results = []
    for email, rows in sorted(groups.items()):
        key  = safe_key(email)
        name = pattern.format(key=key)

        # Build CSV in memory
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        writer.writerows(rows)
        csv_bytes = buf.getvalue().encode("utf-8")

        # Write local
        local_path = os.path.join(local_dir, name)
        with open(local_path, "wb") as f:
            f.write(csv_bytes)

        # Upload to R2
        status = "local only"
        if upload_available:
            try:
                s3.put_object(
                    Bucket=R2_BUCKET,
                    Key=name,
                    Body=csv_bytes,
                    ContentType="text/csv",
                )
                status = "✅ R2 uploaded"
            except Exception as e:
                status = f"❌ R2 failed: {e}"

        results.append((email, name, len(rows), status))
        print(f"  {email:<40} → {name:<50} ({len(rows)} rows)  {status}")

    print()
    print(f"Done. Local files in: {local_dir}/")
    if not upload_available:
        print("To upload: set R2_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY then re-run")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    split_csv(sys.argv[1], sys.argv[2])
