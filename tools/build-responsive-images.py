"""Rebuild responsive derivatives and the HTML portfolio. Requires Pillow."""
import html
import json
import re
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'responsive'


def variants(source, key):
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        width, height = image.size
        candidates = []
        for size in sorted({min(width, target) for target in [400, 800, 1200, 1600]}):
            destination = OUTPUT / f'{key}-{size}.webp'
            destination.parent.mkdir(parents=True, exist_ok=True)
            resized = image.resize((size, round(height * size / width)), Image.Resampling.LANCZOS)
            resized.save(destination, 'WEBP', quality=82, method=6)
            candidates.append((f'/assets/responsive/{destination.name}', size))
    return candidates, width, height


def srcset(candidates):
    return ', '.join(f'{url} {width}w' for url, width in candidates)


for page in [ROOT / 'index.html', ROOT / 'pricing/index.html', *sorted((ROOT / 'blog').glob('**/index.html'))]:
    source = page.read_text()

    def update_image(match):
        tag = match[0]
        path = re.search(r'\bsrc="([^"]+)"', tag)
        if not path or '/assets/' not in '/' + path[1] or path[1].startswith('https:'):
            return tag
        file = (page.parent / path[1]).resolve()
        if file.suffix.lower() not in ['.jpg', '.jpeg', '.png']:
            return tag
        key = '-'.join(file.relative_to(ROOT / 'assets').with_suffix('').parts)
        candidates, width, height = variants(file, key)
        for attribute in ['srcset', 'sizes', 'width', 'height']:
            tag = re.sub(r'\s+' + attribute + r'="[^"]*"', '', tag)
        if 'hero-img' in tag:
            sizes = '(max-width: 760px) 120vh, 100vw'
        elif '/studio/' in path[1]:
            sizes = '(max-width: 760px) 45vw, (max-width: 1100px) 30vw, 320px'
        elif 'cover-photo' in tag:
            sizes = '(max-width: 760px) 100vw, 65vw'
        else:
            sizes = '(max-width: 760px) 100vw, (max-width: 1100px) 66vw, 900px'
        return tag[:-1] + f' width="{width}" height="{height}" srcset="{srcset(candidates)}" sizes="{sizes}">'

    source = re.sub(r'<img\b[^>]*>', update_image, source)
    if page == ROOT / 'index.html':
        hero = re.search(r'<img class="hero-img"[^>]*srcset="([^"]+)" sizes="([^"]+)"', source)
        source = re.sub(r'<link rel="preload" as="image"[^>]*>',
                        f'<link rel="preload" as="image" href="assets/home/faq-craft-1600.jpg" imagesrcset="{hero[1]}" imagesizes="{hero[2]}">', source)
    page.write_text(source)

figures = []
for index, entry in enumerate(json.loads((ROOT / 'portfolio/images.json').read_text())):
    key = f'portfolio-{index + 1:02d}'
    candidates, width, height = variants(ROOT / 'Portofolio' / entry['file'], key)
    default = next((url for url, size in candidates if size >= 800), candidates[-1][0])
    full = '/Portofolio/' + quote(entry['file'], safe='')
    alt = html.escape(entry['alt'], quote=True)
    loading = 'eager' if index < 3 else 'lazy'
    figures.append(f'            <figure class="portfolio-photo masonry-item"><a href="{full}" data-gallery-image><img src="{default}" alt="{alt}" width="{width}" height="{height}" srcset="{srcset(candidates)}" sizes="(max-width: 640px) 100vw, (max-width: 1023px) 50vw, 33vw" loading="{loading}" decoding="async"></a></figure>')

page = ROOT / 'portfolio/index.html'
source = page.read_text()
source = re.sub(r'<div id="portfolioGallery" class="masonry-gallery"[^>]*>[\s\S]*?</div>',
                '<div id="portfolioGallery" class="masonry-gallery">\n' + '\n'.join(figures) + '\n            </div>', source)
page.write_text(source)
print(f'Built {len(list(OUTPUT.glob("*.webp")))} responsive images and {len(figures)} HTML gallery entries.')
