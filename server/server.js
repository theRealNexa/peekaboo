const http = require("http");
const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const PORT = process.env.PORT || 3000;
const ADMIN_CODENAME = process.env.ADMIN_CODENAME || "kasalidamilola123";

// ── Firebase init ─────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const snapshotsCol = db.collection("snapshots");

// ── Helpers ───────────────────────────────────────────────────
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "unknown"; }
}

async function addSnapshot(text, url) {
  const domain = getDomain(url);
  const snap = {
    url,
    domain,
    text,
    preview: text.slice(0, 150),
    timestamp: Date.now()
  };
  const ref = await snapshotsCol.add(snap);
  return { id: ref.id, ...snap };
}

async function getHistory() {
  const qs = await snapshotsCol.orderBy("timestamp", "desc").get();
  const grouped = {};
  qs.forEach(doc => {
    const d = doc.data();
    const domain = d.domain || getDomain(d.url);
    if (!grouped[domain]) grouped[domain] = [];
    grouped[domain].push({
      id: doc.id,
      url: d.url,
      timestamp: d.timestamp,
      preview: d.preview || d.text?.slice(0, 150) || ""
    });
  });
  return grouped;
}

async function getSnapshot(id) {
  const doc = await snapshotsCol.doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function deleteSnapshot(id) {
  await snapshotsCol.doc(id).delete();
}

async function deleteDomain(domain) {
  const qs = await snapshotsCol.where("domain", "==", domain).get();
  const batch = db.batch();
  qs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

async function bulkDelete(ids) {
  const batch = db.batch();
  ids.forEach(id => batch.delete(snapshotsCol.doc(id)));
  await batch.commit();
}

// ── Text processing ───────────────────────────────────────────
function processText(raw) {
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 1);
  const isQuiz = lines.some(l => /^(q\d+[\.\)]|question\s+\d+|\d+[\.\)])/i.test(l));
  const isNumberedList = lines.filter(l => /^\d+[\.\)]\s+/.test(l)).length > 3;
  const navPatterns = /^(home|menu|search|login|sign in|sign up|about|contact|privacy|terms|cookie|subscribe|follow|share|like|tweet|next|previous|back|skip|close|ok|cancel|yes|no|submit|send|more|load more|see more|show more|read more|view all|all rights reserved|copyright|©)$/i;
  const wordCounts = {};
  lines.forEach(l => { wordCounts[l] = (wordCounts[l] || 0) + 1; });
  const filtered = lines.filter(l => {
    if (l.split(" ").length <= 2 && navPatterns.test(l.trim())) return false;
    if (wordCounts[l] > 3 && l.split(" ").length < 5) return false;
    return true;
  });
  if (isQuiz) return formatQuiz(filtered);
  if (isNumberedList) return formatNumberedList(filtered);
  return formatArticle(filtered);
}

function formatQuiz(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^(q\d+[\.\)]|question\s+\d+|\d+[\.\)])/i.test(l)) {
      out.push("\n" + l); i++;
      while (i < lines.length && /^[a-dA-D][\.\)]\s+/.test(lines[i])) {
        out.push("  " + lines[i]); i++;
      }
    } else { out.push(l); i++; }
  }
  return out.join("\n").trim();
}

function formatNumberedList(lines) {
  return lines.map(l => /^\d+[\.\)]\s+/.test(l) ? "\n" + l : "   " + l).join("\n").trim();
}

function formatArticle(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const wc = l.split(" ").length;
    const nextIsLonger = lines[i+1] && lines[i+1].split(" ").length > wc;
    if (wc <= 8 && !l.endsWith(".") && !l.endsWith(",") && nextIsLonger) {
      out.push("\n── " + l + " ──");
    } else { out.push(l); }
  }
  return out.join("\n").trim();
}

// ── HTTP server ───────────────────────────────────────────────
let viewerCount = 0;
const viewers = new Set();
let lastSnap = null;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-codename");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const codename = req.headers["x-codename"];
  const isAdmin = codename === ADMIN_CODENAME;

  try {
    // GET /history
    if (req.method === "GET" && u.pathname === "/history") {
      const h = await getHistory();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(h)); return;
    }

    // GET /snapshot/:id
    if (req.method === "GET" && u.pathname.startsWith("/snapshot/")) {
      const id = u.pathname.split("/")[2];
      const snap = await getSnapshot(id);
      if (!snap) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snap)); return;
    }

    // DELETE /snapshot/:id
    if (req.method === "DELETE" && u.pathname.startsWith("/snapshot/")) {
      const id = u.pathname.split("/")[2];
      if (id === "__test__") {
        // codename verification probe
        if (!isAdmin) { res.writeHead(403); res.end("Forbidden"); return; }
        res.writeHead(404); res.end("Not found"); return;
      }
      if (!isAdmin) { res.writeHead(403); res.end("Forbidden"); return; }
      await deleteSnapshot(id);
      res.writeHead(200); res.end("Deleted"); return;
    }

    // DELETE /domain/:domain
    if (req.method === "DELETE" && u.pathname.startsWith("/domain/")) {
      if (!isAdmin) { res.writeHead(403); res.end("Forbidden"); return; }
      const domain = decodeURIComponent(u.pathname.split("/")[2]);
      await deleteDomain(domain);
      res.writeHead(200); res.end("Deleted"); return;
    }

    // DELETE /snapshots (bulk)
    if (req.method === "DELETE" && u.pathname === "/snapshots") {
      if (!isAdmin) { res.writeHead(403); res.end("Forbidden"); return; }
      let body = "";
      req.on("data", d => body += d);
      req.on("end", async () => {
        try {
          const { ids } = JSON.parse(body);
          await bulkDelete(ids);
          res.writeHead(200); res.end("Deleted");
        } catch { res.writeHead(400); res.end("Bad request"); }
      });
      return;
    }

    // Serve static files
    // /        → peekaboo.html (landing page)
    // /cast     → index.html   (TextCast viewer)
    // anything else → file in viewer folder
    let serveFile;
    if (u.pathname === "/") {
      serveFile = path.join(__dirname, "../viewer/peekaboo.html");
    } else if (u.pathname === "/cast") {
      serveFile = path.join(__dirname, "../viewer/index.html");
    } else {
      serveFile = path.join(__dirname, "../viewer", u.pathname);
    }
    const ext = path.extname(serveFile);
    const mime = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".jfif": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
    fs.readFile(serveFile, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
      res.end(data);
    });

  } catch (e) {
    console.error("Server error:", e);
    res.writeHead(500); res.end("Server error");
  }
});

// ── WebSocket ─────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcastViewerCount() {
  const msg = JSON.stringify({ type: "viewer_count", count: viewerCount });
  viewers.forEach(v => { if (v.readyState === 1) v.send(msg); });
}

wss.on("connection", (ws, req) => {
  const u = new URL(req.url, "http://localhost");
  const role = u.searchParams.get("role");

  if (role === "viewer") {
    viewers.add(ws);
    viewerCount++;
    broadcastViewerCount();
    console.log(`Viewer connected. Total: ${viewerCount}`);
    if (lastSnap) ws.send(JSON.stringify({ type: "text", ...lastSnap }));
    ws.on("close", () => {
      viewers.delete(ws);
      viewerCount--;
      broadcastViewerCount();
      console.log(`Viewer disconnected. Total: ${viewerCount}`);
    });

  } else if (role === "sender") {
    console.log("Sender connected");
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "text") {
          const processed = processText(msg.text);
          const snap = await addSnapshot(processed, msg.url);
          lastSnap = { text: processed, url: msg.url, id: snap.id, timestamp: snap.timestamp };
          const payload = JSON.stringify({ type: "text", text: processed, url: msg.url, id: snap.id, timestamp: snap.timestamp });
          let sent = 0;
          viewers.forEach(v => { if (v.readyState === 1) { v.send(payload); sent++; } });
          console.log(`Saved + broadcast to ${sent} viewer(s) — ${processed.length} chars from ${msg.url}`);
        }
      } catch (e) { console.error("Message error:", e.message); }
    });
    ws.on("close", () => {
      console.log("Sender disconnected");
      viewers.forEach(v => { if (v.readyState === 1) v.send(JSON.stringify({ type: "offline" })); });
    });
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ TextCast server running at http://localhost:${PORT}\n`);
});
