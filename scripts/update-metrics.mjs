/**
 * Re-fetches the small set of public numbers that actually change day to
 * day (follower counts on Instagram/Facebook/LinkedIn), folds them into
 * data/metrics.json, recomputes real scores via scoring.js, and appends
 * today's real snapshot to each channel's history. Everything else in
 * metrics.json (bio/profile completeness, website structure, trust
 * signals, etc.) requires either the account owner's private analytics or
 * a manual site check, and is left untouched here.
 *
 * Meant to be run from the repo root: `node scripts/update-metrics.mjs`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeAllScores } from "../js/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS_PATH = path.join(__dirname, "..", "data", "metrics.json");

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const LOOKBACK_TOLERANCE_MS = 10 * 24 * 60 * 60 * 1000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function extractOgDescription(html) {
  const m = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

function extractMetaDescription(html) {
  const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

async function fetchText(url, ua) {
  const res = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function getInstagramFollowers() {
  const html = await fetchText("https://www.instagram.com/myadventuregroup/", MOBILE_UA);
  const desc = extractOgDescription(html);
  const m = desc && desc.match(/([\d,]+)\s+Followers/i);
  if (!m) throw new Error(`followers not found in og:description: ${desc ?? "(none)"}`);
  return parseInt(m[1].replace(/,/g, ""), 10);
}

async function getFacebookLikes() {
  const html = await fetchText("https://www.facebook.com/MyAdventureGroup", MOBILE_UA);
  const desc = extractOgDescription(html);
  // Facebook sometimes serves a localized description ("1,432 like" instead
  // of "likes", other languages entirely for "talking about"/"were here") -
  // match on the number immediately preceding "like" in any form/language,
  // since that phrase always appears first regardless of locale.
  const m = desc && desc.match(/([\d,]+)\s+like/i);
  if (!m) throw new Error(`likes not found in og:description: ${desc ?? "(none)"}`);
  return parseInt(m[1].replace(/,/g, ""), 10);
}

async function getLinkedInFollowers() {
  const html = await fetchText("https://www.linkedin.com/company/myadventure-group/", DESKTOP_UA);
  const desc = extractMetaDescription(html);
  const m = desc && desc.match(/([\d,]+)\s+followers/i);
  if (!m) throw new Error(`followers not found in meta description: ${desc ?? "(none)"}`);
  return parseInt(m[1].replace(/,/g, ""), 10);
}

const FETCHERS = {
  instagram: getInstagramFollowers,
  facebook: getFacebookLikes,
  linkedin: getLinkedInFollowers,
};

async function main() {
  const metrics = JSON.parse(readFileSync(METRICS_PATH, "utf8"));
  const date = today();
  const report = { date, fetched: {}, errors: {} };

  for (const [key, fetcher] of Object.entries(FETCHERS)) {
    try {
      const value = await fetcher();
      metrics.channels[key].raw.followers = value;
      report.fetched[key] = value;
    } catch (err) {
      report.errors[key] = String(err.message || err);
    }
  }

  // Roll a small per-channel follower log so growth can be computed against
  // ~30 days ago (what scoring.js's growth formula is calibrated for),
  // never against yesterday (too noisy for a slow-moving metric).
  for (const key of Object.keys(FETCHERS)) {
    const raw = metrics.channels[key].raw;
    if (typeof raw.followers !== "number") continue;
    if (!Array.isArray(raw.followerLog)) raw.followerLog = [];
    const existingToday = raw.followerLog.find((e) => e.date === date);
    if (existingToday) existingToday.count = raw.followers;
    else raw.followerLog.push({ date, count: raw.followers });

    const targetTime = Date.now() - THIRTY_DAYS_MS;
    let best = null;
    let bestDiff = Infinity;
    for (const entry of raw.followerLog) {
      if (entry.date === date) continue;
      const diff = Math.abs(new Date(entry.date).getTime() - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = entry;
      }
    }
    if (best && bestDiff <= LOOKBACK_TOLERANCE_MS) {
      raw.followersPrevPeriod = best.count;
    } else {
      delete raw.followersPrevPeriod;
    }
  }

  metrics.meta.dataAsOf = date;
  for (const key of Object.keys(metrics.channels)) {
    metrics.channels[key].lastUpdated = date;
  }

  const result = computeAllScores(metrics);
  report.scores = { magOverall: result.magOverall };
  for (const key of Object.keys(metrics.channels)) {
    const overall = result.channels[key].overall;
    report.scores[key] = overall;
    if (typeof overall === "number") {
      const hist = metrics.channels[key].history;
      const existingToday = hist.find((h) => h.date === date);
      if (existingToday) existingToday.score = overall;
      else hist.push({ date, score: overall });
    }
  }

  writeFileSync(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("update-metrics.mjs failed:", err);
  process.exit(1);
});
