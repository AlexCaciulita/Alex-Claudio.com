#!/usr/bin/env node
/**
 * Build portfolio data by scanning portfolio/content/* folders.
 * Outputs portfolio/portfolio-data.json for the front-end to consume.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'portfolio', 'content');
const OUTPUT = path.join(ROOT, 'portfolio', 'portfolio-data.json');
const VALID_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findEvents() {
  const categories = fs.readdirSync(CONTENT_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const events = [];

  categories.forEach((category) => {
    const categoryDir = path.join(CONTENT_DIR, category.name);
    fs.readdirSync(categoryDir, { withFileTypes: true }).forEach((eventDir) => {
      if (!eventDir.isDirectory()) return;
      const eventPath = path.join(categoryDir, eventDir.name);
      const metadataPath = path.join(eventPath, 'metadata.json');
      if (!fs.existsSync(metadataPath)) {
        console.warn(`Skipping ${eventDir.name} (no metadata.json)`);
        return;
      }
      const metadata = readJson(metadataPath);
      const images = fs
        .readdirSync(eventPath)
        .filter((f) => VALID_IMAGE_EXT.has(path.extname(f).toLowerCase()))
        .sort();

      events.push({
        id: eventDir.name,
        category: category.name,
        ...metadata,
        images
      });
    });
  });

  return events.sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
}

function build() {
  const events = findEvents();
  fs.writeFileSync(OUTPUT, JSON.stringify({ events }, null, 2), 'utf8');
  console.log(`Generated ${OUTPUT} with ${events.length} events.`);
}

if (require.main === module) {
  build();
}
