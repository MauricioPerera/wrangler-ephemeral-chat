const HISTORY_LIMIT = 50;
const TEMP_ACCOUNT_LIFETIME_MS = 60 * 60 * 1000;

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS room_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL DEFAULT 'open',
        admin_token TEXT,
        created_ts INTEGER
      )`
    );
    try {
      this.sql.exec(`ALTER TABLE room_config ADD COLUMN created_ts INTEGER`);
    } catch {
      // column already exists from a previous deploy of this room
    }
    this.sql.exec(`INSERT OR IGNORE INTO room_config (id, mode, admin_token, created_ts) VALUES (1, 'open', NULL, ?)`, Date.now());
    this.sql.exec(`UPDATE room_config SET created_ts = ? WHERE id = 1 AND created_ts IS NULL`, Date.now());
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        used INTEGER NOT NULL DEFAULT 0,
        created_ts INTEGER NOT NULL,
        used_ts INTEGER
      )`
    );
  }

  getConfig() {
    return [...this.sql.exec(`SELECT mode, admin_token, created_ts FROM room_config WHERE id = 1`)][0];
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "anónimo").slice(0, 32);
    const adminParam = url.searchParams.get("admin");
    const inviteParam = url.searchParams.get("invite");

    const config = this.getConfig();
    let isAdmin = false;
    let newAdminToken = null;

    if (adminParam) {
      if (!config.admin_token) {
        newAdminToken = crypto.randomUUID();
        this.sql.exec(`UPDATE room_config SET admin_token = ? WHERE id = 1`, newAdminToken);
        isAdmin = true;
      } else if (adminParam === config.admin_token) {
        isAdmin = true;
      }
    }

    if (!isAdmin && config.mode === "closed") {
      let validInvite = false;
      if (inviteParam) {
        const rows = [...this.sql.exec(`SELECT token FROM invites WHERE token = ? AND used = 0`, inviteParam)];
        if (rows.length) {
          this.sql.exec(`UPDATE invites SET used = 1, used_ts = ? WHERE token = ?`, Date.now(), inviteParam);
          validInvite = true;
        }
      }
      if (!validInvite) {
        return new Response("Este chat es privado. Necesitás un enlace de invitación válido.", { status: 403 });
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ name, isAdmin });

    const history = [...this.sql.exec(
      `SELECT name, text, ts FROM messages ORDER BY id DESC LIMIT ?`,
      HISTORY_LIMIT
    )].reverse();
    server.send(JSON.stringify({ history, ts: Date.now() }));
    server.send(JSON.stringify({
      status: true,
      mode: config.mode,
      isAdmin,
      adminToken: newAdminToken,
      createdTs: config.created_ts,
      expiryMs: TEMP_ACCOUNT_LIFETIME_MS,
      ts: Date.now(),
    }));

    const joinPayload = JSON.stringify({ system: true, text: `${name} se unió al chat`, ts: Date.now() });
    for (const session of this.state.getWebSockets()) {
      session.send(joinPayload);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const { name, isAdmin } = ws.deserializeAttachment() || { name: "anónimo", isAdmin: false };

    let parsed = null;
    try {
      parsed = JSON.parse(message);
    } catch {
      // not JSON, treat as plain chat text below
    }

    if (isAdmin && parsed && typeof parsed === "object" && parsed.cmd) {
      this.handleAdminCommand(ws, parsed);
      return;
    }

    const text = String(message);
    const ts = Date.now();

    this.sql.exec(`INSERT INTO messages (name, text, ts) VALUES (?, ?, ?)`, name, text, ts);
    this.sql.exec(
      `DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)`,
      HISTORY_LIMIT
    );

    const payload = JSON.stringify({ name, text, ts });
    for (const session of this.state.getWebSockets()) {
      session.send(payload);
    }
  }

  handleAdminCommand(ws, cmd) {
    if (cmd.cmd === "setMode") {
      const mode = cmd.mode === "closed" ? "closed" : "open";
      this.sql.exec(`UPDATE room_config SET mode = ? WHERE id = 1`, mode);
      const payload = JSON.stringify({ system: true, text: `La sala ahora es ${mode === "closed" ? "CERRADA (solo invitados)" : "ABIERTA (cualquiera con el enlace)"}`, ts: Date.now() });
      for (const session of this.state.getWebSockets()) {
        session.send(payload);
      }
      return;
    }

    if (cmd.cmd === "createInvite") {
      const token = crypto.randomUUID();
      this.sql.exec(`INSERT INTO invites (token, used, created_ts) VALUES (?, 0, ?)`, token, Date.now());
      ws.send(JSON.stringify({ inviteToken: token, ts: Date.now() }));
      return;
    }
  }

  async webSocketClose(ws) {
    const { name } = ws.deserializeAttachment() || { name: "anónimo" };
    const leavePayload = JSON.stringify({ system: true, text: `${name} salió del chat`, ts: Date.now() });
    for (const session of this.state.getWebSockets()) {
      session.send(leavePayload);
    }
  }
}

const PAGE = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #eef0f4;
    --card: #ffffff;
    --border: #e2e5ea;
    --text: #1c1f26;
    --muted: #7a8091;
    --primary: #3b6bf5;
    --primary-text: #ffffff;
    --bubble-other: #eef1f6;
    --danger: #c0392b;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 32px 16px;
    display: flex;
    justify-content: center;
  }
  .app { width: 100%; max-width: 480px; }
  h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 16px 4px;
    color: var(--text);
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 1px 3px rgba(20, 20, 40, 0.06);
    padding: 20px;
  }
  #login input {
    width: 100%;
    padding: 11px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 15px;
    outline: none;
    margin-bottom: 10px;
  }
  #login input:focus { border-color: var(--primary); }
  button {
    font-family: inherit;
    cursor: pointer;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  #join {
    width: 100%;
    padding: 11px;
    background: var(--primary);
    color: var(--primary-text);
    font-size: 15px;
  }
  #loginError {
    color: var(--danger);
    margin-top: 10px;
    font-size: 13px;
    line-height: 1.4;
  }
  #chat { display: none; flex-direction: column; }
  #login { display: flex; flex-direction: column; justify-content: center; }
  #expiryBanner {
    display: none;
    padding: 8px 12px;
    margin-bottom: 12px;
    font-size: 12.5px;
    border-radius: 999px;
    background: #eaf0ff;
    color: #33447a;
    text-align: center;
  }
  #adminPanel {
    display: none;
    background: #fbfaf3;
    border: 1px solid #ecdfa0;
    border-radius: 12px;
    padding: 12px 14px;
    margin-bottom: 12px;
    font-size: 13px;
  }
  #adminPanel .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  #adminPanel button {
    padding: 6px 10px;
    background: #fff;
    border: 1px solid #d8cc80;
    color: #6b5b0f;
    font-size: 12.5px;
  }
  #modeLabel { font-weight: 700; }
  #inviteList div, #adminLink {
    font-size: 11.5px;
    word-break: break-all;
    color: #445;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 6px;
    margin-top: 4px;
    display: block;
  }
  #log {
    height: 320px;
    overflow-y: auto;
    padding: 4px 2px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg-row { display: flex; flex-direction: column; max-width: 78%; }
  .msg-row.own { align-self: flex-end; align-items: flex-end; }
  .msg-row.other { align-self: flex-start; align-items: flex-start; }
  .msg-name { font-size: 11.5px; font-weight: 700; margin: 0 4px 2px; }
  .bubble {
    padding: 9px 13px;
    border-radius: 16px;
    font-size: 14.5px;
    line-height: 1.35;
    word-break: break-word;
  }
  .own .bubble { background: var(--primary); color: var(--primary-text); border-bottom-right-radius: 4px; }
  .other .bubble { background: var(--bubble-other); color: var(--text); border-bottom-left-radius: 4px; }
  .msg-time { font-size: 10.5px; color: var(--muted); margin: 3px 4px 0; }
  .system-row { align-self: center; }
  .system-row .bubble {
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-style: italic;
    padding: 2px 8px;
  }
  .divider {
    align-self: center;
    font-size: 11px;
    color: var(--muted);
    margin: 2px 0;
  }
  .input-row {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  #msg {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 14.5px;
    outline: none;
  }
  #msg:focus { border-color: var(--primary); }
  #send {
    padding: 0 20px;
    background: var(--primary);
    color: var(--primary-text);
    border-radius: 999px;
  }

  @media (max-width: 600px) {
    body { padding: 0; align-items: stretch; }
    .app {
      max-width: 100%;
      height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    h1 { margin: 14px 16px 10px; flex-shrink: 0; }
    #login, #chat {
      flex: 1;
      min-height: 0;
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
      box-shadow: none;
    }
    #expiryBanner, #adminPanel { flex-shrink: 0; }
    #log { flex: 1; height: auto; min-height: 0; }
    .input-row { flex-shrink: 0; }
  }
</style>
</head>
<body>
<div class="app">
  <h1>💬 Chat efímero</h1>

  <div id="login" class="card">
    <input id="name" placeholder="tu nombre">
    <button id="join">entrar</button>
    <div id="loginError"></div>
  </div>

  <div id="chat" class="card">
    <div id="expiryBanner"></div>
    <div id="adminPanel">
      <div class="row"><b>Panel admin</b> · modo: <span id="modeLabel">-</span></div>
      <div class="row">
        <button id="toggleMode">cambiar a...</button>
        <button id="createInvite">generar invitación</button>
      </div>
      <div id="inviteList"></div>
      <div style="color:#8a7c2a; font-size:11px; margin-top:6px;">Guardá este link para volver como admin:</div>
      <a id="adminLink" href="#"></a>
    </div>
    <div id="log"></div>
    <div class="input-row">
      <input id="msg" placeholder="Escribí un mensaje...">
      <button id="send">Enviar</button>
    </div>
  </div>
</div>

  <script>
    function colorFor(name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      return 'hsl(' + (hash % 360) + ', 60%, 40%)';
    }

    const params = new URLSearchParams(location.search);
    const adminParam = params.get('admin');
    const inviteParam = params.get('invite');

    let ws;
    let currentMode = 'open';
    let expiryInterval = null;
    const log = document.getElementById('log');

    function startExpiryCountdown(expiresAt) {
      const banner = document.getElementById('expiryBanner');
      banner.style.display = 'block';
      if (expiryInterval) clearInterval(expiryInterval);

      function tick() {
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
          banner.textContent = '⏳ Este chat efímero ya debería haber desaparecido (cuenta temporal vencida). Puede cortarse en cualquier momento.';
          banner.style.background = '#fdd';
          banner.style.color = '#a00';
          clearInterval(expiryInterval);
          return;
        }
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        const label = mins + ':' + String(secs).padStart(2, '0');
        banner.textContent = '⏳ Chat efímero: se autodestruye en ~' + label + ' (aproximado, cuenta temporal de Cloudflare)';
        if (remainingMs < 5 * 60000) {
          banner.style.background = '#fee';
          banner.style.color = '#a40';
        }
      }
      tick();
      expiryInterval = setInterval(tick, 1000);
    }

    function connect(myName) {
      const loginError = document.getElementById('loginError');
      loginError.textContent = '';

      let wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
        '/room/test?name=' + encodeURIComponent(myName);
      if (adminParam) wsUrl += '&admin=' + encodeURIComponent(adminParam);
      if (inviteParam) wsUrl += '&invite=' + encodeURIComponent(inviteParam);
      ws = new WebSocket(wsUrl);

      let hasOpened = false;
      ws.onopen = () => {
        hasOpened = true;
        document.getElementById('login').style.display = 'none';
        document.getElementById('chat').style.display = 'flex';
      };

      ws.onclose = () => {
        if (!hasOpened) {
          loginError.textContent = 'No se pudo entrar: la sala es privada y necesitás un enlace de invitación válido (o el tuyo ya se usó).';
        }
      };

      function esc(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }

      function renderMsg(d) {
        const time = new Date(d.ts).toLocaleTimeString();
        if (d.system) {
          log.innerHTML += '<div class="msg-row system-row"><div class="bubble">' + esc(d.text) + '</div></div>';
          return;
        }
        const isOwn = d.name === myName;
        const side = isOwn ? 'own' : 'other';
        log.innerHTML +=
          '<div class="msg-row ' + side + '">' +
            (isOwn ? '' : '<div class="msg-name" style="color:' + colorFor(d.name) + '">' + esc(d.name) + '</div>') +
            '<div class="bubble">' + esc(d.text) + '</div>' +
            '<div class="msg-time">' + time + '</div>' +
          '</div>';
      }

      function updateModeUI() {
        document.getElementById('modeLabel').textContent = currentMode;
        document.getElementById('toggleMode').textContent = currentMode === 'open' ? 'cambiar a CERRADA' : 'cambiar a ABIERTA';
      }

      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.history) {
          if (d.history.length) {
            log.innerHTML += '<div class="divider">— historial —</div>';
            d.history.forEach(renderMsg);
            log.innerHTML += '<div class="divider">— ahora —</div>';
          }
        } else if (d.status) {
          currentMode = d.mode;
          if (d.createdTs && d.expiryMs) {
            startExpiryCountdown(d.createdTs + d.expiryMs);
          }
          if (d.isAdmin) {
            document.getElementById('adminPanel').style.display = 'block';
            updateModeUI();
            if (d.adminToken) {
              const link = location.origin + location.pathname + '?admin=' + d.adminToken;
              const a = document.getElementById('adminLink');
              a.href = link;
              a.textContent = link;
            }
          }
        } else if (d.inviteToken) {
          const link = location.origin + location.pathname + '?invite=' + d.inviteToken;
          const div = document.createElement('div');
          div.textContent = 'Invitación: ' + link;
          document.getElementById('inviteList').appendChild(div);
        } else {
          renderMsg(d);
          if (d.system && d.text.includes('sala ahora es')) {
            currentMode = d.text.includes('CERRADA') ? 'closed' : 'open';
            updateModeUI();
          }
        }
        log.scrollTop = log.scrollHeight;
      };
    }

    function join() {
      const n = document.getElementById('name');
      const myName = (n.value || 'anónimo').trim();
      if (!myName) return;
      localStorage.setItem('chatName', myName);
      connect(myName);
    }
    document.getElementById('join').onclick = join;
    document.getElementById('name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });

    function sendMsg() {
      const i = document.getElementById('msg');
      if (!i.value) return;
      ws.send(i.value);
      i.value = '';
    }
    document.getElementById('send').onclick = sendMsg;
    document.getElementById('msg').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMsg();
    });

    document.getElementById('toggleMode').onclick = () => {
      const next = currentMode === 'open' ? 'closed' : 'open';
      ws.send(JSON.stringify({ cmd: 'setMode', mode: next }));
    };
    document.getElementById('createInvite').onclick = () => {
      ws.send(JSON.stringify({ cmd: 'createInvite' }));
    };

    const saved = localStorage.getItem('chatName');
    if (saved) {
      document.getElementById('name').value = saved;
    }
  </script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/room/")) {
      const roomName = url.pathname.split("/")[2] || "default";
      const id = env.CHAT_ROOM.idFromName(roomName);
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }
    return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
