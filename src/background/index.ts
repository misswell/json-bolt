chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
      // Older Chromium builds may not support this behavior flag.
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  const pageUrl = new URL(chrome.runtime.getURL("src/popup/index.html"));
  if (tab.id !== undefined) {
    pageUrl.searchParams.set("sourceTabId", String(tab.id));
  }
  chrome.tabs.create({
    url: pageUrl.toString()
  });
});
