// background.js — lightweight relay only, WebSocket lives in content.js now

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'start_sharing') {
    chrome.storage.local.set({ sharing: false });
    // Tell the active tab's content script to start
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'capture_start' });
      }
    });
    sendResponse({ ok: true });
  }

  if (msg.type === 'stop_sharing') {
    chrome.storage.local.set({ sharing: false });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'capture_stop' });
      }
    });
    sendResponse({ ok: true });
  }

  if (msg.type === 'set_server_url') {
    chrome.storage.local.set({ serverUrl: msg.url });
    sendResponse({ ok: true });
  }

  if (msg.type === 'get_status') {
    chrome.storage.local.get(['sharing'], (data) => {
      sendResponse({ sharing: !!data.sharing, connected: false });
    });
    return true;
  }

  // ws_status comes from content script, forward to popup
  if (msg.type === 'ws_status') {
    chrome.runtime.sendMessage(msg).catch(() => {});
    sendResponse({ ok: true });
  }

  return true;
});
