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
import sys
import tempfile
import time
import urllib.request
import zipfile

ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "1a4010c112299a6a4889b06084a077a2")
BUCKET = os.environ.get("R2_BUCKET_NAME", "alex-claudio-galleries")
SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "https://alex-claudio.com")
LIST_FN = f"{SITE_ORIGIN}/.netlify/functions/list-gallery"
UA = "make-gallery-zip/1.0"
CATEGORIES = ["engagement", "wedding"]
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic")


class _NullCtx:
    """Context manager yielding a fixed dir that is NOT deleted on exit (so a
    failed upload can be retried without rebuilding the zip)."""
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        return self.path

    def __exit__(self, *exc):
        return False


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}"
        n /= 1024


def _get(url, attempts=6, timeout=120):
    """GET a URL, retrying transient network/SSL errors with backoff. Returns
    the full response body (each photo is a few MB, so buffering one at a time
    is fine and makes the download atomically retryable)."""
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # URLError, SSL EOF, timeout, transient 5xx
            last = e
            time.sleep(min(15, 2 * (i + 1)))
    raise SystemExit(f"\nGave up after {attempts} tries on {url}\n  last error: {last}")


def fetch_manifest(slug):
    import json
    return json.loads(_get(f"{LIST_FN}?c={slug}", timeout=60))


def zip_from_r2(photos, zip_path):
    """Download each photo (with retries) into a STORE zip via the /cdn proxy."""
    total = len(photos)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for i, p in enumerate(photos, 1):
            data = _get(SITE_ORIGIN + p["downloadUrl"])
            info = zipfile.ZipInfo(p["name"])
            info.compress_type = zipfile.ZIP_STORED
            zf.writestr(info, data)
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


def _abort_incomplete(s3, key):
    """Abort any half-finished multipart upload for this key (orphans left by a
    prior failed attempt — they'd otherwise accumulate as billable storage)."""
    try:
        r = s3.list_multipart_uploads(Bucket=BUCKET, Prefix=key)
        for u in r.get("Uploads", []):
            s3.abort_multipart_upload(Bucket=BUCKET, Key=u["Key"], UploadId=u["UploadId"])
            print(f"  (aborted stale multipart upload for {u['Key']})")
    except Exception:
        pass


def upload(zip_path, key, attempts=5):
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
        from botocore.config import Config
    except ImportError:
        raise SystemExit("boto3 is required:  pip3 install boto3")

    akid = os.environ.get("R2_S3_ACCESS_KEY_ID")
    secret = os.environ.get("R2_S3_SECRET_ACCESS_KEY")
    if not akid or not secret:
        raise SystemExit(
            "Set R2_S3_ACCESS_KEY_ID and R2_S3_SECRET_ACCESS_KEY (R2 S3 API token).\n"
            "Create one: Cloudflare dashboard -> R2 -> Manage R2 API Tokens -> Object Read & Write."
        )

    # This machine's Python 3.9 TLS stack intermittently corrupts the connection
    # mid-multipart ("SSL bad record mac"), and botocore's in-process retries
    # reuse the same poisoned connection. So: upload parts on a single connection
    # (use_threads=False), and on failure rebuild a FRESH client (fresh TLS) and
    # retry the whole upload after clearing the half-done one.
    cfg = TransferConfig(
        multipart_threshold=64 * 1024 * 1024,
        multipart_chunksize=64 * 1024 * 1024,
        use_threads=False,
    )
    size = os.path.getsize(zip_path)

    last = None
    for attempt in range(1, attempts + 1):
        seen = {"n": 0}

        def progress(bytes_amount):
            seen["n"] += bytes_amount
            pct = 100 * seen["n"] / size if size else 100
            sys.stdout.write(f"\r  uploading {human(seen['n'])}/{human(size)} ({pct:.0f}%)        ")
            sys.stdout.flush()

        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=akid,
            aws_secret_access_key=secret,
            region_name="auto",
            config=Config(retries={"max_attempts": 6, "mode": "standard"}, max_pool_connections=4),
        )
        try:
            _abort_incomplete(s3, key)
            s3.upload_file(
                zip_path, BUCKET, key, Config=cfg, Callback=progress,
                ExtraArgs={
                    "ContentType": "application/zip",
                    "ContentDisposition": f'attachment; filename="{os.path.basename(key)}"',
                },
            )
            print()
            return
        except Exception as e:
            last = e
            print(f"\n  upload attempt {attempt}/{attempts} failed ({type(e).__name__}); retrying…")
            _abort_incomplete(s3, key)
            time.sleep(3 * attempt)
    raise SystemExit(f"Upload failed after {attempts} attempts: {last}")


def main():
    ap = argparse.ArgumentParser(description="Build + upload per-category gallery zips to R2.")
    ap.add_argument("slug")
    ap.add_argument("categories", nargs="*", help="engagement and/or wedding (default: whichever exist)")
    ap.add_argument("--src", action="append", default=[],
                    help="category=DIR to zip local originals instead of downloading from R2")
    ap.add_argument("--work-dir",
                    help="keep built zips here and reuse an existing same-size zip on re-run "
                         "(so a failed upload doesn't re-download). Default: a temp dir.")
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

    tmpctx = (lambda: _NullCtx(args.work_dir)) if args.work_dir else tempfile.TemporaryDirectory
    if args.work_dir:
        os.makedirs(args.work_dir, exist_ok=True)

    for cat in wanted:
        if cat not in CATEGORIES:
            print(f"! skipping unknown category '{cat}'")
            continue
        key = f"{args.slug}/{args.slug}-{cat}.zip"
        with tmpctx() as tmp:
            zip_path = os.path.join(tmp, f"{args.slug}-{cat}.zip")
            photos = manifest.get(cat) or []
            expected = sum(p.get("size", 0) for p in photos) if cat not in local_src else None
            reuse = (args.work_dir and os.path.exists(zip_path)
                     and (expected is None or abs(os.path.getsize(zip_path) - expected) < expected * 0.02))
            if reuse:
                print(f"[{cat}] reusing already-built {zip_path} ({human(os.path.getsize(zip_path))})")
                n = len(photos)
            elif cat in local_src:
                print(f"[{cat}] zipping local originals from {local_src[cat]}")
                n = zip_from_local(local_src[cat], zip_path)
            else:
                if not photos:
                    print(f"[{cat}] no photos — skipping")
                    continue
                print(f"[{cat}] {len(photos)} photos, downloading from R2")
                zip_from_r2(photos, zip_path)
                n = len(photos)
            print(f"[{cat}] built {human(os.path.getsize(zip_path))} ({n} photos) -> uploading to {key}")
            upload(zip_path, key)
            print(f"[{cat}] done -> {SITE_ORIGIN}/cdn/{args.slug}/{args.slug}-{cat}.zip\n")

    print("All set. Reload the gallery — 'Download all' is now a native download.")


if __name__ == "__main__":
    main()
