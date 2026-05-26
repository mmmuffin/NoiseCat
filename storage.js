const NOISECAT_STORAGE_KEY = "noiseCatSettings";
const NOISECAT_PENDING_MUTE_KEY = "noiseCatPendingMute";
const NOISECAT_LAST_RESULT_KEY = "noiseCatLastResult";
const NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY = "noiseCatPublicKeywordsCache";

const NOISECAT_DEFAULT_SETTINGS = {
  enabled: true,
  publicKeywordsEnabled: false,
  publicKeywordHideReplies: true,
  publicKeywordSourceUrl:
    "https://raw.githubusercontent.com/mmmuffin/NoiseCat/main/community-keywords/keywords.json"
};

function normalizeMutePhrase(keyword) {
  return String(keyword || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKeywordKey(keyword) {
  return normalizeMutePhrase(keyword).toLowerCase();
}

function dedupeMutePhrases(keywords) {
  const unique = new Map();

  for (const keyword of keywords || []) {
    const normalized = normalizeMutePhrase(keyword);
    const key = normalized.toLowerCase();

    if (!normalized || unique.has(key)) {
      continue;
    }

    unique.set(key, normalized);
  }

  return [...unique.values()];
}

function parseKeywordText(rawText) {
  return dedupeMutePhrases(
    String(rawText || "")
      .split(/\r?\n|,/)
      .map((item) => item.trim())
  );
}

function sanitizeSourceUrl(url) {
  return String(url || "").trim();
}

async function getNoiseCatSettings() {
  const stored = await chrome.storage.sync.get(NOISECAT_STORAGE_KEY);
  const settings = stored[NOISECAT_STORAGE_KEY] || {};

  return {
    ...NOISECAT_DEFAULT_SETTINGS,
    ...settings,
    publicKeywordSourceUrl: sanitizeSourceUrl(settings.publicKeywordSourceUrl)
  };
}

async function saveNoiseCatSettings(partialSettings) {
  const current = await getNoiseCatSettings();
  const next = {
    ...current,
    ...partialSettings
  };

  next.publicKeywordSourceUrl = sanitizeSourceUrl(next.publicKeywordSourceUrl);

  await chrome.storage.sync.set({
    [NOISECAT_STORAGE_KEY]: next
  });

  return next;
}

async function getNoiseCatPendingMute() {
  const stored = await chrome.storage.local.get(NOISECAT_PENDING_MUTE_KEY);
  const pending = stored[NOISECAT_PENDING_MUTE_KEY] || null;

  if (!pending) {
    return null;
  }

  return {
    ...pending,
    keywords: dedupeMutePhrases(pending.keywords || [])
  };
}

async function setNoiseCatPendingMute(payload) {
  const nextPayload = {
    ...payload,
    keywords: dedupeMutePhrases(payload.keywords || [])
  };

  if (!Array.isArray(nextPayload.processed)) {
    nextPayload.processed = [];
  }

  if (!nextPayload.stats) {
    nextPayload.stats = {
      added: 0,
      skipped: 0,
      failed: 0
    };
  }

  await chrome.storage.local.set({
    [NOISECAT_PENDING_MUTE_KEY]: nextPayload
  });

  return nextPayload;
}

async function clearNoiseCatPendingMute() {
  await chrome.storage.local.remove(NOISECAT_PENDING_MUTE_KEY);
}

async function getNoiseCatLastResult() {
  const stored = await chrome.storage.local.get(NOISECAT_LAST_RESULT_KEY);
  return stored[NOISECAT_LAST_RESULT_KEY] || null;
}

async function setNoiseCatLastResult(payload) {
  await chrome.storage.local.set({
    [NOISECAT_LAST_RESULT_KEY]: payload
  });

  return payload;
}

async function getNoiseCatPublicKeywordsCache() {
  const stored = await chrome.storage.local.get(NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY);
  const cache = stored[NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY] || null;

  if (!cache) {
    return null;
  }

  return {
    ...cache,
    sourceUrl: sanitizeSourceUrl(cache.sourceUrl),
    keywords: dedupeMutePhrases(cache.keywords || [])
  };
}

async function setNoiseCatPublicKeywordsCache(payload) {
  const nextPayload = {
    ...payload,
    sourceUrl: sanitizeSourceUrl(payload.sourceUrl),
    keywords: dedupeMutePhrases(payload.keywords || [])
  };

  await chrome.storage.local.set({
    [NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY]: nextPayload
  });

  return nextPayload;
}

async function clearNoiseCatPublicKeywordsCache() {
  await chrome.storage.local.remove(NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY);
}
