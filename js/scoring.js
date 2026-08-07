/**
 * MAG Social Health Score — scoring engine.
 *
 * Pure functions only: given raw metrics.json input, compute category
 * sub-scores (0-100), roll them into a per-channel overall score (0-100),
 * and roll the four channel overalls into one MAG Overall Score.
 *
 * Every weight and benchmark used below is a named, exported constant so
 * the whole model can be re-tuned without touching the formulas.
 */

// ---------------------------------------------------------------------------
// Tunable weights — how much each channel/category counts toward its parent
// score. Each weight group should sum to 1 (100%).
// ---------------------------------------------------------------------------

export const CHANNEL_WEIGHTS = {
  instagram: 0.25,
  website: 0.25,
  facebook: 0.25,
  linkedin: 0.25,
};

export const INSTAGRAM_WEIGHTS = {
  profileCompleteness: 0.15,
  contentQuality: 0.25,
  engagement: 0.30,
  growth: 0.15,
  discoverability: 0.15,
};

export const WEBSITE_WEIGHTS = {
  performance: 0.20,
  seoBasics: 0.20,
  contentFreshness: 0.15,
  conversionClarity: 0.25,
  trustSignals: 0.20,
};

export const FACEBOOK_WEIGHTS = {
  pageCompleteness: 0.20,
  postingConsistency: 0.20,
  engagementRate: 0.30,
  reviewRating: 0.15,
  responseRate: 0.15,
};

export const LINKEDIN_WEIGHTS = {
  pageCompleteness: 0.20,
  postingConsistency: 0.15,
  engagementRate: 0.30,
  followerGrowth: 0.15,
  contentRelevance: 0.20,
};

// ---------------------------------------------------------------------------
// Benchmarks — the "what counts as good" thresholds the raw numbers are
// measured against. These are the knobs to turn as MAG's real baselines
// become clearer over time.
// ---------------------------------------------------------------------------

export const BENCHMARKS = {
  instagram: {
    postsPerMonthTarget: 12,      // 12 posts/month (~3/week) = full posting-frequency score
    videoMixTarget: 0.5,          // 50% of posts as video = full video-mix score
    engagementRatePctTarget: 6,   // (likes+comments)/followers = 6% -> full engagement score
    hashtagsPerPostTarget: 15,    // 15 hashtags/post -> full discoverability-count score
  },
  facebook: {
    postsPerMonthTarget: 8,
    engagementRatePctTarget: 1,   // FB engagement rates run much lower than IG
  },
  linkedin: {
    postsPerMonthTarget: 8,
    engagementRatePctTarget: 2,
  },
  website: {
    freshnessFullScoreDays: 30,   // updated within 30 days -> full freshness score
    freshnessZeroScoreDays: 180,  // untouched for 180+ days -> zero freshness score
  },
};

// Each 1 percentage point of follower growth over the tracked period moves
// the growth score 10 points away from a neutral (0% growth) baseline of 50.
export const GROWTH_SCORE_PER_PERCENT = 10;

// ---------------------------------------------------------------------------
// Grade bands — consistent across every channel and the MAG overall score.
// ---------------------------------------------------------------------------

export const GRADE_BANDS = [
  { min: 90, label: "Excellent", className: "grade-excellent" },
  { min: 75, label: "Good", className: "grade-good" },
  { min: 50, label: "Needs Work", className: "grade-needswork" },
  { min: 0, label: "At Risk", className: "grade-atrisk" },
];

export function gradeFor(score) {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return { min: 0, label: "No Data", className: "grade-nodata" };
  }
  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band;
  }
  return GRADE_BANDS[GRADE_BANDS.length - 1];
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function isNum(n) {
  return typeof n === "number" && !Number.isNaN(n);
}

/**
 * Weighted average that skips null/undefined scores and renormalizes the
 * remaining weights, so a channel with one inapplicable category (e.g.
 * Facebook reviews disabled) doesn't get unfairly punished or need a fake
 * number plugged in.
 */
function weightedAverage(entries) {
  const valid = entries.filter((e) => isNum(e.score) && isNum(e.weight) && e.weight > 0);
  const totalWeight = valid.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight === 0) return null;
  const sum = valid.reduce((s, e) => s + e.score * e.weight, 0);
  return sum / totalWeight;
}

function round(n) {
  return n === null || n === undefined ? null : Math.round(n);
}

/** Percentage of true values among the *applicable* (non-null) booleans. */
function completenessScore(fields) {
  const applicable = fields.filter((f) => f !== null && f !== undefined);
  if (!applicable.length) return null;
  const trueCount = applicable.filter(Boolean).length;
  return round((trueCount / applicable.length) * 100);
}

/** Linear scale of a raw value against a "full score" target, clamped 0-100. */
function rateScore(rawValue, target) {
  if (!isNum(rawValue) || !isNum(target) || target <= 0) return null;
  return round(clamp((rawValue / target) * 100, 0, 100));
}

/** Score for a percentage-change-over-time metric (follower growth etc). */
function growthScore(current, previous) {
  if (!isNum(current) || !isNum(previous) || previous <= 0) return null;
  const pctChange = ((current - previous) / previous) * 100;
  return round(clamp(50 + pctChange * GROWTH_SCORE_PER_PERCENT, 0, 100));
}

/** Content-freshness score based on days since last update. */
function freshnessScore(lastUpdateDateStr, now = new Date()) {
  if (!lastUpdateDateStr) return null;
  const last = new Date(lastUpdateDateStr);
  if (Number.isNaN(last.getTime())) return null;
  const days = Math.max(0, Math.round((now - last) / (1000 * 60 * 60 * 24)));
  const { freshnessFullScoreDays, freshnessZeroScoreDays } = BENCHMARKS.website;
  if (days <= freshnessFullScoreDays) return 100;
  if (days >= freshnessZeroScoreDays) return 0;
  const span = freshnessZeroScoreDays - freshnessFullScoreDays;
  return round(clamp(100 - ((days - freshnessFullScoreDays) / span) * 100, 0, 100));
}

/** Fewer clicks to book/contact is better: 1 click = 100, -25 per extra click. */
function bookingPathScore(clicks) {
  if (!isNum(clicks)) return null;
  return round(clamp(100 - (clicks - 1) * 25, 0, 100));
}

function computeOverall(categories, weights) {
  const entries = categories.map((c) => ({ score: c.score, weight: weights[c.key] ?? 0 }));
  return round(weightedAverage(entries));
}

// ---------------------------------------------------------------------------
// Human-readable category labels, used by both the renderer and the
// recommendation copy below.
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS = {
  instagram: {
    profileCompleteness: "Profile Completeness",
    contentQuality: "Content Quality & Consistency",
    engagement: "Engagement",
    growth: "Growth",
    discoverability: "Hashtag & Discoverability",
  },
  website: {
    performance: "Performance",
    seoBasics: "SEO Basics",
    contentFreshness: "Content Freshness",
    conversionClarity: "Conversion Clarity",
    trustSignals: "Trust Signals",
  },
  facebook: {
    pageCompleteness: "Page Completeness",
    postingConsistency: "Posting Consistency",
    engagementRate: "Engagement Rate",
    reviewRating: "Review Rating",
    responseRate: "Response Rate",
  },
  linkedin: {
    pageCompleteness: "Company Page Completeness",
    postingConsistency: "Posting Consistency",
    engagementRate: "Engagement Rate",
    followerGrowth: "Follower Growth",
    contentRelevance: "Content Relevance Mix",
  },
};

// ---------------------------------------------------------------------------
// Per-channel scorers. `raw` is read defensively — every field is optional,
// missing fields simply drop out of their category's weighted average (see
// weightedAverage above) rather than breaking the page.
// ---------------------------------------------------------------------------

function scoreInstagram(raw = {}) {
  const profileCompleteness = completenessScore([
    raw.bioFilled,
    raw.linkInBio,
    raw.profilePicSet,
    raw.categorySet,
  ]);

  const postingFrequency = rateScore(raw.postsLast30Days, BENCHMARKS.instagram.postsPerMonthTarget);
  const videoRatio =
    isNum(raw.postsLast30Days) && raw.postsLast30Days > 0 && isNum(raw.videoPostsLast30Days)
      ? raw.videoPostsLast30Days / raw.postsLast30Days
      : null;
  const videoMix = rateScore(videoRatio, BENCHMARKS.instagram.videoMixTarget);
  const visualConsistency = isNum(raw.visualConsistencyScore) ? raw.visualConsistencyScore : null;
  const contentQuality = round(
    weightedAverage([
      { score: postingFrequency, weight: 0.4 },
      { score: videoMix, weight: 0.3 },
      { score: visualConsistency, weight: 0.3 },
    ])
  );

  const engagementRatePct =
    isNum(raw.followers) && raw.followers > 0
      ? (((raw.avgLikesPerPost ?? 0) + (raw.avgCommentsPerPost ?? 0)) / raw.followers) * 100
      : null;
  const engagementRateScore = rateScore(engagementRatePct, BENCHMARKS.instagram.engagementRatePctTarget);
  const commentReplyRate = isNum(raw.commentReplyRatePct) ? raw.commentReplyRatePct : null;
  const engagement = round(
    weightedAverage([
      { score: engagementRateScore, weight: 0.7 },
      { score: commentReplyRate, weight: 0.3 },
    ])
  );

  const growth = growthScore(raw.followers, raw.followersPrevPeriod);

  const hashtagCountScore = rateScore(raw.hashtagsAvgPerPost, BENCHMARKS.instagram.hashtagsPerPostTarget);
  const hashtagStrategy = isNum(raw.hashtagStrategyScore) ? raw.hashtagStrategyScore : null;
  const discoverability = round(
    weightedAverage([
      { score: hashtagCountScore, weight: 0.4 },
      { score: hashtagStrategy, weight: 0.6 },
    ])
  );

  const categories = [
    { key: "profileCompleteness", label: CATEGORY_LABELS.instagram.profileCompleteness, score: profileCompleteness },
    { key: "contentQuality", label: CATEGORY_LABELS.instagram.contentQuality, score: contentQuality },
    { key: "engagement", label: CATEGORY_LABELS.instagram.engagement, score: engagement },
    { key: "growth", label: CATEGORY_LABELS.instagram.growth, score: growth },
    { key: "discoverability", label: CATEGORY_LABELS.instagram.discoverability, score: discoverability },
  ];

  return { categories, overall: computeOverall(categories, INSTAGRAM_WEIGHTS) };
}

function scoreWebsite(raw = {}) {
  const performance = isNum(raw.performanceScore) ? raw.performanceScore : null;

  const mobileFriendlyScore = raw.mobileFriendly === null || raw.mobileFriendly === undefined
    ? null
    : raw.mobileFriendly ? 100 : 0;
  const seoBasics = round(
    weightedAverage([
      { score: isNum(raw.titleTagsPresentPct) ? raw.titleTagsPresentPct : null, weight: 0.35 },
      { score: isNum(raw.altTextCoveragePct) ? raw.altTextCoveragePct : null, weight: 0.35 },
      { score: mobileFriendlyScore, weight: 0.3 },
    ])
  );

  const contentFreshness = freshnessScore(raw.lastContentUpdateDate);

  const conversionClarity = round(
    weightedAverage([
      { score: isNum(raw.ctaClarityScore) ? raw.ctaClarityScore : null, weight: 0.6 },
      { score: bookingPathScore(raw.bookingPathClicks), weight: 0.4 },
    ])
  );

  const trustSignals = completenessScore([raw.testimonialsVisible, raw.mediaLogosVisible, raw.caseStudiesVisible]);

  const categories = [
    { key: "performance", label: CATEGORY_LABELS.website.performance, score: performance },
    { key: "seoBasics", label: CATEGORY_LABELS.website.seoBasics, score: seoBasics },
    { key: "contentFreshness", label: CATEGORY_LABELS.website.contentFreshness, score: contentFreshness },
    { key: "conversionClarity", label: CATEGORY_LABELS.website.conversionClarity, score: conversionClarity },
    { key: "trustSignals", label: CATEGORY_LABELS.website.trustSignals, score: trustSignals },
  ];

  return { categories, overall: computeOverall(categories, WEBSITE_WEIGHTS) };
}

function scoreFacebook(raw = {}) {
  const pageCompleteness = completenessScore([raw.aboutFilled, raw.contactInfoFilled, raw.hoursSetIfRelevant]);

  const postingConsistency = rateScore(raw.postsLast30Days, BENCHMARKS.facebook.postsPerMonthTarget);

  const engagementRatePct =
    isNum(raw.followers) && raw.followers > 0
      ? (((raw.avgReactionsPerPost ?? 0) + (raw.avgCommentsPerPost ?? 0) + (raw.avgSharesPerPost ?? 0)) / raw.followers) * 100
      : null;
  const engagementRate = rateScore(engagementRatePct, BENCHMARKS.facebook.engagementRatePctTarget);

  const reviewRating =
    raw.reviewsEnabled && isNum(raw.ratingOutOf5) ? round(clamp((raw.ratingOutOf5 / 5) * 100, 0, 100)) : null;

  const responseRate = isNum(raw.responseRatePct) ? raw.responseRatePct : null;

  const categories = [
    { key: "pageCompleteness", label: CATEGORY_LABELS.facebook.pageCompleteness, score: pageCompleteness },
    { key: "postingConsistency", label: CATEGORY_LABELS.facebook.postingConsistency, score: postingConsistency },
    { key: "engagementRate", label: CATEGORY_LABELS.facebook.engagementRate, score: engagementRate },
    { key: "reviewRating", label: CATEGORY_LABELS.facebook.reviewRating, score: reviewRating },
    { key: "responseRate", label: CATEGORY_LABELS.facebook.responseRate, score: responseRate },
  ];

  return { categories, overall: computeOverall(categories, FACEBOOK_WEIGHTS) };
}

function scoreLinkedin(raw = {}) {
  const pageCompleteness = completenessScore([raw.aboutFilled, raw.industrySet, raw.bannerLogoSet]);

  const postingConsistency = rateScore(raw.postsLast30Days, BENCHMARKS.linkedin.postsPerMonthTarget);

  const engagementRatePct =
    isNum(raw.followers) && raw.followers > 0
      ? (((raw.avgReactionsPerPost ?? 0) + (raw.avgCommentsPerPost ?? 0)) / raw.followers) * 100
      : null;
  const engagementRate = rateScore(engagementRatePct, BENCHMARKS.linkedin.engagementRatePctTarget);

  const followerGrowth = growthScore(raw.followers, raw.followersPrevPeriod);

  const contentRelevance = isNum(raw.contentRelevanceScore) ? raw.contentRelevanceScore : null;

  const categories = [
    { key: "pageCompleteness", label: CATEGORY_LABELS.linkedin.pageCompleteness, score: pageCompleteness },
    { key: "postingConsistency", label: CATEGORY_LABELS.linkedin.postingConsistency, score: postingConsistency },
    { key: "engagementRate", label: CATEGORY_LABELS.linkedin.engagementRate, score: engagementRate },
    { key: "followerGrowth", label: CATEGORY_LABELS.linkedin.followerGrowth, score: followerGrowth },
    { key: "contentRelevance", label: CATEGORY_LABELS.linkedin.contentRelevance, score: contentRelevance },
  ];

  return { categories, overall: computeOverall(categories, LINKEDIN_WEIGHTS) };
}

const CHANNEL_SCORERS = {
  instagram: scoreInstagram,
  website: scoreWebsite,
  facebook: scoreFacebook,
  linkedin: scoreLinkedin,
};

// ---------------------------------------------------------------------------
// Recommendation copy — one template per category per channel. The two
// lowest-scoring applicable categories on a channel each contribute one
// recommendation line; templates read from `raw` so the copy cites real
// numbers instead of staying generic.
// ---------------------------------------------------------------------------

const RECOMMENDATIONS = {
  instagram: {
    profileCompleteness: (raw) =>
      `Finish filling out the profile basics — bio, link in bio, profile photo, and category — so new visitors immediately know who @${raw.handleShort ?? "myadventuregroup"} is.`,
    contentQuality: (raw) =>
      `Post more consistently (currently ${raw.postsLast30Days ?? "few"} posts in the last 30 days) and lean further into video to lift reach.`,
    engagement: (raw) =>
      `Reply to more comments (currently ${raw.commentReplyRatePct ?? "a low share"}% reply rate) — fast replies are one of the cheapest ways to lift engagement.`,
    growth: () => `Follower growth is flat or slipping — test a short collab/UGC push or paid boost to reignite growth.`,
    discoverability: () =>
      `Use a fuller, more deliberate hashtag set per post to improve discoverability in Explore and search.`,
  },
  website: {
    performance: () => `Page speed is dragging — compress hero images/video and defer non-critical scripts.`,
    seoBasics: () => `Tighten up title tags, meta descriptions, and image alt text across key pages.`,
    contentFreshness: (raw) =>
      `The site hasn't been updated since ${raw.lastContentUpdateDate ?? "a while ago"} — a recent blog/news post signals an active, in-demand speaker.`,
    conversionClarity: () =>
      `Shorten the path to booking/contact and make the primary CTA (e.g. "Check Availability") impossible to miss above the fold.`,
    trustSignals: () =>
      `Surface more social proof — client logos, testimonials, or case studies — near the top of key pages.`,
  },
  facebook: {
    pageCompleteness: () => `Fill in the About section and contact details so the Page reads as complete and trustworthy.`,
    postingConsistency: (raw) =>
      `Posting cadence is light (${raw.postsLast30Days ?? "few"} posts in 30 days) — a steady weekly rhythm keeps the Page in followers' feeds.`,
    engagementRate: () => `Encourage shares and comments with more discussion-style posts rather than one-way announcements.`,
    reviewRating: () => `Actively request reviews from recent clients/attendees to build up a stronger public rating.`,
    responseRate: () => `Faster replies to Page messages will lift the visible response-rate badge and build trust.`,
  },
  linkedin: {
    pageCompleteness: () => `Complete the company page — banner, logo, industry, and About copy — for a more credible first impression.`,
    postingConsistency: (raw) =>
      `Post more often (currently ${raw.postsLast30Days ?? "few"} posts in 30 days) — LinkedIn rewards consistency more than volume.`,
    engagementRate: () => `Shift toward posts that invite discussion (questions, polls, takes) rather than pure announcements.`,
    followerGrowth: () => `Follower growth has stalled — employee advocacy (shares/reposts from the team) is the fastest lever here.`,
    contentRelevance: () => `Rebalance the content mix toward more thought-leadership and fewer purely promotional posts.`,
  },
};

/**
 * Builds the auto-generated "what's strong / what needs work" summary and
 * 2-3 recommendation bullets for a channel, driven entirely by its lowest
 * and highest-scoring applicable categories.
 */
function buildInsights(channelKey, channelLabel, categories, raw) {
  const applicable = categories.filter((c) => isNum(c.score));
  if (!applicable.length) {
    return {
      summary: `No scored data yet for ${channelLabel} — fill in data/metrics.json to see a summary here.`,
      recommendations: [`Add raw metrics for ${channelLabel} to data/metrics.json.`],
    };
  }

  const sorted = [...applicable].sort((a, b) => a.score - b.score);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];

  const summary =
    weakest.key === strongest.key
      ? `${channelLabel}'s ${strongest.label.toLowerCase()} sits at ${strongest.score}/100 — the one category currently scored.`
      : `${strongest.label} is the standout at ${strongest.score}/100, while ${weakest.label} (${weakest.score}/100) is the biggest opportunity right now.`;

  const lowestTwo = sorted.slice(0, 2);
  const templates = RECOMMENDATIONS[channelKey] ?? {};
  const recommendations = lowestTwo
    .map((cat) => templates[cat.key]?.(raw))
    .filter(Boolean);

  // Guarantee at least 2 concrete lines even if a template is missing.
  if (recommendations.length < 2 && sorted.length > 2) {
    const extra = templates[sorted[2].key]?.(raw);
    if (extra) recommendations.push(extra);
  }

  return { summary, recommendations: recommendations.slice(0, 3) };
}

/**
 * Scores every channel present in metrics.json and rolls them into the MAG
 * Overall Social Health Score. Returns a fully-formed view model ready to
 * hand to the renderer — missing/malformed channel data degrades to
 * null scores rather than throwing.
 */
export function computeAllScores(metrics) {
  const channelsRaw = metrics?.channels ?? {};
  const channels = {};

  for (const key of Object.keys(CHANNEL_SCORERS)) {
    const channelData = channelsRaw[key] ?? {};
    const { categories, overall } = CHANNEL_SCORERS[key](channelData.raw ?? {});
    const grade = gradeFor(overall);
    const insights = buildInsights(key, channelData.platform ?? key, categories, channelData.raw ?? {});

    channels[key] = {
      key,
      platform: channelData.platform ?? key,
      handle: channelData.handle ?? "",
      url: channelData.url ?? "#",
      lastUpdated: channelData.lastUpdated ?? null,
      history: Array.isArray(channelData.history) ? channelData.history : [],
      categories,
      overall,
      grade,
      summary: insights.summary,
      recommendations: insights.recommendations,
    };
  }

  const magOverall = round(
    weightedAverage(
      Object.keys(CHANNEL_WEIGHTS).map((key) => ({
        score: channels[key]?.overall ?? null,
        weight: CHANNEL_WEIGHTS[key],
      }))
    )
  );

  return {
    magOverall,
    magGrade: gradeFor(magOverall),
    channels,
  };
}
