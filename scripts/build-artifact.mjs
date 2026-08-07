/**
 * Regenerates artifact/mag-health-report.html — a self-contained page
 * suitable for publishing as a Claude Artifact — from the real scores in
 * data/metrics.json, computed via scoring.js. Keeps artifact/template.html's
 * design (fonts, palette, dial-gauge CSS, layout) verbatim; only the
 * content between <div class="wrap"> and its closing tag is regenerated
 * here, driven entirely by computeAllScores() output so this artifact and
 * the live dashboard (js/app.js) can never show two different stories.
 *
 * Run from the repo root: `node scripts/build-artifact.mjs`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeAllScores, gradeFor } from "../js/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const METRICS_PATH = path.join(ROOT, "data", "metrics.json");
const TEMPLATE_PATH = path.join(ROOT, "artifact", "template.html");
const OUTPUT_PATH = path.join(ROOT, "artifact", "mag-health-report.html");
const FONT_DIR = path.join(ROOT, "artifact", "fonts");

const CHANNEL_ORDER = ["website", "instagram", "facebook", "linkedin"];

const ICONS = {
  instagram:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" stroke="var(--accent)" stroke-width="1.7"/><circle cx="12" cy="12" r="4.2" stroke="var(--accent)" stroke-width="1.7"/><circle cx="17.2" cy="6.8" r="1.1" fill="var(--accent)"/></svg>',
  website:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="var(--accent)" stroke-width="1.7"/><path d="M3 12h18M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9Z" stroke="var(--accent)" stroke-width="1.5"/></svg>',
  facebook:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 21v-7h2.4l.6-3H14v-1.9c0-.9.3-1.6 1.7-1.6H17V4.8c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1V11H8v3h2.6v7h3.4Z" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" stroke="var(--accent)" stroke-width="1.7"/><circle cx="8" cy="8.3" r="1.3" fill="var(--accent)"/><path d="M6.8 11v6.2M11 11v6.2M11 13.6c0-1.7 1.1-2.9 2.6-2.9 1.6 0 2.6 1.1 2.6 2.9v3.6" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function bandColorVar(grade) {
  return (
    {
      "grade-excellent": "var(--good)",
      "grade-good": "var(--good)",
      "grade-needswork": "var(--warning)",
      "grade-atrisk": "var(--critical)",
      "grade-nodata": "var(--border)",
    }[grade.className] || "var(--border)"
  );
}

function pillStyle(grade) {
  return (
    {
      "grade-excellent": { bg: "var(--good-soft)", fg: "var(--good)" },
      "grade-good": { bg: "var(--good-soft)", fg: "var(--good)" },
      "grade-needswork": { bg: "var(--warning-soft)", fg: "var(--warning)" },
      "grade-atrisk": { bg: "var(--critical-soft)", fg: "var(--critical)" },
      "grade-nodata": { bg: "var(--surface-2)", fg: "var(--text-muted)" },
    }[grade.className] || { bg: "var(--surface-2)", fg: "var(--text-muted)" }
  );
}

function dialHTML({ size, score, grade }) {
  const hasScore = typeof score === "number";
  const deg = hasScore ? ((score / 100) * 270).toFixed(1) : "0";
  const color = bandColorVar(grade);
  const bandLine = size === "lg" ? `<span class="band">${escapeHtml(grade.label)}</span>` : "";
  return `<div class="dial ${size}" style="--dial-color: ${color}; --dial-deg: ${deg}deg;">
      <div class="dial-face">
        <span class="score tabular">${hasScore ? score : "&mdash;"}</span>
        <span class="of100">${size === "lg" ? "OUT OF 100" : "/100"}</span>
        ${bandLine}
      </div>
    </div>`;
}

function coverageFor(categories) {
  const total = categories.length;
  const scored = categories.filter((c) => typeof c.score === "number").length;
  return { scored, total };
}

function coverageLine({ scored, total }) {
  return `<div style="margin-top:2px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);">${scored} of ${total} categories scored</div>`;
}

function heroSummary(result) {
  const entries = Object.values(result.channels).filter((c) => typeof c.overall === "number");
  if (!entries.length) return "No channel has enough real data to score yet — check back once the daily refresh has gathered more.";
  const sorted = [...entries].sort((a, b) => a.overall - b.overall);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  if (weakest.key === strongest.key) {
    return `${strongest.platform} is the only channel with a real score right now, sitting at ${strongest.overall}/100. The rest need more public signal or a manual data drop before they can be scored.`;
  }
  return `${strongest.platform} is carrying the average at ${strongest.overall}/100, while ${weakest.platform} (${weakest.overall}/100) is the biggest opportunity. Scores reflect only what's currently measurable — see the coverage count on each dial.`;
}

function statsFor(key, raw) {
  const rows = [];
  if (typeof raw.followers === "number") {
    const label = key === "facebook" ? "Page likes" : "Followers";
    rows.push([label, raw.followers.toLocaleString("en-US")]);
  }
  if (key === "website") {
    if (raw.lastContentUpdateDate) rows.push(["Blog updated", raw.lastContentUpdateDate]);
    if (typeof raw.bookingPathClicks === "number") rows.push(["Clicks to book", String(raw.bookingPathClicks)]);
  }
  if (key === "linkedin" && raw.industrySet) rows.push(["Industry", "Events Services"]);
  if (!rows.length) rows.push(["Data", "None public yet"]);
  return rows;
}

function statRows(rows) {
  return rows.map(([k, v]) => `<div class="stat-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`).join("\n");
}

function categoryRows(categories) {
  return categories
    .map((c) => {
      const has = typeof c.score === "number";
      const width = has ? c.score : 0;
      const opacity = has ? "" : " opacity:.3;";
      return `<div class="subscore-row"><span class="label">${escapeHtml(c.label)}</span><span class="value">${has ? c.score : "No data"}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%;${opacity}"></div></div></div>`;
    })
    .join("\n");
}

function recsList(recommendations) {
  if (!recommendations.length) return "";
  const items = recommendations
    .slice(0, 2)
    .map((r) => `<li>${escapeHtml(r)}</li>`)
    .join("\n");
  return `<ul style="margin:8px 0 0; padding-left:18px; font-size:13.5px; color:var(--text-secondary); display:flex; flex-direction:column; gap:4px;">${items}</ul>`;
}

function channelCard(channel) {
  const pill = pillStyle(channel.grade);
  return `      <article class="card">
        <div class="card-top">
          <div class="card-id">
            <span class="badge">${ICONS[channel.key] || ""}</span>
            <span class="names">
              <span class="platform">${escapeHtml(channel.platform)}</span>
              <span class="handle"><a href="${escapeHtml(channel.url)}" target="_blank" rel="noopener">${escapeHtml(channel.handle)}</a></span>
            </span>
          </div>
          <span class="pill" style="background:${pill.bg}; color:${pill.fg}">${escapeHtml(channel.grade.label)}</span>
        </div>
        <div class="card-body">
          ${dialHTML({ size: "sm", score: channel.overall, grade: channel.grade })}
          <div class="stat-list">
${statRows(statsFor(channel.key, channel.raw || {}))}
          </div>
        </div>
        <div class="subscores">
${categoryRows(channel.categories)}
        </div>
        <p class="takeaway">${escapeHtml(channel.summary)}${coverageLine(coverageFor(channel.categories))}</p>
        ${recsList(channel.recommendations)}
      </article>`;
}

function heroChip(channel) {
  const color = bandColorVar(channel.grade);
  const val = typeof channel.overall === "number" ? channel.overall : "—";
  return `<span class="chip"><span class="swatch" style="background:${color}"></span>${escapeHtml(channel.platform)} <span class="val">${val}</span></span>`;
}

function buildRoutes(result) {
  const items = [];
  for (const key of CHANNEL_ORDER) {
    const ch = result.channels[key];
    if (!ch.recommendations.length) continue;
    const critical = ch.grade.className === "grade-atrisk" || ch.grade.className === "grade-nodata";
    const warn = ch.grade.className === "grade-needswork";
    const priorityWord = critical ? "Highest leverage" : warn ? "Worth a look" : "Keep building";
    const priorityColor = critical ? "var(--critical)" : warn ? "var(--warning)" : "var(--good)";
    items.push(
      `      <li><span class="priority" style="color:${priorityColor}">${priorityWord}</span>${escapeHtml(ch.recommendations[0])}</li>`
    );
  }
  if (!items.length) {
    items.push(`      <li><span class="priority" style="color:var(--critical)">Highest leverage</span>Every channel needs more real public signal before a route can be recommended — see the methodology note below.</li>`);
  }
  return items.join("\n");
}

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

function main() {
  const metrics = JSON.parse(readFileSync(METRICS_PATH, "utf8"));
  const result = computeAllScores(metrics);
  for (const key of Object.keys(result.channels)) {
    result.channels[key].key = key;
    result.channels[key].raw = metrics.channels[key]?.raw ?? {};
  }

  const asOf = metrics.meta.dataAsOf || Object.values(metrics.channels)[0]?.lastUpdated || "unknown date";
  const asOfHuman = formatDate(asOf);
  const cov = Object.values(result.channels).reduce(
    (acc, ch) => {
      const c = coverageFor(ch.categories);
      return { scored: acc.scored + c.scored, total: acc.total + c.total };
    },
    { scored: 0, total: 0 }
  );

  let template = readFileSync(TEMPLATE_PATH, "utf8");
  const bsd = readFileSync(path.join(FONT_DIR, "bsd.woff2")).toString("base64");
  const worksans = readFileSync(path.join(FONT_DIR, "worksans.woff2")).toString("base64");
  template = template.replace("__BSD_FONT_BASE64__", bsd).replace("__WORKSANS_FONT_BASE64__", worksans);

  const prefixEnd = template.indexOf('<div class="wrap">') + '<div class="wrap">'.length;
  const suffixStart = template.lastIndexOf("</div>");
  const prefix = template.slice(0, prefixEnd);
  const suffix = template.slice(suffixStart);

  const magGrade = result.magGrade;
  const body = `

  <header class="top">
    <div class="brandline">
      <svg class="compass" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="17" stroke="var(--accent)" stroke-width="2"/>
        <path d="M20 9 L24 20 L20 31 L16 20 Z" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="20" cy="20" r="2" fill="var(--accent)"/>
      </svg>
      <span class="eyebrow">Field Audit &middot; Social &amp; Web Health &middot; Auto-refreshed daily</span>
    </div>
    <h1 class="title">My Adventure Group's channels, scored the way a stranger actually finds them</h1>
    <p class="subtitle">Four public-facing camps &mdash; Instagram, Facebook, LinkedIn and the website &mdash; scanned for what any prospect, journalist or event-booker sees without logging in. Regenerated daily from the same real, sourced data and scoring engine as the live dashboard — no private analytics, no API keys.</p>
    <div class="meta-row">
      <span>Subject: <strong style="color:var(--text-secondary)">myadventuregroup.com.au</strong></span>
      <span class="dot"></span>
      <span>${cov.scored} of ${cov.total} categories scored</span>
      <span class="dot"></span>
      <span>Captured ${escapeHtml(asOfHuman)}</span>
      <span class="dot"></span>
      <span>Public data only &mdash; see methodology</span>
    </div>
  </header>

  <section class="hero" aria-label="Overall health score">
    ${dialHTML({ size: "lg", score: result.magOverall, grade: magGrade })}
    <div class="hero-verdict">
      <span class="eyebrow band-word" style="color:${bandColorVar(magGrade)}">Composite verdict</span>
      <h2>${escapeHtml(magGrade.label)} on paper, ${cov.scored} of ${cov.total} categories actually measured.</h2>
      <p>${escapeHtml(heroSummary(result))}</p>
      <div class="chip-row">
        ${CHANNEL_ORDER.map((k) => heroChip(result.channels[k])).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Channel by channel</h2>
      <span class="hint">Each category comes straight from the live scoring engine — a blank bar means no real data yet, not a bad score.</span>
    </div>

    <div class="grid">
${CHANNEL_ORDER.map((k) => channelCard(result.channels[k])).join("\n\n")}
    </div>
  </section>

  <hr class="trail-rule" />

  <section class="section">
    <div class="section-head">
      <h2>Route notes</h2>
      <span class="hint">One real, data-backed recommendation per channel, in priority order.</span>
    </div>
    <ol class="routes">
${buildRoutes(result)}
    </ol>
  </section>

  <section class="section">
    <div class="method">
      <h3>How this was scored</h3>
      <p>This page is regenerated automatically once a day from <strong style="color:var(--text-primary)">data/metrics.json</strong> in the project's GitHub repo, using the exact same scoring engine as the live dashboard. As of <strong style="color:var(--text-primary)">${escapeHtml(asOfHuman)}</strong>, only Instagram/Facebook/LinkedIn follower counts are re-checked daily (the numbers that actually move day to day); website structure and any category needing private platform analytics stay as last recorded until manually updated.</p>
      <p>A blank category bar means "no real data available," never a guessed zero — categories needing Instagram/Facebook/LinkedIn Insights, review ratings, or a paid Lighthouse run are left out entirely rather than estimated.</p>
      <p>Follower counts fluctuate and different sources can disagree by small margins — treat single-day moves as noise, not signal.</p>
    </div>
  </section>

  <footer class="foot">Field audit auto-refreshed ${escapeHtml(asOfHuman)} &middot; for My Adventure Group &middot; myadventuregroup.com.au</footer>

`;

  const html = prefix + body + suffix;
  writeFileSync(OUTPUT_PATH, html);
  console.log(`Wrote ${OUTPUT_PATH} (${html.length} bytes), magOverall=${result.magOverall}, coverage=${cov.scored}/${cov.total}`);
}

main();
