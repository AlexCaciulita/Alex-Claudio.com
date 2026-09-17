# SEO review — Alex Claudio Photography

Reviewed September 16, 2026 Pacific / September 17 UTC.

## Scope and limits

This is a direct source-code and HTTP audit with on-site improvements, not a completed Semrush campaign audit. Semrush returned `no_api_units` for project, organic-research, and keyword-research discovery. No search-volume, keyword-difficulty, traffic, backlink, or ranking figures were available. Search Console, Google Business Profile, field Core Web Vitals, and actual Google indexing status were not verified. No first-page ranking is promised.

## Findings and changes

| Finding | Change |
| --- | --- |
| Sitemap listed five pages and omitted the Journal and all three posts. | Added all four Journal URLs; nine canonical URLs now listed. Kept existing public links and lead pages. Removed unsupported old modification dates and unused priority/frequency hints. |
| Both www and non-www served HTML; `/index.html` and directory versions returned the same page. | Permanent redirects consolidate known public page aliases and www into non-www directory URLs. Queries are preserved. Health, submission, and gallery API handlers remain unaffected. |
| Internal Journal links used index.html aliases; portfolio and pricing lacked published Journal navigation. | Canonical directory links across the seven primary pages; Journal links in desktop, mobile, and footer navigation. |
| Homepage did not link directly to planning articles. | Added a text-only Journal section linking the rain, coverage, and timeline articles. |
| Page titles and the homepage headline could identify Seattle search intent more directly. | Revised homepage, portfolio, pricing, and Journal titles; homepage H1 now says “Seattle wedding photography.” No keyword repetition added to image descriptions. |
| Articles lacked structured authorship, dates, and breadcrumbs. | Added BlogPosting and BreadcrumbList data, matching visible author/date information and the existing single photograph. Dates come from first-publication and article-revision commits, not invented history. |
| Business data included a city-center coordinate and ZIP code without a verified studio address. | Retained Seattle/WA/US locality; removed the unsupported precise coordinate and ZIP. Added the already-published contact email and Instagram URL. |
| Social previews referenced an oversized legacy photograph. | Use the existing optimized homepage image on home, portfolio, and pricing. This affects previews; it is not a measured page-speed improvement. |
| robots.txt and sitemap.xml received week-long caching. | Both now revalidate, so subsequent crawl instructions can update promptly. |

Prices, gallery behavior, photography, article bodies, and the user's requested “We Photographed” wording remain unchanged. A separate pre-existing local relationship-label edit was preserved in the working file but excluded from this deployment.

## Page intent

These are editorial targeting choices based on the actual business and page content, not Semrush-validated volume estimates.

| Page | Primary search intent |
| --- | --- |
| `/` | Seattle wedding photographers |
| `/portfolio/` | Seattle wedding photography portfolio |
| `/pricing/` | Seattle wedding photography pricing |
| `/blog/` | Wedding photography planning advice |
| `/blog/seattle-wedding-rain-plan/` | Planning for rain at a Seattle wedding |
| `/blog/how-many-hours-wedding-photography/` | How many hours of wedding photography to book |
| `/blog/wedding-photography-timeline/` | Building a wedding photography timeline |

## Remaining work, in priority order

1. **Search Console:** use a verified domain property, submit `https://alex-claudio.com/sitemap.xml`, and inspect the homepage plus the three article URLs. Check Google's selected canonical and any crawl/indexing exclusions. A successful request is not a guarantee of indexing. Record clicks, impressions, queries, and inquiry conversions before judging results.
2. **Google Business Profile:** verify ownership and eligibility; check the real business name, primary category, website, service area, contact details, and hours. Do not publish a home address or invent a storefront. Local results depend on relevance, distance, and prominence, not merely page tags.
3. **Evidence-rich content:** publish genuine wedding stories at venues actually photographed, with permission to use the couples' images and names. Include practical observations that only the photographer could supply. Do not create near-duplicate city pages or invent venue experience.
4. **Reputation:** ask actual clients for honest reviews without incentives, and seek appropriate photographer credit links from venues and collaborators. Verify existing testimonial provenance before presenting them as evidence. No paid link schemes or fabricated ratings.
5. **Performance and measurement:** check mobile PageSpeed Insights and Search Console Core Web Vitals. Optimize only against measured bottlenecks; this pass does not establish a Lighthouse score or field-performance baseline. Review useful traffic and inquiries, not rankings alone.
6. **Semrush:** restore sufficient API units before running a full crawl, localized position tracking, and competitor/backlink research. Avoid purchasing additional capacity without the owner's approval.

## Verification

Regression coverage checks canonical redirects for GET/HEAD, query preservation, www normalization, crawl-file caching, unknown-page 404s, health checks, gallery availability, and submission validation/honeypots. SEO tests validate the nine sitemap URLs, canonical/indexability consistency, article schema against visible content, and direct internal links. Existing article tests still enforce one photograph per post and agreed collection prices.

## Guidance used

- [Google: consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) supports permanent redirects and consistent canonical URLs.
- [Google: build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) explains canonical URL selection and meaningful modification dates.
- [Google: Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article) documents author, image, headline, and date properties; markup does not guarantee enhanced search presentation.
- [Google: publication dates](https://developers.google.com/search/docs/appearance/publication-dates) recommends consistent visible and structured dates.
- [Google: local ranking](https://support.google.com/business/answer/7091) describes relevance, distance, and prominence.
- [Google: choosing an SEO](https://developers.google.com/search/docs/fundamentals/do-i-need-seo) cautions against guaranteed first-place rankings.
