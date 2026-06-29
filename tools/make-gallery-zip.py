#!/usr/bin/env python3
"""Build and upload per-category "Download all" zips for a client gallery.

Why this exists
---------------
A full wedding gallery is several GB. Zipping that in the browser fails on
Safari / iOS Safari (WebKit can't hold a multi-GB Blob in memory), so "Download
all" instead points at a *pre-built* zip stored in R2 and streamed to the
browser via the same-origin /cdn proxy — the only path that reliably delivers a
multi-GB download on every device, including iPhones.

This script builds those zips. For each category it:
  1. reads the gallery's file list from the live list-gallery function,
  2. streams every photo into a STORE (uncompressed — JPEGs don't shrink) zip,
  3. multipart-uploads it to  {slug}/{slug}-{category}.zip  in R2.

Once uploaded, list-gallery.js reports the zip and the gallery automatically
turns "Download all" into a native download. Re-run after changing a gallery's
photos to refresh its zip.

One-time setup
--------------
  pip3 install boto3
  Create an R2 *S3 API* token (Cloudflare dashboard -> R2 -> "Manage R2 API
  Tokens" -> Create -> Object Read & Write). It gives an Access Key ID and a
  Secret Access Key. Export them (wrangler's OAuth login can't do multipart):

    export R2_S3_ACCESS_KEY_ID=xxxxxxxx
    export R2_S3_SECRET_ACCESS_KEY=xxxxxxxx

Usage
-----
  python3 make-gallery-zip.py <slug> [category ...]

  # both categories that exist for the gallery (default):
  python3 make-gallery-zip.py jess-fenn

  # just one:
  python3 make-gallery-zip.py jess-fenn wedding

  # zip local originals instead of re-downloading from R2 (faster — upload only):
  python3 make-gallery-zip.py jess-fenn --src wedding=/path/to/wedding/photos
"""

import argparse
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile

ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "1a4010c112299a6a4889b06084a077a2")
BUCKET = os.environ.get("R2_BUCKET_NAME", "alex-claudio-galleries")
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "https://alex-claudio.com")
LIST_FN = f"{SITE_ORIGIN}/.netlify/functions/list-gallery"
UA = "make-gallery-zip/1.0"
CATEGORIES = ["engagement", "wedding"]
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic")


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}"
        n /= 1024


def fetch_manifest(slug):
    req = urllib.request.Request(f"{LIST_FN}?c={slug}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        import json
        return json.load(r)


def zip_from_r2(photos, zip_path):
    """Stream each photo straight into a STORE zip via the same-origin /cdn proxy."""
    total = len(photos)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for i, p in enumerate(photos, 1):
            info = zipfile.ZipInfo(p["name"])
            info.compress_type = zipfile.ZIP_STORED
            req = urllib.request.Request(SITE_ORIGIN + p["downloadUrl"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as resp, zf.open(info, "w") as dest:
                shutil.copyfileobj(resp, dest, length=1024 * 1024)
            sys.stdout.write(f"\r  zipping {i}/{total} ({p['name'][:40]})        ")
            sys.stdout.flush()
    print()


def zip_from_local(src_dir, zip_path):
    files = sorted(
        f for f in os.listdir(src_dir)
        if f.lower().endswith(IMAGE_EXTS) and os.path.isfile(os.path.join(src_dir, f))
    )
    if not files:
        raise SystemExit(f"No image files found in {src_dir}")
    total = len(files)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for i, name in enumerate(files, 1):
            zf.write(os.path.join(src_dir, name), arcname=name)
            sys.stdout.write(f"\r  zipping {i}/{total} ({name[:40]})        ")
            sys.stdout.flush()
    print()
    return total


def upload(zip_path, key):
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
    except ImportError:
        raise SystemExit("boto3 is required:  pip3 install boto3")

    akid = os.environ.get("R2_S3_ACCESS_KEY_ID")
    secret = os.environ.get("R2_S3_SECRET_ACCESS_KEY")
    if not akid or not secret:
        raise SystemExit(
            "Set R2_S3_ACCESS_KEY_ID and R2_S3_SECRET_ACCESS_KEY (R2 S3 API token).\n"
            "Create one: Cloudflare dashboard -> R2 -> Manage R2 API Tokens -> Object Read & Write."
        )

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=akid,
        aws_secret_access_key=secret,
        region_name="auto",
    )
    cfg = TransferConfig(multipart_threshold=64 * 1024 * 1024, multipart_chunksize=64 * 1024 * 1024)
    size = os.path.getsize(zip_path)
    seen = {"n": 0}

    def progress(bytes_amount):
        seen["n"] += bytes_amount
        pct = 100 * seen["n"] / size if size else 100
        sys.stdout.write(f"\r  uploading {human(seen['n'])}/{human(size)} ({pct:.0f}%)        ")
        sys.stdout.flush()

    s3.upload_file(
        zip_path, BUCKET, key, Config=cfg, Callback=progress,
        ExtraArgs={
            "ContentType": "application/zip",
            "ContentDisposition": f'attachment; filename="{os.path.basename(key)}"',
        },
    )
    print()


def main():
    ap = argparse.ArgumentParser(description="Build + upload per-category gallery zips to R2.")
    ap.add_argument("slug")
    ap.add_argument("categories", nargs="*", help="engagement and/or wedding (default: whichever exist)")
    ap.add_argument("--src", action="append", default=[],
                    help="category=DIR to zip local originals instead of downloading from R2")
    args = ap.parse_args()

    local_src = {}
    for s in args.src:
        if "=" not in s:
            raise SystemExit(f"--src expects category=DIR, got: {s}")
        cat, d = s.split("=", 1)
        local_src[cat] = d

    manifest = fetch_manifest(args.slug)
    wanted = args.categories or [c for c in CATEGORIES if manifest.get(c)]
    if not wanted:
        raise SystemExit(f"No engagement/wedding photos found for '{args.slug}'.")

    for cat in wanted:
        if cat not in CATEGORIES:
            print(f"! skipping unknown category '{cat}'")
            continue
        key = f"{args.slug}/{args.slug}-{cat}.zip"
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = os.path.join(tmp, f"{args.slug}-{cat}.zip")
            if cat in local_src:
                print(f"[{cat}] zipping local originals from {local_src[cat]}")
                n = zip_from_local(local_src[cat], zip_path)
            else:
                photos = manifest.get(cat) or []
                if not photos:
                    print(f"[{cat}] no photos — skipping")
                    continue
                print(f"[{cat}] {len(photos)} photos, downloading from R2")
                zip_from_r2(photos, zip_path)
                n = len(photos)
            print(f"[{cat}] built {human(os.path.getsize(zip_path))} ({n} photos) -> uploading to {key}")
            upload(zip_path, key)
            print(f"[{cat}] done -> https://alex-claudio.com/cdn/{args.slug}/{args.slug}-{cat}.zip\n")

    print("All set. Reload the gallery — 'Download all' is now a native download.")


if __name__ == "__main__":
    main()
