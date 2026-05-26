const NOISECAT_ADD_PAGE_PATH = "/settings/add_muted_keyword";
const NOISECAT_MUTED_LIST_PATH = "/settings/muted_keywords";
const NOISECAT_SELECTION_MODE_ATTR = "data-noisecat-selection-mode";
const NOISECAT_PENDING_MAX_AGE_MS = 5 * 60 * 1000;
const NOISECAT_PUBLIC_HIDDEN_ATTR = "data-noisecat-public-hidden";
const NOISECAT_HIDDEN_DISPLAY_ATTR = "data-noisecat-display";
const NOISECAT_MATCHED_KEYWORD_ATTR = "data-noisecat-matched-keyword";
const NOISECAT_TWEET_SELECTOR = 'article[data-testid="tweet"]';
const NOISECAT_CELL_SELECTOR = '[data-testid="cellInnerDiv"]';

let noiseCatSelectionMode = false;
let noiseCatCurrentSelection = "";
let noiseCatCurrentRect = null;
let noiseCatCurrentUrl = location.href;
let noiseCatUi = null;
let noiseCatToastTimer = null;
let noiseCatPendingInFlight = false;
let noiseCatRouteObserver = null;
let noiseCatReplyScanTimer = null;
let noiseCatPublicRedirectTimer = null;
let noiseCatSettings = { ...NOISECAT_DEFAULT_SETTINGS };
let noiseCatPublicKeywords = [];

function isNoiseCatSelectionPage() {
  return /^https:\/\/(x|twitter)\.com\//.test(location.href);
}

function isNoiseCatAddPage() {
  return location.pathname === NOISECAT_ADD_PAGE_PATH;
}

function isNoiseCatMutedPage() {
  return location.pathname === NOISECAT_MUTED_LIST_PATH;
}

function isNoiseCatStatusPage() {
  return /\/status\/\d+/.test(location.pathname);
}

function getVisibleText(text) {
  return normalizeMutePhrase(text);
}

function normalizeMatchText(text) {
  return normalizeMutePhrase(text).toLowerCase();
}

function isElementVisible(element) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function getNoiseCatElementTextHints(element) {
  return [
    element.getAttribute("placeholder") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("data-testid") || "",
    element.textContent || ""
  ]
    .join(" ")
    .trim();
}

function getNoiseCatNearestSectionText(element) {
  const section = element.closest("section, form, div");

  if (!section) {
    return "";
  }

  return String(section.textContent || "").slice(0, 240);
}

function ensureNoiseCatUi() {
  if (noiseCatUi) {
    return noiseCatUi;
  }

  const root = document.createElement("div");
  root.id = "noisecat-root";
  root.innerHTML = `
    <button id="noisecat-add-button" class="noisecat-add-button" type="button" hidden>
      添加到屏蔽词
    </button>
    <div id="noisecat-toast" class="noisecat-toast" hidden></div>
  `;

  document.documentElement.appendChild(root);

  const addButton = root.querySelector("#noisecat-add-button");
  addButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  addButton.addEventListener("click", handleNoiseCatAddClick);

  noiseCatUi = {
    root,
    addButton,
    toast: root.querySelector("#noisecat-toast")
  };

  return noiseCatUi;
}

function showNoiseCatToast(message, isError = false) {
  const { toast } = ensureNoiseCatUi();

  toast.textContent = message;
  toast.hidden = false;
  toast.dataset.error = isError ? "true" : "false";

  window.clearTimeout(noiseCatToastTimer);
  noiseCatToastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toast.dataset.error = "false";
  }, 2200);
}

function syncNoiseCatBadge() {
  try {
    chrome.runtime.sendMessage({
      type: "noisecat-selection-state",
      active: noiseCatSelectionMode
    });
  } catch (error) {
    // Ignore background sync failures.
  }
}

function hideNoiseCatAddButton() {
  const { addButton } = ensureNoiseCatUi();
  addButton.hidden = true;
  noiseCatCurrentRect = null;
}

function positionNoiseCatAddButton(rect) {
  const { addButton } = ensureNoiseCatUi();
  const margin = 12;
  const top = Math.min(window.innerHeight - 48, Math.max(margin, rect.bottom + margin));
  const left = Math.min(window.innerWidth - 24, Math.max(24, rect.left + rect.width / 2));

  addButton.style.top = `${top}px`;
  addButton.style.left = `${left}px`;
  addButton.hidden = false;
}

function getNoiseCatSelectionContext() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = getVisibleText(selection.toString());

  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (!rect || (!rect.width && !rect.height)) {
    return null;
  }

  const anchorNode = selection.anchorNode;
  const anchorElement =
    anchorNode && anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;

  if (
    anchorElement &&
    anchorElement.closest("input, textarea, [contenteditable='true'], [role='textbox']")
  ) {
    return null;
  }

  return { text, rect };
}

function syncNoiseCatSelectionUi() {
  if (!noiseCatSelectionMode || !isNoiseCatSelectionPage() || isNoiseCatAddPage()) {
    hideNoiseCatAddButton();
    return;
  }

  const selectionContext = getNoiseCatSelectionContext();

  if (!selectionContext) {
    noiseCatCurrentSelection = "";
    hideNoiseCatAddButton();
    return;
  }

  noiseCatCurrentSelection = selectionContext.text;
  noiseCatCurrentRect = selectionContext.rect;
  positionNoiseCatAddButton(selectionContext.rect);
}

function setNoiseCatSelectionMode(nextValue) {
  noiseCatSelectionMode = Boolean(nextValue);
  document.documentElement.toggleAttribute(NOISECAT_SELECTION_MODE_ATTR, noiseCatSelectionMode);
  syncNoiseCatBadge();

  if (!noiseCatSelectionMode) {
    hideNoiseCatAddButton();
    noiseCatCurrentSelection = "";
    window.getSelection()?.removeAllRanges();
    return;
  }

  showNoiseCatToast("划词模式已开启");
  syncNoiseCatSelectionUi();
}

async function handleNoiseCatAddClick() {
  const keyword = getVisibleText(noiseCatCurrentSelection);

  if (!keyword) {
    showNoiseCatToast("请先选中要添加的文本", true);
    return;
  }

  showNoiseCatToast(`正在添加“${keyword}”`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "noisecat-add-muted-keyword",
      keyword
    });

    if (!response?.ok) {
      showNoiseCatToast(response?.message || "添加失败", true);
      return;
    }

    hideNoiseCatAddButton();
    noiseCatCurrentSelection = "";
    window.getSelection()?.removeAllRanges();
    showNoiseCatToast(`已发送到 X：${keyword}`);
  } catch (error) {
    showNoiseCatToast("无法唤起 X 屏蔽词页面", true);
  }
}

function getPrimaryColumn() {
  return document.querySelector('[data-testid="primaryColumn"]');
}

function getReplyArticles() {
  if (!isNoiseCatStatusPage()) {
    return [];
  }

  const primaryColumn = getPrimaryColumn();

  if (!primaryColumn) {
    return [];
  }

  const articles = [...primaryColumn.querySelectorAll(NOISECAT_TWEET_SELECTOR)];

  if (articles.length <= 1) {
    return [];
  }

  return articles.slice(1);
}

function getNoiseCatHideTarget(article) {
  return article.closest(NOISECAT_CELL_SELECTOR) || article;
}

function hideNoiseCatReplyTarget(target, keyword) {
  if (!target.hasAttribute(NOISECAT_PUBLIC_HIDDEN_ATTR)) {
    target.setAttribute(NOISECAT_HIDDEN_DISPLAY_ATTR, target.style.display || "");
  }

  target.style.setProperty("display", "none", "important");
  target.setAttribute(NOISECAT_PUBLIC_HIDDEN_ATTR, "true");
  target.setAttribute(NOISECAT_MATCHED_KEYWORD_ATTR, keyword);
}

function showNoiseCatReplyTarget(target) {
  if (!target.hasAttribute(NOISECAT_PUBLIC_HIDDEN_ATTR)) {
    return;
  }

  const previousDisplay = target.getAttribute(NOISECAT_HIDDEN_DISPLAY_ATTR) || "";

  if (previousDisplay) {
    target.style.display = previousDisplay;
  } else {
    target.style.removeProperty("display");
  }

  target.removeAttribute(NOISECAT_HIDDEN_DISPLAY_ATTR);
  target.removeAttribute(NOISECAT_PUBLIC_HIDDEN_ATTR);
  target.removeAttribute(NOISECAT_MATCHED_KEYWORD_ATTR);
}

function resetNoiseCatHiddenReplies() {
  document.querySelectorAll(`[${NOISECAT_PUBLIC_HIDDEN_ATTR}="true"]`).forEach(showNoiseCatReplyTarget);
}

function getNoiseCatMatchedKeyword(text) {
  const normalizedText = normalizeMatchText(text);

  if (!normalizedText) {
    return null;
  }

  return noiseCatPublicKeywords.find((keyword) => normalizedText.includes(normalizeKeywordKey(keyword))) || null;
}

function scheduleNoiseCatReplyScan() {
  window.clearTimeout(noiseCatReplyScanTimer);
  noiseCatReplyScanTimer = window.setTimeout(scanNoiseCatReplies, 120);
}

function scanNoiseCatReplies() {
  if (location.href !== noiseCatCurrentUrl) {
    noiseCatCurrentUrl = location.href;
  }

  if (
    !noiseCatSettings.enabled ||
    !noiseCatSettings.publicKeywordsEnabled ||
    !noiseCatSettings.publicKeywordHideReplies ||
    noiseCatPublicKeywords.length === 0 ||
    !isNoiseCatStatusPage()
  ) {
    resetNoiseCatHiddenReplies();
    return;
  }

  const replies = getReplyArticles();
  const liveTargets = new Set();

  replies.forEach((article) => {
    const target = getNoiseCatHideTarget(article);
    const matchedKeyword = getNoiseCatMatchedKeyword(article.innerText);

    liveTargets.add(target);

    if (matchedKeyword) {
      hideNoiseCatReplyTarget(target, matchedKeyword);
    } else {
      showNoiseCatReplyTarget(target);
    }
  });

  document.querySelectorAll(`[${NOISECAT_PUBLIC_HIDDEN_ATTR}="true"]`).forEach((element) => {
    if (!liveTargets.has(element)) {
      showNoiseCatReplyTarget(element);
    }
  });
}

async function refreshNoiseCatSettings() {
  noiseCatSettings = await getNoiseCatSettings();
}

async function refreshNoiseCatPublicKeywords(forceRefresh = false) {
  if (!noiseCatSettings.enabled || !noiseCatSettings.publicKeywordsEnabled) {
    noiseCatPublicKeywords = [];
    resetNoiseCatHiddenReplies();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "noisecat-get-public-keywords",
      forceRefresh
    });

    if (!response?.ok) {
      noiseCatPublicKeywords = [];
      resetNoiseCatHiddenReplies();
      return;
    }

    noiseCatPublicKeywords = dedupeMutePhrases(response.keywords || []);
  } catch (error) {
    noiseCatPublicKeywords = [];
  }

  scheduleNoiseCatReplyScan();
}

function findNoiseCatMuteInput() {
  const candidates = [...document.querySelectorAll("input, textarea, [role='textbox'], [contenteditable='true']")]
    .filter((element) => isElementVisible(element))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const hints = getNoiseCatElementTextHints(element);
      const sectionText = getNoiseCatNearestSectionText(element);
      let score = 0;

      if (/输入字词或短语|word|phrase|keyword|mute/i.test(hints)) {
        score += 120;
      }

      if (/输入字词或短语|隐藏用户|时长|添加要隐藏的字词/i.test(sectionText)) {
        score += 80;
      }

      if (/搜索设置|查询词条|search/i.test(hints) || /没有搜索到结果|搜索设置/i.test(sectionText)) {
        score -= 120;
      }

      if (rect.left > window.innerWidth * 0.45) {
        score += 40;
      } else {
        score -= 40;
      }

      return { element, score };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.element || null;
}

function setNativeValue(element, value) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
}

function findNoiseCatSaveButton() {
  const candidates = [...document.querySelectorAll("button, [role='button']")]
    .filter((element) => isElementVisible(element))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const text = getVisibleText(element.textContent);
      let score = 0;

      if (/^(保存|save)$/.test(text)) {
        score += 100;
      }

      if (rect.left > window.innerWidth * 0.45) {
        score += 30;
      } else {
        score -= 30;
      }

      if (rect.top > window.innerHeight * 0.35) {
        score += 10;
      }

      return { element, score };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.element || null;
}

function isNoiseCatDisabled(element) {
  return (
    !element ||
    element.disabled === true ||
    element.getAttribute("aria-disabled") === "true" ||
    element.hasAttribute("disabled")
  );
}

async function waitForNoiseCatElement(getter, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const element = getter();

    if (element) {
      return element;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  return null;
}

async function submitNoiseCatKeywordToX(keyword) {
  const input = await waitForNoiseCatElement(findNoiseCatMuteInput, 12000);

  if (!input) {
    return {
      ok: false,
      status: "failed",
      message: "未找到 X 的屏蔽词输入框"
    };
  }

  input.focus();
  setNativeValue(input, keyword);

  await new Promise((resolve) => window.setTimeout(resolve, 200));

  const saveButton = await waitForNoiseCatElement(findNoiseCatSaveButton, 8000);

  if (!saveButton) {
    return {
      ok: false,
      status: "failed",
      message: "未找到 X 的保存按钮"
    };
  }

  const readyAt = Date.now();

  while (isNoiseCatDisabled(saveButton) && Date.now() - readyAt < 3000) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  if (isNoiseCatDisabled(saveButton)) {
    return {
      ok: true,
      status: "skipped",
      message: `已跳过“${keyword}”，可能已经存在`
    };
  }

  saveButton.click();

  return {
    ok: true,
    status: "added",
    message: `已提交到 X：${keyword}`
  };
}

async function finalizeNoiseCatPendingQueue(pendingMute) {
  const added = Number(pendingMute.stats?.added || 0);
  const skipped = Number(pendingMute.stats?.skipped || 0);
  const failed = Number(pendingMute.stats?.failed || 0);
  const summary = `同步完成：新增 ${added}，跳过 ${skipped}，失败 ${failed}`;

  await clearNoiseCatPendingMute();
  await setNoiseCatLastResult({
    status: failed > 0 ? "error" : "success",
    message: summary,
    at: Date.now()
  });
  showNoiseCatToast(summary, failed > 0);
}

async function processNoiseCatPendingQueue() {
  if (noiseCatPendingInFlight) {
    return;
  }

  const pendingMute = await getNoiseCatPendingMute();

  if (!pendingMute) {
    return;
  }

  if (Date.now() - Number(pendingMute.createdAt || 0) > NOISECAT_PENDING_MAX_AGE_MS) {
    await clearNoiseCatPendingMute();
    return;
  }

  const nextKeyword = pendingMute.keywords?.[pendingMute.currentIndex] || null;

  if (!nextKeyword) {
    await finalizeNoiseCatPendingQueue(pendingMute);
    return;
  }

  if (isNoiseCatMutedPage()) {
    window.clearTimeout(noiseCatPublicRedirectTimer);
    noiseCatPublicRedirectTimer = window.setTimeout(() => {
      location.href = `https://x.com${NOISECAT_ADD_PAGE_PATH}`;
    }, 500);
    return;
  }

  if (!isNoiseCatAddPage()) {
    return;
  }

  noiseCatPendingInFlight = true;
  showNoiseCatToast(`正在同步 ${pendingMute.currentIndex + 1}/${pendingMute.keywords.length}：${nextKeyword}`);

  const result = await submitNoiseCatKeywordToX(nextKeyword);
  const nextPending = {
    ...pendingMute,
    currentIndex: pendingMute.currentIndex + 1,
    processed: [
      ...(pendingMute.processed || []),
      {
        keyword: nextKeyword,
        status: result.status,
        at: Date.now()
      }
    ],
    stats: {
      added: Number(pendingMute.stats?.added || 0) + (result.status === "added" ? 1 : 0),
      skipped: Number(pendingMute.stats?.skipped || 0) + (result.status === "skipped" ? 1 : 0),
      failed: Number(pendingMute.stats?.failed || 0) + (result.status === "failed" ? 1 : 0)
    }
  };

  await setNoiseCatLastResult({
    status: result.status === "failed" ? "error" : "success",
    message: result.message,
    at: Date.now()
  });

  if (nextPending.currentIndex >= nextPending.keywords.length) {
    noiseCatPendingInFlight = false;
    await finalizeNoiseCatPendingQueue(nextPending);
    return;
  }

  await setNoiseCatPendingMute(nextPending);
  noiseCatPendingInFlight = false;

  window.setTimeout(() => {
    processNoiseCatPendingQueue();
  }, 1200);
}

function handleNoiseCatRouteChange() {
  if (location.href === noiseCatCurrentUrl) {
    return;
  }

  noiseCatCurrentUrl = location.href;
  hideNoiseCatAddButton();
  resetNoiseCatHiddenReplies();
  syncNoiseCatSelectionUi();
  scheduleNoiseCatReplyScan();
  processNoiseCatPendingQueue();
}

function startNoiseCatRouteObserver() {
  if (noiseCatRouteObserver) {
    noiseCatRouteObserver.disconnect();
  }

  if (!document.body) {
    return;
  }

  noiseCatRouteObserver = new MutationObserver(() => {
    handleNoiseCatRouteChange();
    scheduleNoiseCatReplyScan();
  });

  noiseCatRouteObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function bootstrapNoiseCat() {
  if (!isNoiseCatSelectionPage()) {
    return;
  }

  ensureNoiseCatUi();
  await refreshNoiseCatSettings();
  await refreshNoiseCatPublicKeywords(false);

  document.addEventListener("selectionchange", syncNoiseCatSelectionUi);
  document.addEventListener("mouseup", syncNoiseCatSelectionUi);
  document.addEventListener("keyup", syncNoiseCatSelectionUi);
  window.addEventListener("resize", syncNoiseCatSelectionUi);
  window.addEventListener("scroll", syncNoiseCatSelectionUi, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "noisecat-toggle-selection-mode") {
      setNoiseCatSelectionMode(!noiseCatSelectionMode);
      sendResponse({ ok: true, active: noiseCatSelectionMode });
      return true;
    }

    if (message?.type === "noisecat-show-toast") {
      showNoiseCatToast(message.message, message.variant === "error");
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "sync" && changes[NOISECAT_STORAGE_KEY]) {
      await refreshNoiseCatSettings();
      await refreshNoiseCatPublicKeywords(false);
      scheduleNoiseCatReplyScan();
    }

    if (areaName === "local" && changes[NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY]) {
      const cache = changes[NOISECAT_PUBLIC_KEYWORDS_CACHE_KEY].newValue;
      noiseCatPublicKeywords = dedupeMutePhrases(cache?.keywords || []);
      scheduleNoiseCatReplyScan();
    }

    if (areaName === "local" && changes[NOISECAT_PENDING_MUTE_KEY]) {
      processNoiseCatPendingQueue();
    }
  });

  startNoiseCatRouteObserver();
  scheduleNoiseCatReplyScan();
  processNoiseCatPendingQueue();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", bootstrapNoiseCat, { once: true });
} else {
  bootstrapNoiseCat();
}
