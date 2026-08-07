/**
 * MAG Social Health Score — app entry point.
 *
 * Loads data/metrics.json, scores it via scoring.js, and renders the result
 * into #app. Drives the #scan-overlay step animation declared in
 * index.html/styles.css while the data loads, then reveals the dashboard.
 */

import { computeAllScores, gradeFor } from "./scoring.js";

const DATA_URL = "./data/metrics.json";
const CHANNEL_ORDER = ["instagram", "website", "facebook", "linkedin"];
const SCAN_STEPS = [
  "Checking your profile...",
  "Looking at your posts",
  "Reading your comments",
  "Looking at your website",
  "Scoring your profile",
];
const STEP_MS = 320;

const ICONS = {
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.7"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor"/></svg>',
  website:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9Z" stroke="currentColor" stroke-width="1.5"/></svg>',
  facebook:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 21v-7h2.4l.6-3H14v-1.9c0-.9.3-1.6 1.7-1.6H17V4.8c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1V11H8v3h2.6v7h3.4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="8.3" r="1.3" fill="currentColor"/><path d="M6.8 11v6.2M11 11v6.2M11 13.6c0-1.7 1.1-2.9 2.6-2.9 1.6 0 2.6 1.1 2.6 2.9v3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  default: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/></svg>',
};

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = renderError(err);
    app.hidden = false;
  }
  const overlay = document.getElementById("scan-overlay");
  if (overlay) overlay.hidden = true;
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main() {
  const overlayEl = document.getElementById("scan-overlay");
  const skipBtn = document.getElementById("scan-skip");
  const appEl = document.getElementById("app");

  renderScanSteps();

  let skipped = false;
  skipBtn.addEventListener("click", () => { skipped = true; }, { once: true });

  const [metricsOrError] = await Promise.all([
    loadMetrics().catch((err) => ({ __error: err })),
    runScanAnimation(() => skipped),
  ]);

  if (metricsOrError && metricsOrError.__error) {
    appEl.innerHTML = renderError(metricsOrError.__error);
  } else {
    const result = computeAllScores(metricsOrError);
    appEl.innerHTML = renderDashboard(metricsOrError, result);
    animateGauges(appEl);
  }

  appEl.hidden = false;
  hideOverlay(overlayEl);
}

async function loadMetrics() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${res.status})`);
  return res.json();
}

function hideOverlay(overlayEl) {
  overlayEl.classList.add("is-hidden");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    overlayEl.hidden = true;
  };
  overlayEl.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 600);
}

// ---------------------------------------------------------------------------
// Scan overlay animation
// ---------------------------------------------------------------------------

function renderScanSteps() {
  const ol = document.getElementById("scan-steps");
  ol.innerHTML = SCAN_STEPS.map((label) => `<li><span class="dot"></span>${escapeHtml(label)}</li>`).join("");
}

async function runScanAnimation(shouldSkip) {
  const items = Array.from(document.querySelectorAll("#scan-steps li"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    items.forEach((li) => li.classList.add("is-done"));
    return;
  }
  for (const li of items) {
    if (shouldSkip()) break;
    li.classList.add("is-active");
    await sleep(STEP_MS);
    li.classList.remove("is-active");
    li.classList.add("is-done");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderDashboard(metrics, result) {
  const asOf = latestUpdated(result.channels);
  return `
    ${renderHeader(metrics, asOf)}
    ${renderHero(result)}
    <section class="channels-grid">
      ${CHANNEL_ORDER.map((key) => renderChannelCard(result.channels[key])).join("")}
    </section>
    ${renderFooter()}
  `;
}

function renderHeader(metrics, asOf) {
  const brand = metrics?.meta?.brand ?? "My Adventure Group";
  const title = metrics?.meta?.dashboardTitle ?? "Social Health Score";
  const placeholderNote = metrics?.meta?.isPlaceholderData ? " &middot; placeholder data, not live analytics" : "";
  return `
    <header class="site-header">
      <div class="brand">
        <span class="brand-mark">MAG</span>
        <span class="brand-title">${escapeHtml(title)}</span>
      </div>
      <span class="snapshot-note">${escapeHtml(brand)} &middot; snapshot as of ${formatDate(asOf)}${placeholderNote}</span>
    </header>
  `;
}

function renderHero(result) {
  const { magOverall, magGrade } = result;
  return `
    <section class="hero">
      <div class="hero-gauge-wrap">
        ${gaugeSVG({ size: 160, strokeWidth: 14, score: magOverall, grade: magGrade })}
        <span class="grade-badge ${magGrade.className}">${escapeHtml(magGrade.label)}</span>
      </div>
      <div class="hero-copy">
        <h1>MAG Social Health Score</h1>
        <p>${escapeHtml(heroSummary(result))}</p>
      </div>
    </section>
  `;
}

function heroSummary(result) {
  const entries = Object.values(result.channels).filter((c) => typeof c.overall === "number");
  if (!entries.length) return "No channel scores available yet — check data/metrics.json.";
  const sorted = [...entries].sort((a, b) => a.overall - b.overall);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  if (weakest.key === strongest.key) {
    return `${strongest.platform} is the only channel currently scored, sitting at ${strongest.overall}/100.`;
  }
  return `${strongest.platform} is carrying the average at ${strongest.overall}/100, while ${weakest.platform} (${weakest.overall}/100) is the biggest opportunity across all four channels.`;
}

function renderChannelCard(channel) {
  if (!channel) return "";
  const trend = trendFor(channel.history);
  return `
    <article class="channel-card">
      <div class="channel-card-head">
        <span class="channel-icon">${ICONS[channel.key] ?? ICONS.default}</span>
        <div class="channel-name-block">
          <div class="platform">${escapeHtml(channel.platform)}</div>
          <div class="handle">${escapeHtml(channel.handle || channel.url || "")}</div>
        </div>
      </div>
      <div class="channel-card-score">
        ${gaugeSVG({ size: 92, strokeWidth: 9, score: channel.overall, grade: channel.grade })}
        <div class="grade-stack">
          <span class="grade-badge ${channel.grade.className}">${escapeHtml(channel.grade.label)}</span>
          ${trend ? `<span class="sparkline-label">${escapeHtml(trend)}</span>` : ""}
        </div>
      </div>
      <div class="category-list">
        ${channel.categories.map(renderCategoryRow).join("")}
      </div>
      <p class="channel-summary">${escapeHtml(channel.summary)}</p>
      ${
        channel.recommendations.length
          ? `<ul class="channel-recs">${channel.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
          : ""
      }
      ${renderSparklineBlock(channel)}
      <div class="channel-footer">
        <span>Updated ${formatDate(channel.lastUpdated)}</span>
        ${
          channel.url && channel.url !== "#"
            ? `<a href="${escapeAttr(channel.url)}" target="_blank" rel="noopener">Visit channel &rarr;</a>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderCategoryRow(cat) {
  const hasScore = typeof cat.score === "number";
  const grade = gradeFor(cat.score);
  const slug = slugFromClassName(grade.className);
  return `
    <div class="category-row">
      <span class="cat-label">${escapeHtml(cat.label)}</span>
      <span class="cat-score${hasScore ? "" : " nodata-text"}">${hasScore ? cat.score : "No data"}</span>
      <div class="cat-track">
        <div class="cat-fill ${slug}" style="width:${hasScore ? cat.score : 0}%"></div>
      </div>
    </div>
  `;
}

function renderSparklineBlock(channel) {
  const points = Array.isArray(channel.history) ? channel.history.filter((h) => typeof h.score === "number") : [];
  if (points.length < 2) return "";
  const sorted = [...points].sort((a, b) => new Date(a.date) - new Date(b.date));
  const w = 140;
  const h = 36;
  const pad = 3;
  const scores = sorted.map((p) => p.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (sorted.length - 1);
  const coords = sorted
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (p.score - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const grade = gradeFor(scores[scores.length - 1]);
  const slug = slugFromClassName(grade.className);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return `
    <div class="sparkline-wrap">
      <span class="sparkline-label">${sorted.length}-point trend</span>
      <span class="sparkline">
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score history from ${first.score} to ${last.score}">
          <polyline points="${coords}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="stroke-${slug}"></polyline>
        </svg>
      </span>
    </div>
  `;
}

function renderFooter() {
  return `<footer class="site-footer">MAG Social Health Score — a static dashboard, scored entirely from data/metrics.json. No tracking, no external calls.</footer>`;
}

function renderError(err) {
  return `
    <div class="data-error" role="alert">
      <strong>Couldn't load the dashboard data.</strong>
      <p>${escapeHtml(err?.message ?? String(err))}</p>
      <p>Check that <code>data/metrics.json</code> exists and is valid JSON, and that this page is being served over http(s) — module scripts and fetch requests don't run from a <code>file://</code> URL.</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Gauge (SVG progress ring)
// ---------------------------------------------------------------------------

function gaugeSVG({ size, strokeWidth, score, grade }) {
  const hasScore = typeof score === "number";
  const band = grade ?? gradeFor(score);
  const slug = slugFromClassName(band.className);
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = hasScore ? clamp(score, 0, 100) / 100 : 0;
  const targetOffset = circumference * (1 - pct);
  const numberSize = Math.round(size * 0.3);
  const outofSize = Math.round(size * 0.11);
  const label = hasScore ? `Score ${score} out of 100, ${band.label}` : "Score not available";
  return `
    <svg class="gauge" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeAttr(label)}">
      <circle class="gauge-track" cx="${center}" cy="${center}" r="${radius}" stroke-width="${strokeWidth}"></circle>
      <circle class="gauge-value stroke-${slug}" cx="${center}" cy="${center}" r="${radius}" stroke-width="${strokeWidth}"
        stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${circumference.toFixed(2)}"
        data-target-offset="${targetOffset.toFixed(2)}"
        transform="rotate(-90 ${center} ${center})"></circle>
      <text class="gauge-number" x="${center}" y="${center - numberSize * 0.12}" text-anchor="middle" dominant-baseline="central" font-size="${numberSize}">${hasScore ? score : "—"}</text>
      <text class="gauge-outof" x="${center}" y="${center + numberSize * 0.62}" text-anchor="middle" font-size="${outofSize}">/ 100</text>
    </svg>
  `;
}

function animateGauges(root) {
  const circles = root.querySelectorAll(".gauge-value");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    circles.forEach((c) => {
      c.style.transition = "none";
      c.setAttribute("stroke-dashoffset", c.dataset.targetOffset);
    });
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      circles.forEach((c) => c.setAttribute("stroke-dashoffset", c.dataset.targetOffset));
    });
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function slugFromClassName(className) {
  return String(className).replace(/^grade-/, "");
}

function trendFor(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  if (typeof last.score !== "number" || typeof prev.score !== "number") return null;
  const delta = last.score - prev.score;
  if (delta === 0) return "No change vs last month";
  const arrow = delta > 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(delta)} pt${Math.abs(delta) === 1 ? "" : "s"} vs last month`;
}

function latestUpdated(channels) {
  const dates = Object.values(channels)
    .map((c) => c.lastUpdated)
    .filter(Boolean);
  if (!dates.length) return null;
  return dates.sort().slice(-1)[0];
}

function formatDate(dateStr) {
  if (!dateStr) return "unknown date";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}
