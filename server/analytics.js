// Reading a page view: where the visitor came from, on what kind of device, and whether it was a person at all.
// Only these summaries are kept. The full referring address, the user agent and the IP address are never stored.
const { countryOfZone } = require('./timezones');

const SITE_HOSTS = new Set(['alex-claudio.com', 'www.alex-claudio.com']);
const DEVICES = new Set(['Mobile', 'Tablet', 'Desktop']);
const PAGE_ID = /^[a-f0-9]{16,32}$/;
const BOT = /bot\b|bot\/|crawl|spider|slurp|scrape|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|pingdom|uptime|monitor|curl\/|wget|python|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|phantom|selenium|puppeteer|playwright/i;

// Referring sites, by host, and the name shown for them. The first match wins, so Gemini comes before Google.
const REFERRERS = [
  [/^gemini\.google\.com$/, 'Gemini'],
  [/^(mail\.google\.com|com\.google\.android\.gm)$/, 'Gmail'],
  [/(^|\.)google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, 'Google'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'Yahoo'],
  [/(^|\.)ecosia\.org$/, 'Ecosia'],
  [/(^|\.)yandex\.[a-z.]+$/, 'Yandex'],
  [/(^|\.)baidu\.com$/, 'Baidu'],
  [/(^|\.)brave\.com$/, 'Brave Search'],
  [/(^|\.)instagram\.com$|^com\.instagram\.android$/, 'Instagram'],
  [/(^|\.)facebook\.com$|^fb\.me$|^com\.facebook\.katana$/, 'Facebook'],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, 'Pinterest'],
  [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'X'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn'],
  [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/(^|\.)threads\.net$|(^|\.)threads\.com$/, 'Threads'],
  [/^chatgpt\.com$|^chat\.openai\.com$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/^claude\.ai$/, 'Claude'],
  [/^copilot\.microsoft\.com$/, 'Copilot'],
  [/(^|\.)theknot\.com$/, 'The Knot'],
  [/(^|\.)weddingwire\.com$/, 'WeddingWire'],
  [/(^|\.)zola\.com$/, 'Zola'],
  [/(^|\.)junebugweddings\.com$/, 'Junebug Weddings'],
  [/(^|\.)yelp\.com$/, 'Yelp']
];

// utm_source values, as written in tagged links (the /ig link uses "instagram"; ChatGPT adds "chatgpt.com").
const TAGGED = {
  ig: 'Instagram', instagram: 'Instagram', fb: 'Facebook', facebook: 'Facebook', google: 'Google', gbp: 'Google',
  pinterest: 'Pinterest', tiktok: 'TikTok', youtube: 'YouTube', email: 'Email', newsletter: 'Email', mail: 'Email',
  chatgpt: 'ChatGPT', perplexity: 'Perplexity', theknot: 'The Knot', weddingwire: 'WeddingWire', zola: 'Zola'
};

// In-app browsers often send no referrer at all, but they name themselves in the user agent.
const IN_APP = [
  [/Instagram/, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS/, 'Facebook'],
  [/Pinterest/, 'Pinterest'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/LinkedInApp/, 'LinkedIn']
];

const BROWSERS = [
  [/Instagram/, 'Instagram app'],
  [/FBAN|FBAV|FB_IAB|FBIOS/, 'Facebook app'],
  [/Pinterest/, 'Pinterest app'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok app'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox|FxiOS/, 'Firefox'],
  [/DuckDuckGo/, 'DuckDuckGo'],
  [/Chrome|CriOS/, 'Chrome'],
  [/Safari/, 'Safari']
];

const SYSTEMS = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux']
];

const firstMatch = (list, value, fallback) => (list.find(([pattern]) => pattern.test(value)) || [null, fallback])[1];
const clip = (value, max) => String(value || '').trim().slice(0, max);

const isBot = (userAgent) => !userAgent || BOT.test(userAgent);

const describeAgent = (userAgent) => ({
  browser: firstMatch(BROWSERS, String(userAgent || ''), 'Other'),
  os: firstMatch(SYSTEMS, String(userAgent || ''), 'Other')
});

// Just the host of the page that linked here, without "www.": nothing about the page itself is kept.
function referrerHost(referrer) {
  const value = String(referrer || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    const host = (url.protocol === 'android-app:' ? url.host || url.pathname.replace(/^\/+/, '') : url.hostname).toLowerCase();
    return host.replace(/^www\./, '').slice(0, 100);
  } catch (error) {
    return '';
  }
}

// The name a visit is filed under: a tagged link first, then the referring site, then the app it was opened in.
function sourceOf({ referrer = '', tag = '', userAgent = '' } = {}) {
  const tagged = clip(tag, 60).toLowerCase();
  if (tagged) {
    const named = TAGGED[tagged] || TAGGED[tagged.replace(/\.(com|net|org|ai)$/, '')];
    if (named) return named;
    const asHost = firstMatch(REFERRERS, tagged.replace(/^www\./, ''), null);
    if (asHost) return asHost;
    return tagged.charAt(0).toUpperCase() + tagged.slice(1);
  }
  const host = referrerHost(referrer);
  if (host && !SITE_HOSTS.has(host) && !SITE_HOSTS.has(`www.${host}`)) return firstMatch(REFERRERS, host, host);
  return firstMatch(IN_APP, String(userAgent || ''), 'Direct');
}

// A page view as the page's script sent it, checked and trimmed. Returns null for anything else.
function readView(body, userAgent) {
  if (!body || body.kind !== 'view' || !PAGE_ID.test(String(body.page || ''))) return null;
  const host = referrerHost(body.referrer);
  const internal = SITE_HOSTS.has(host) || SITE_HOSTS.has(`www.${host}`);
  const timezone = clip(body.tz, 64);
  return {
    page: body.page,
    path: String(body.path || ''),
    source: sourceOf({ referrer: body.referrer, tag: body.source, userAgent }),
    referrer: internal ? '' : host,
    medium: clip(body.medium, 60),
    campaign: clip(body.campaign, 100),
    device: DEVICES.has(body.device) ? body.device : 'Desktop',
    timezone,
    country: countryOfZone(timezone),
    ...describeAgent(userAgent)
  };
}

// How long a page stayed in front, at most four hours.
function readTime(body) {
  if (!body || body.kind !== 'time' || !PAGE_ID.test(String(body.page || ''))) return null;
  const seconds = Math.round(Number(body.seconds));
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return { page: body.page, seconds: Math.min(seconds, 4 * 60 * 60) };
}

// At most `limit` requests per address in `windowMs`, so nobody can flood the counts.
function createRateLimit(limit, windowMs) {
  const byIp = new Map();
  return (ip, now = Date.now()) => {
    const recent = (byIp.get(ip) || []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    byIp.set(ip, recent);
    if (byIp.size > 5000) for (const [key, times] of byIp) if (times.every((time) => now - time >= windowMs)) byIp.delete(key);
    return true;
  };
}

module.exports = { createRateLimit, describeAgent, isBot, readTime, readView, referrerHost, sourceOf };
