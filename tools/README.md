# Gallery tools

## make-gallery-zip.py — pre-built "Download all" archives

Full wedding galleries are several GB. Zipping that in the browser fails on
Safari / iOS Safari (WebKit can't hold a multi-GB file in memory), so the
gallery's **Download all** button uses a *pre-built* zip stored in R2 and
streamed to the browser via the same-origin `/cdn` proxy. That's the only path
that reliably downloads a multi-GB gallery on every device, including iPhones.

When a gallery has no pre-built zip, **Download all** falls back to in-browser
zipping (works on Chromium desktop; shows guidance on Safari/iOS). Building the
zip with this script upgrades it to a native download for everyone.

### One-time setup

```bash
pip3 install boto3
```

Create an **R2 S3 API token** (wrangler's OAuth login can't do multipart
uploads, which 2.5 GB files require):

> Cloudflare dashboard → R2 → **Manage R2 API Tokens** → **Create API Token** →
> permission **Object Read & Write** → scope to the `alex-claudio-galleries`
> bucket → Create. Copy the **Access Key ID** and **Secret Access Key**.

```bash
export R2_S3_ACCESS_KEY_ID=xxxxxxxx
export R2_S3_SECRET_ACCESS_KEY=xxxxxxxx
```

### Run it (once per gallery, at delivery)

```bash
# Build + upload a zip for every category that exists in the gallery:
python3 tools/make-gallery-zip.py jess-fenn

# Just one category:
python3 tools/make-gallery-zip.py jess-fenn wedding

# Faster: zip your local originals (upload only, no re-download from R2):
python3 tools/make-gallery-zip.py jess-fenn \
  --src engagement=/path/to/engagement \
  --src wedding=/path/to/wedding
```

It uploads to `{slug}/{slug}-{category}.zip`. Reload the gallery and
**Download all** is now a native download. Re-run any time a gallery's photos
change to refresh its zip.
