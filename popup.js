const enabledInput = document.querySelector("#enabled");
const keywordSummary = document.querySelector("#keywordSummary");
const openOptionsButton = document.querySelector("#openOptions");

function renderKeywordSummary(settings, cache) {
  if (!settings.publicKeywordsEnabled) {
    keywordSummary.textContent = "尚未启用";
    return;
  }

  if (!settings.publicKeywordSourceUrl) {
    keywordSummary.textContent = "已启用，但还没配置词库 URL";
    return;
  }

  if (!cache || cache.sourceUrl !== settings.publicKeywordSourceUrl) {
    keywordSummary.textContent = "已启用，等待首次拉取";
    return;
  }

  keywordSummary.textContent = `已缓存 ${cache.keywords.length} 个词`;
}

async function renderPopup() {
  const settings = await getNoiseCatSettings();
  const cache = await getNoiseCatPublicKeywordsCache();

  enabledInput.checked = settings.enabled;
  renderKeywordSummary(settings, cache);
}

enabledInput.addEventListener("change", async () => {
  await saveNoiseCatSettings({ enabled: enabledInput.checked });
  renderPopup();
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

renderPopup();
