## Portfolio content workflow

1) Pick a category folder under `portfolio/content/` (weddings, elopements, engagements). Add new categories as needed.
2) Create an event folder named `YYYY-MM-firstname-secondname-venue` (lowercase, hyphens).
3) Add your images into that folder. Use lowercase, hyphenated filenames (e.g., `image001.jpg`). WebP allowed.
4) Create `metadata.json` inside the event folder using this template:
```json
{
  "coupleNames": "Sarah & Michael",
  "eventDate": "2024-09-15",
  "venue": "The Edgewater Hotel",
  "location": "Seattle, WA",
  "eventType": "Full Wedding",
  "description": "A romantic waterfront wedding at Seattle's iconic Edgewater Hotel with stunning sunset views over Elliott Bay.",
  "featured": true,
  "coverImage": "image001.jpg",
  "tags": ["waterfront", "luxury", "sunset", "seattle", "fall"],
  "season": "Fall"
}
```

5) Run the build script to regenerate data:
```
node scripts/build-portfolio.js
```
This scans `portfolio/content/**` and writes `portfolio/portfolio-data.json`, which the front-end reads automatically.

Notes:
- Placeholders are provided; replace them with real images.
- The front-end uses lazy loading and falls back to a placeholder if an image is missing.
- Filters/search/sort use the metadata fields; keep them accurate for best results.
