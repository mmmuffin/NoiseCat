const enabledCheckbox = document.querySelector("#enabled");
const publicKeywordsEnabledCheckbox = document.querySelector("#publicKeywordsEnabled");
const publicKeywordHideRepliesCheckbox = document.querySelector("#publicKeywordHideReplies");
const publicKeywordSourceUrlInput = document.querySelector("#publicKeywordSourceUrl");
const saveSettingsButton = document.querySelector("#saveSettings");
const refreshPublicKeywordsButton = document.querySelector("#refreshPublicKeywords");
const syncPublicKeywordsButton = document.querySelector("#syncPublicKeywords");
const statusText = document.querySelector("#status");
const lastResult = document.querySelector("#lastResult");
const cacheSummary = document.querySelector("#cacheSummary");
const keywordPreview = document.querySelector("#keywordPreview");

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.dataset.error = isError ? "true" : "false";

  if (message) {
    window.clearTimeout(setStatus.timerId);
    setStatus.timerId = window.setTimeout(() => {
      statusText.textContent = "";
      statusText.dataset.error = "false";
    }, 2600);
  }
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false
  });
}

function renderCache(cache) {
  if (!cache || !cache.keywords?.length) {
    cacheSummary.textContent = "尚未拉取";
    keywordPreview.textContent = "暂无";
    return;
  }

  cacheSummary.textContent = `已缓存 ${cache.keywords.length} 个词 · ${formatDateTime(cache.fetchedAt)}`;

  const preview = cache.keywords.slice(0, 8).join(" / ");
  keywordPreview.textContent =
    cache.keywords.length > 8 ? `${preview} 等 ${cache.keywords.length} 个` : preview;
}

async function renderOptions() {
  const settings = await getNoiseCatSettings();
  const latest = await getNoiseCatLastResult();
  const cache = await getNoiseCatPublicKeywordsCache();

  enabledCheckbox.checked = settings.enabled;
  publicKeywordsEnabledCheckbox.checked = settings.publicKeywordsEnabled;
  publicKeywordHideRepliesCheckbox.checked = settings.publicKeywordHideReplies;
  publicKeywordSourceUrlInput.value = settings.publicKeywordSourceUrl;

  renderCache(cache && cache.sourceUrl === settings.publicKeywordSourceUrl ? cache : null);

  if (!latest) {
    lastResult.textContent = "暂无记录";
    return;
  }

  lastResult.textContent = `${formatDateTime(latest.at)} · ${latest.message}`;
}

async function saveCurrentSettings() {
  const nextSettings = await saveNoiseCatSettings({
    enabled: enabledCheckbox.checked,
    publicKeywordsEnabled: publicKeywordsEnabledCheckbox.checked,
    publicKeywordHideReplies: publicKeywordHideRepliesCheckbox.checked,
    publicKeywordSourceUrl: publicKeywordSourceUrlInput.value
  });

  setStatus("设置已保存");
  return nextSettings;
}

saveSettingsButton.addEventListener("click", async () => {
  await saveCurrentSettings();
  await renderOptions();
});

refreshPublicKeywordsButton.addEventListener("click", async () => {
  await saveCurrentSettings();

  const response = await chrome.runtime.sendMessage({
    type: "noisecat-refresh-public-keywords"
  });

  if (!response?.ok) {
    setStatus(response?.message || "公共词库刷新失败", true);
    return;
  }

  await renderOptions();
  setStatus(`公共词库已刷新，共 ${response.count} 个词`);
});

syncPublicKeywordsButton.addEventListener("click", async () => {
  await saveCurrentSettings();

  const response = await chrome.runtime.sendMessage({
    type: "noisecat-start-public-sync"
  });

  if (!response?.ok) {
    setStatus(response?.message || "启动同步失败", true);
    return;
  }

  await renderOptions();
  setStatus(`已启动同步，共 ${response.count} 个词`);
});

enabledCheckbox.addEventListener("change", async () => {
  await saveNoiseCatSettings({ enabled: enabledCheckbox.checked });
  setStatus(enabledCheckbox.checked ? "插件已启用" : "插件已停用");
});

renderOptions();
