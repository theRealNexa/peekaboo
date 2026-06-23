# TextCast

Share any page's text live to a viewer site — bypasses CSS/JS text selection locks.

---

## Structure

```
textcast/
├── server/         ← Node.js WebSocket server (also serves viewer page)
│   ├── server.js
│   └── package.json
├── viewer/         ← Viewer site (served by server)
│   └── index.html
└── extension/      ← Chrome/Edge browser extension
    ├── manifest.json
    ├── background.js
    ├── content.js
    └── popup.html
```

---

## Setup

### 1. Run the server

```bash
cd server
npm install
npm start
```

Server runs at `http://localhost:3000`  
Viewer page at `http://localhost:3000/`

### 2. Load the extension

1. Open Chrome → go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 3. Use it

1. Visit any website
2. Click the TextCast extension icon
3. Set the Server URL to `ws://localhost:3000?role=sender`
4. Click **▶ Start Sharing**
5. Open `http://localhost:3000` on any device — text appears live

---

## Deploying online (so anyone can view)

Deploy the server to any Node.js host:
- **Railway** (free tier): `railway up` in the server folder
- **Render** (free tier): connect your repo, set start command to `node server.js`
- **Fly.io**: `fly launch`

Once deployed, update two things:
1. Extension popup → Server URL → `wss://your-domain.com?role=sender`
2. Viewer page connects automatically via `wss://your-domain.com?role=viewer`

> Use `wss://` (secure) for deployed servers, `ws://` for localhost only.

---

## How it works

```
Extension (content.js)
  └── reads document.body.innerText every 3s (bypasses user-select:none)
      └── sends to background.js via chrome.runtime.sendMessage
          └── background.js sends via WebSocket to server
              └── server.js broadcasts to ALL connected viewers instantly
                  └── viewer/index.html displays text, fully selectable + copyable
```

---

## Roadmap

- [ ] Phase 2: Add bidirectional video (getUserMedia + WebRTC)
- [ ] Highlight specific elements (click to share just one section)
- [ ] Password-protect viewer page
- [ ] Multiple channels / rooms
