const shareBtn = document.getElementById('share-btn');
const statusText = document.getElementById('status-text');
const wsDot = document.getElementById('ws-dot');
const wsLabel = document.getElementById('ws-label');
const serverUrlInput = document.getElementById('server-url');
const saveBtn = document.getElementById('save-btn');

let isSharing = false;

// Load saved URL and sharing state
chrome.storage.local.get(['serverUrl', 'sharing'], (data) => {
  if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  if (data.sharing) setUI(true, false);
});

// Poll status every second
function pollStatus() {
  chrome.runtime.sendMessage({ type: 'get_status' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    setUI(res.sharing, res.connected);
  });
}
setInterval(pollStatus, 1000);
pollStatus();

// Listen for ws status updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ws_status') updateWsDot(msg.status);
});

function updateWsDot(status) {
  wsDot.className = 'ws-dot';
  if (status === 'connected') {
    wsDot.classList.add('on');
    wsLabel.textContent = 'live';
  } else if (status === 'error') {
    wsDot.classList.add('err');
    wsLabel.textContent = 'error';
  } else {
    wsLabel.textContent = 'off';
  }
}

function setUI(sharing, connected) {
  isSharing = sharing;
  if (sharing) {
    shareBtn.textContent = '■ Stop Sharing';
    shareBtn.classList.add('active');
    statusText.textContent = connected ? 'Broadcasting live' : 'Connecting...';
    statusText.className = 'status-text' + (connected ? ' live' : '');
    updateWsDot(connected ? 'connected' : 'disconnected');
  } else {
    shareBtn.textContent = '▶ Start Sharing';
    shareBtn.classList.remove('active');
    statusText.textContent = 'Not sharing';
    statusText.className = 'status-text';
    updateWsDot('off');
  }
}

// Wire up buttons via addEventListener (no inline onclick)
shareBtn.addEventListener('click', async () => {
  if (!isSharing) {
    chrome.runtime.sendMessage({ type: 'start_sharing' });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: 'capture_start' });
    setUI(true, false);
  } else {
    chrome.runtime.sendMessage({ type: 'stop_sharing' });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { type: 'capture_stop' });
    setUI(false, false);
  }
});

saveBtn.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  if (!url) return;
  chrome.runtime.sendMessage({ type: 'set_server_url', url }, () => {
    serverUrlInput.style.borderColor = '#3dffa0';
    setTimeout(() => { serverUrlInput.style.borderColor = ''; }, 1000);
  });
});
