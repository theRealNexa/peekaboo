// content.js — runs inside the page, holds WebSocket directly (stays alive unlike service worker)

let ws = null;
let interval = null;
let lastText = '';
let sharing = false;
let serverUrl = 'ws://localhost:3000?role=sender';

// Load saved server URL and sharing state
chrome.storage.local.get(['serverUrl', 'sharing'], (data) => {
  if (data.serverUrl) serverUrl = data.serverUrl;
  // removed auto-start
});

// Listen for URL updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.serverUrl) {
    serverUrl = changes.serverUrl.newValue;
    if (sharing) {
      disconnectWS();
      connectWS();
    }
  }
});

function hasSignificantChange(newText) {
  if (!lastText) return true;
  const diff = Math.abs(newText.length - lastText.length);
  return diff > 200;
}

function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(serverUrl);

  ws.onopen = () => {
    console.log('[TextCast] WS connected');
    notifyPopup('connected');
    // Send immediately on connect
    sendText();
  };

  ws.onclose = () => {
    console.log('[TextCast] WS closed, retrying in 2s...');
    notifyPopup('disconnected');
    ws = null;
    if (sharing) setTimeout(connectWS, 2000);
  };

  ws.onerror = () => {
    notifyPopup('error');
  };
}

function disconnectWS() {
  if (ws) { ws.close(); ws = null; }
}

function notifyPopup(status) {
  chrome.runtime.sendMessage({ type: 'ws_status', status }).catch(() => {});
}

function getPageText() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
  let text = clone.innerText || clone.textContent || '';
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sendText() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const text = getPageText();
  if (!text) return;
  // Always send on first call, then only on change
  if (hasSignificantChange(text)) {
    lastText = text;
    ws.send(JSON.stringify({ type: 'text', text, url: window.location.href }));
    console.log('[TextCast] Sent', text.length, 'chars');
  }
}

function startSharing() {
  sharing = true;
  connectWS();
  if (interval) clearInterval(interval);
  // Check every 2 seconds for text changes
  interval = setInterval(sendText, 2000);
}

function stopSharing() {
  sharing = false;
  if (interval) { clearInterval(interval); interval = null; }
  disconnectWS();
  lastText = '';
}

// Listen for commands from popup (via background)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'capture_start') {
    startSharing();
    sendResponse({ ok: true });
  }
  if (msg.type === 'capture_stop') {
    stopSharing();
    sendResponse({ ok: true });
  }
  if (msg.type === 'get_ws_status') {
    sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
  }
  return true;
});

// Also watch for URL changes (single page apps)
let lastUrl = location.href;
let mutationTimer = null;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastText = '';
    setTimeout(sendText, 500);
    return;
  }
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    if (sharing) sendText();
  }, 2000);
}).observe(document, { subtree: true, childList: true });