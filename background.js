importScripts("storage.js");

const NOISECAT_ADD_MUTED_URL = "https://x.com/settings/add_muted_keyword";
const NOISECAT_MUTED_LIST_URL = "https://x.com/settings/muted_keywords";
const NOISECAT_PUBLIC_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

async function focusNoiseCatTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });

  if (windowId) {
    await chrome.windows.update(windowId, { focused: true });
  }
}

async function findNoiseCatTargetTab() {
  const addTabs = await chrome.tabs.query({
    url: ["https://x.com/settings/add_muted_keyword*"]
  });

  if (addTabs.length > 0) {
    return addTabs[0];
  }

  const mutedTabs = await chrome.tabs.query({
    url: ["https://x.com/settings/muted_keywords*"]
  });

  if (mutedTabs.length > 0) {
    return chrome.tabs.update(mutedTabs[0].id, {
      url: NOISECAT_ADD_MUTED_URL,
      active: true
    });
  }

  return chrome.tabs.create({
    url: NOISECAT_ADD_MUTED_URL,
    active: true
  });
}

async function showNoiseCatFeedback(tabId, message, variant = "default") {
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "noisecat-show-toast",
      message,
      variant
    });
  } catch (error) {
    // Ignore tabs where the content script is not available.
  }
}

async function syncNoiseCatBadge(tabId, active) {
  if (!tabId) {
    return;
  }

  await chrome.action.setBadgeBackgroundColor({
    color: "#d86d41",
    tabId
  });
  await chrome.action.setBadgeText({
    tabId,
    text: active ? "ON" : ""
  });
}

async function handleNoiseCatActionClick(tab) {
  if (!tab.id || !tab.url || !/^https:\/\/(x|twitter)\.com\//.test(tab.url)) {
    return;
  }

  const settings = await getNoiseCatSettings();

  if (!settings.enabled) {
    await syncNoiseCatBadge(tab.id, false);
    await showNoiseCatFeedback(tab.id, "插件当前已停用", "error");
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "noisecat-toggle-selection-mode"
    });

    await syncNoiseCatBadge(tab.id, Boolean(response?.active));
  } catch (error) {
    await syncNoiseCatBadge(tab.id, false);
  }
}

function parsePublicKeywordPayload(text) {
  const rawText = String(text || "").trim();

  if (!rawText) {
    return {
      keywords: [],
      meta: {}
    };
  }

  try {
    const parsed = JSON.parse(rawText);

    if (Array.isArray(parsed)) {
      return {
        keywords: dedupeMutePhrases(parsed),
        meta: {}
      };
    }

    if (parsed && Array.isArray(parsed.keywords)) {
      return {
        keywords: dedupeMutePhrases(parsed.keywords),
        meta: {
          updatedAt: parsed.updatedAt || "",
          version: parsed.version || "",
          description: parsed.description || ""
        }
      };
    }
  } catch (error) {
    // Fall through to plain text parsing.
  }

  return {
    keywords: parseKeywordText(rawText),
    meta: {}
  };
}

async function fetchNoiseCatPublicKeywords(sourceUrl) {
  const response = await fetch(sourceUrl, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`公共词库拉取失败：HTTP ${response.status}`);
  }

  const bodyText = await response.text();
  const parsed = parsePublicKeywordPayload(bodyText);

  return setNoiseCatPublicKeywordsCache({
    sourceUrl,
    fetchedAt: Date.now(),
    keywords: parsed.keywords,
    meta: parsed.meta
  });
}

async function resolveNoiseCatPublicKeywords(options = {}) {
  const settings = await getNoiseCatSettings();

  if (!options.ignoreEnabled && !settings.publicKeywordsEnabled) {
    return {
      ok: true,
      sourceUrl: settings.publicKeywordSourceUrl,
      keywords: [],
      cache: null,
      disabled: true
    };
  }

  if (!settings.publicKeywordSourceUrl) {
    return {
      ok: false,
      message: "请先配置公共词库的 raw GitHub URL"
    };
  }

  const cache = await getNoiseCatPublicKeywordsCache();
  const isCacheFresh =
    cache &&
    cache.sourceUrl === settings.publicKeywordSourceUrl &&
    Date.now() - Number(cache.fetchedAt || 0) < NOISECAT_PUBLIC_CACHE_MAX_AGE_MS;

  if (!options.forceRefresh && isCacheFresh) {
    return {
      ok: true,
      sourceUrl: settings.publicKeywordSourceUrl,
      keywords: cache.keywords,
      cache
    };
  }

  const nextCache = await fetchNoiseCatPublicKeywords(settings.publicKeywordSourceUrl);

  return {
    ok: true,
    sourceUrl: settings.publicKeywordSourceUrl,
    keywords: nextCache.keywords,
    cache: nextCache
  };
}

async function queueNoiseCatMuteKeywords(keywords, sender, sourceLabel) {
  const normalizedKeywords = dedupeMutePhrases(keywords);

  if (normalizedKeywords.length === 0) {
    return {
      ok: false,
      message: "没有可写入 X 的屏蔽词"
    };
  }

  await setNoiseCatPendingMute({
    mode: normalizedKeywords.length === 1 ? "single" : "bulk",
    sourceLabel,
    keywords: normalizedKeywords,
    currentIndex: 0,
    createdAt: Date.now(),
    sourceUrl: sender?.tab?.url || "",
    sourceTabId: sender?.tab?.id || null,
    processed: [],
    stats: {
      added: 0,
      skipped: 0,
      failed: 0
    }
  });

  const targetTab = await findNoiseCatTargetTab();

  if (targetTab?.id) {
    await focusNoiseCatTab(targetTab.id, targetTab.windowId);
  }

  return {
    ok: true,
    count: normalizedKeywords.length
  };
}

async function handleNoiseCatAddKeyword(message, sender) {
  const keyword = normalizeMutePhrase(message.keyword);

  if (!keyword) {
    return {
      ok: false,
      message: "没有可添加的文本"
    };
  }

  const queued = await queueNoiseCatMuteKeywords([keyword], sender, "手动划词");

  if (!queued.ok) {
    return queued;
  }

  await showNoiseCatFeedback(sender.tab?.id, `已发送到 X：${keyword}`);

  return {
    ok: true,
    keyword
  };
}

async function handleNoiseCatRefreshPublicKeywords() {
  const resolved = await resolveNoiseCatPublicKeywords({
    forceRefresh: true,
    ignoreEnabled: true
  });

  if (!resolved.ok) {
    return resolved;
  }

  await setNoiseCatLastResult({
    status: "success",
    message: `公共词库已刷新，共 ${resolved.keywords.length} 个词`,
    at: Date.now()
  });

  return {
    ok: true,
    count: resolved.keywords.length,
    cache: resolved.cache
  };
}

async function handleNoiseCatStartPublicSync(sender) {
  const resolved = await resolveNoiseCatPublicKeywords({
    ignoreEnabled: true
  });

  if (!resolved.ok) {
    return resolved;
  }

  if (resolved.keywords.length === 0) {
    return {
      ok: false,
      message: "公共词库为空，无法同步到 X"
    };
  }

  const queued = await queueNoiseCatMuteKeywords(resolved.keywords, sender, "公共词库");

  if (!queued.ok) {
    return queued;
  }

  await setNoiseCatLastResult({
    status: "success",
    message: `已开始同步公共词库，共 ${resolved.keywords.length} 个词`,
    at: Date.now()
  });

  return {
    ok: true,
    count: resolved.keywords.length
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
});

chrome.action.onClicked.addListener(handleNoiseCatActionClick);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "noisecat-add-muted-keyword") {
    handleNoiseCatAddKeyword(message, sender)
      .then(sendResponse)
      .catch(() => {
        sendResponse({
          ok: false,
          message: "打开 X 屏蔽词页面失败"
        });
      });

    return true;
  }

  if (message?.type === "noisecat-selection-state") {
    syncNoiseCatBadge(sender.tab?.id, Boolean(message.active))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));

    return true;
  }

  if (message?.type === "noisecat-refresh-public-keywords") {
    handleNoiseCatRefreshPublicKeywords()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || "公共词库刷新失败"
        });
      });

    return true;
  }

  if (message?.type === "noisecat-get-public-keywords") {
    resolveNoiseCatPublicKeywords({
      forceRefresh: Boolean(message.forceRefresh)
    })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || "获取公共词库失败"
        });
      });

    return true;
  }

  if (message?.type === "noisecat-start-public-sync") {
    handleNoiseCatStartPublicSync(sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error?.message || "启动公共词库同步失败"
        });
      });

    return true;
  }

  return false;
});
