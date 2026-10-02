# Media

The media library is part of Shapio's core: folders, uploads with progress, alt text, captions, focal points,
image variants, private files and "used in" tracking. Files live in **storage** (local disk or any
S3-compatible service); their metadata lives in the database.

## Storage drivers

### Local disk (default)

```dotenv
STORAGE_DRIVER=local
MEDIA_PATH=./media
```

Shapio stores files under `MEDIA_PATH` and serves them itself. Back the directory up with the database
([Backup and restore](backup-restore.md)).

### S3-compatible storage (Cloudflare R2, AWS S3, Backblaze B2, DigitalOcean Spaces, Wasabi, versitygw…)

Cloudflare R2:

```dotenv
STORAGE_DRIVER=s3
STORAGE_S3_BUCKET=my-cms-media
STORAGE_S3_REGION=auto
STORAGE_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
STORAGE_S3_ACCESS_KEY_ID=…
STORAGE_S3_SECRET_ACCESS_KEY=…
```

Create the bucket and an R2 API token with _Object Read & Write_ on it (R2 → Manage R2 API Tokens). For AWS
S3 leave out `STORAGE_S3_ENDPOINT` and set the real region; for self-hosted gateways (versitygw, Garage,
SeaweedFS) also set `STORAGE_S3_FORCE_PATH_STYLE=true`.

**Uploads go straight from the browser to the bucket** (a presigned POST limited to the file's size and type);
Shapio never streams the bytes. The bucket's CORS rules must therefore allow `POST` from your admin's origin
(`PUBLIC_URL`). For R2 (bucket → Settings → CORS policy):

```json
[
  {
    "AllowedOrigins": ["https://cms.example.com"],
    "AllowedMethods": ["POST"],
    "AllowedHeaders": ["*"]
  }
]
```

### Serving public files from a CDN

Objects are stored under two prefixes, `public/` and `private/`. Expose only `public/` to the world (an R2
custom domain or public bucket with a rule for that prefix, or a CDN in front of Shapio) and set:

```dotenv
MEDIA_PUBLIC_BASE_URL=https://media.example.com
```

Public URLs then become `MEDIA_PUBLIC_BASE_URL/<key>`. Without it, Shapio serves public files at
`/api/media/f/<key>`, with long-lived cache headers (every upload and replacement gets a new key).

## Uploads

Uploads are limited by `MEDIA_MAX_UPLOAD_BYTES` (100 MB by default) and `MEDIA_ALLOWED_TYPES` (images, video,
audio, PDF, plain text, CSV and JSON by default). The type is checked from the file's bytes, not its name.
Upload, **replace** (keeps the asset ID, so content using it updates; the URL changes) and folders are in the
Media screen; uploads in the entry form use the same flow.

## Public and private files

- **Public** assets have stable URLs anyone can open.
- **Private** assets are only reachable through signed URLs that expire after one hour. The APIs return a fresh
  signed URL (`url`, `urlExpiresAt`) to callers allowed to read the entry. Nobody can guess one.

Changing an asset's visibility moves its object between prefixes.

## Image variants

For raster images Shapio renders WebP variants in the background: `thumbnail` (400×400 at most) and responsive
widths `w640`, `w1280` and `w1920` (only those narrower than the original; nothing is upscaled). Delivery lists
the ready ones with their URL and size, ready for a `srcset`:

```json
{
  "id": "…",
  "filename": "hero.png",
  "mimeType": "image/png",
  "width": 1600,
  "height": 900,
  "alt": "An abstract blue gradient",
  "url": "https://cms.example.com/api/media/f/public/…/hero.png",
  "variants": [
    {
      "name": "w640",
      "width": 640,
      "height": 360,
      "format": "webp",
      "mimeType": "image/webp",
      "url": "…/v/w640.webp"
    },
    {
      "name": "w1280",
      "width": 1280,
      "height": 720,
      "format": "webp",
      "mimeType": "image/webp",
      "url": "…/v/w1280.webp"
    }
  ]
}
```

## Used in, and safe deletes

Every asset shows which entries use it (in fields, components and rich-text images). An asset that content still
uses cannot be deleted; owners can force it, leaving the content pointing at a missing file. Deleted assets'
files are purged by a background job.

## Moving between local disk and S3

`shapio media migrate` copies every asset and its variants to the other storage, verifies checksums and
switches each asset over in its own transaction, while the server keeps running. It is safe to interrupt and
run again. On the server, with both the local and the S3 settings configured:

```sh
npx shapio media migrate --from local --to s3
```

Then set `STORAGE_DRIVER=s3` and restart, so new uploads go to S3. `--delete-source` removes the copies left
behind. The reverse (`--from s3 --to local`) works the same way.
