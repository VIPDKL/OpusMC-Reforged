'use strict';
// ---------------------------------------------------------------------------
// 联机 v3.1：PHP 信令(POST JSON) + WebRTC DataChannel，房主星型中继（2~20 人）
//   - 加入方式：填服务器 IP，格式 users.66ghz.com.MC2.<房间号>
//   - 非 trickle ICE：waitIce 收集完成后一次性提交 offer/answer（与 signal.php 匹配）
//   - 修复连接卡加载：P2P 超时检测、加载超时强制进入、回环保护
// ---------------------------------------------------------------------------
const DEFAULT_SIGNAL = 'api/signal.php';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const MAX_PLAYERS = 20;

// Uint16 数组 <-> base64（用于 DataChannel 传输区块数据）
function netB64FromU16(arr) {
  if (!arr || !arr.buffer) return '';
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function netU16FromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}

// 从 IP/房间号字符串中提取房间号
function extractRoomCode(input) {
  if (!input) return '';
  let s = String(input).trim();
  const m = s.match(/MC2\.([A-Za-z0-9]{4,12})/i);
  if (m) return m[1].toUpperCase();
  const m2 = s.match(/\/MC2\/([A-Za-z0-9]{4,12})/i);
  if (m2) return m2[1].toUpperCase();
  if (/^[A-Za-z0-9]{4,12}$/.test(s)) return s.toUpperCase();
  return '';
}

class Net {
  constructor(game) {
    this.game = game;
    this.role = null;            // 'host' | 'guest'
    this.room = null;            // 房间码（6位）
    this.code = null;            // 同 room，兼容
    this.token = null;
    this.slot = null;            // 游客槽位
    this.name = '玩家';
    this.hostName = '';
    this.max = 8;
    this.error = null;
    this.conns = new Map();      // host: slot -> {pc, dc, name, ready, spawn}
    this.hostPeer = null;        // guest side
    this.status = 'off';         // off | creating | waiting | joining | connecting | connected | error
    this.pollTimer = null;
    this.connectTimer = null;
    this._closed = false;
    this.tabOpen = false;
    this.tickCount = 0;
    this._applying = false;
    this.pendingSlots = new Set();
    this.dropping = false;
    this._hbTimer = null;
  }
  inGame() { return this.status === 'connected' || this.status === 'waiting'; }
  isHost() { return this.role === 'host'; }
  isOp() { return this.role === 'host' && this.status !== 'off'; }

  // ---- 信令 HTTP（POST JSON body，与 signal.php 匹配）----
  async api(action, payload) {
    const bases = ['api/signal.php', 'signal.php'];
    let lastErr = null;
    for (const base of bases) {
      try {
        const url = new URL(base + '?action=' + encodeURIComponent(action), location.href);
        const res = await fetch(url.toString(), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}), cache: 'no-store',
        });
        if (res.status === 403 || res.status === 404) { lastErr = new Error('信令接口被服务器拒绝（HTTP ' + res.status + '）'); continue; }
        let data = null;
        try { data = await res.json(); } catch (e) { }
        if (!data) { lastErr = new Error('服务器返回异常（HTTP ' + res.status + '）'); continue; }
        if (!data.ok) throw new Error(data.error || '服务器错误');
        return data;
      } catch (e) {
        if (e && e.message && (e.message.indexOf('服务器') >= 0 || e.message.indexOf('房间') >= 0 || e.message.indexOf('玩家') >= 0 || e.message.indexOf('人数') >= 0)) throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error('无法连接服务器（请确认主机支持 PHP、HTTPS 正常）');
  }

  fail(msg) {
    if (this.dropping) return;
    this.dropping = true;
    this.error = msg; this.status = 'error';
    this.closeAll();
    const ui = this.game.ui;
    ui.message('联机失败：' + msg, '#FF5555');
    console.warn('[net]', msg);
    if (this.game.state !== 'play' && !(ui.screen instanceof MultiplayerScreen)) ui.open(new MultiplayerScreen(this.game));
    this.dropping = false;
  }
  closeAll() {
    this._closed = true;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    for (const rec of this.conns.values()) this.closePeer(rec);
    this.conns.clear();
    this.closePeer(this.hostPeer);
    this.hostPeer = null;
    this.pendingSlots.clear();
  }
  closePeer(rec) {
    if (!rec) return;
    if (rec.dc) { try { rec.dc.onclose = null; rec.dc.close(); } catch (e) { } rec.dc = null; }
    if (rec.pc) { try { rec.pc.onconnectionstatechange = null; rec.pc.close(); } catch (e) { } rec.pc = null; }
    rec.ready = false;
  }
  disconnect() {
    if (this.role === 'host' && this.room && this.token) {
      this.api('leave', { code: this.room, token: this.token }).catch(() => { });
    } else if (this.role === 'guest' && this.room && this.token) {
      this.api('leave', { code: this.room, token: this.token }).catch(() => { });
    }
    this.closeAll();
    this.status = 'off'; this.role = null; this.room = null; this.code = null; this.token = null; this.slot = null;
    this.error = null; this.tabOpen = false;
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null; }
  }

  // ---- 房主 ----
  async host(opts) {
    this.closeAll();
    this._closed = false;
    this.role = 'host';
    this.name = (opts && opts.name) || '房主';
    this.max = Math.max(2, Math.min(20, (opts && opts.max) || 8));
    this.status = 'creating';
    try {
      const d = await this.api('create', { name: this.name, max: this.max });
      this.room = d.code; this.code = d.code; this.token = d.token; this.max = d.max || this.max;
      this.status = 'waiting';
      this.game.ui.message('房间已创建，房间码：' + this.room, '#55FF55');
      this.game.ui.message('加入IP：users.66ghz.com.MC2.' + this.room, '#55FFFF');
      this.hostPoll();
      if (!this._hbTimer) {
        this._hbTimer = setInterval(() => {
          if (this.role !== 'host' || this.status !== 'connected') return;
          const g = this.game;
          if (!g || !g.player) return;
          this.broadcast({ type: 'pos', id: 'host', pos: g.player.pos, yaw: g.player.yaw, pitch: g.player.pitch });
        }, 2000);
      }
    } catch (e) { this.fail(e.message); }
  }
  hostPoll() {
    if (this.role !== 'host' || this.status === 'error' || this.status === 'off') return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(async () => {
      if (this.role !== 'host' || this.status === 'error' || this.status === 'off') return;
      try {
        const d = await this.api('pollHost', { code: this.room, token: this.token });
        this.max = d.max || this.max;
        const seen = new Set();
        for (const g of d.guests || []) {
          seen.add(g.slot);
          let rec = this.conns.get(g.slot);
          if (!rec && !this.pendingSlots.has(g.slot)) {
            if (this.conns.size >= this.max - 1) continue;
            this.pendingSlots.add(g.slot);
            this.createHostPeer(g.slot, g.name);
          } else if (rec && g.answer && !rec.answerApplied && rec.pc) {
            rec.answerApplied = true;
            rec.pc.setRemoteDescription(g.answer).catch(() => this.retryPeer(rec));
          } else if (rec && !g.answer && !rec.answerApplied && rec.retries < 2 && performance.now() - rec.createdAt > 12000) {
            this.retryPeer(rec);
          }
        }
        for (const [slot, rec] of this.conns) {
          if (!seen.has(slot) && rec.ready) this.removeGuest(slot);
        }
      } catch (e) {
        if (String(e.message).indexOf('不存在') >= 0) this.fail('房间已过期，请重新创建');
      }
      this.hostPoll();
    }, 900);
  }
  async createHostPeer(slot, guestName) {
    const rec = { slot, name: guestName, pc: null, dc: null, ready: false, spawn: null, yaw: 0, retries: 0, createdAt: performance.now(), answerApplied: false };
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      rec.pc = pc;
      this.wirePc(rec);
      const dc = pc.createDataChannel('mc', { ordered: true });
      this.bindChannel(rec, dc);
      this.conns.set(slot, rec);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitIce(pc);
      await this.api('offer', { code: this.room, token: this.token, slot: slot, offer: this.desc(pc) });
    } catch (e) {
      console.warn('[net] 创建对等连接失败', e);
      this.conns.delete(slot);
      this.pendingSlots.delete(slot);
    }
  }
  async retryPeer(rec) {
    if (!rec || rec.retries >= 2) return;
    rec.retries++;
    rec.answerApplied = false;
    this.closePeer(rec);
    this.conns.delete(rec.slot);
    this.pendingSlots.delete(rec.slot);
    this.createHostPeer(rec.slot, rec.name);
  }
  desc(pc) { const d = pc.localDescription; return { type: d.type, sdp: d.sdp }; }
  waitIce(pc) {
    return new Promise(res => {
      if (pc.iceGatheringState === 'complete') return res();
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); res(); } };
      const timer = setTimeout(finish, 3500);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') finish(); });
      pc.addEventListener('icecandidate', (e) => { if (!e.candidate) finish(); });
    });
  }
  wirePc(rec) {
    const pc = rec.pc;
    pc.onconnectionstatechange = () => {
      if (!rec.pc) return;
      const s = pc.connectionState;
      if (s === 'failed') {
        if (this.role === 'host') this.retryPeer(rec);
        else this.fail('P2P 连接失败（建议双方改用同一 Wi-Fi 或手机热点）');
      } else if (s === 'disconnected') {
        if (this.role === 'guest') this.fail('P2P 连接已断开');
      }
    };
  }
  bindChannel(rec, dc) {
    rec.dc = dc;
    dc.onopen = () => {
      clearTimeout(this.connectTimer);
      rec.ready = true;
      this.pendingSlots.delete(rec.slot);
      if (this.role === 'host') {
        if (this.status === 'waiting' || this.status === 'creating') this.status = 'connected';
        this.game.ui.message(rec.name + ' 加入了房间', '#55FFFF');
        this.sendInit(rec);
      } else {
        this.status = 'connected';
        this.game.ui.message('联机成功！房主：' + this.hostName, '#55FFFF');
        this.api('joined', { code: this.room, token: this.token, slot: this.slot }).catch(() => { });
        this.sendTo(rec, { type: 'hello', name: this.name });
      }
    };
    dc.onmessage = (ev) => {
      this.lastReceive = Date.now();
      if (this.role === 'host') this.onHostMessage(rec.slot, ev.data);
      else this.onGuestMessage(ev.data);
    };
    dc.onclose = () => {
      if (this.role === 'host' && this.conns.get(rec.slot) === rec) this.removeGuest(rec.slot);
      else if (this.role === 'guest') this.fail('房主已断开连接');
    };
    dc.onerror = () => { };
  }
  sendTo(rec, obj) {
    if (rec && rec.dc && rec.dc.readyState === 'open') {
      try { rec.dc.send(JSON.stringify(obj)); return true; } catch (e) { }
    }
    return false;
  }
  broadcast(obj, exceptSlot) {
    for (const rec of this.conns.values()) if (rec.ready && rec.slot !== exceptSlot) this.sendTo(rec, obj);
  }
  // 模组网络：房主广播给所有游客，游客发给房主
  sendMod(channel, data) {
    if (!this.inGame()) return false;
    if (typeof channel !== 'string' || !/^[a-zA-Z0-9_:-]{1,48}$/.test(channel)) return false;
    const msg = { type: 'mod', channel: channel, data: data };
    let raw;
    try { raw = JSON.stringify(msg); } catch (e) { return false; }
    if (raw.length > 32768) return false;
    if (this.role === 'host') this.broadcast(msg);
    else if (this.hostPeer) this.sendTo(this.hostPeer, msg);
    return true;
  }

  sendInit(rec) {
    const g = this.game, w = g.world;
    const edits = new Map();
    if (w.savedChunks) for (const [k, rec0] of w.savedChunks) edits.set(k, rec0);
    for (const ch of w.chunks.values()) if (ch.modified) edits.set(ckey(ch.cx, ch.cz), encodeChunk(ch));
    const list = [];
    for (const [k, rec0] of edits) {
      const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
      list.push({ cx: cx, cz: cz, v: rec0.v || 0, b: netB64FromU16(rec0.b), m: netB64FromU16(rec0.m) });
    }
    const mods = g.mods ? g.mods.activeIds() : [];
    const payloads = g.mods ? g.mods.exportPayload(mods) : [];
    const spawn = (g.spawn || (g.player && g.player.spawn) || [0, 80, 0]).slice();
    const meta = {
      seed: w.seed, mode: g.mode, time: g.worldTime,
      spawn: spawn, mods: mods, modPayloads: payloads,
      dimension: g.dimension || 'overworld',
    };
    this.sendTo(rec, { type: 'init', meta, totalEdits: list.length });
    const batchSize = 40;
    for (let i = 0; i < list.length; i += batchSize) {
      this.sendTo(rec, { type: 'initEdits', list: list.slice(i, i + batchSize), total: list.length, got: Math.min(i + batchSize, list.length) });
    }
    if (list.length === 0) this.sendTo(rec, { type: 'initEdits', list: [], total: 0, got: 0 });
  }
  onHostMessage(slot, data) {
    if (typeof data !== 'string' || data.length > 65536) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const rec = this.conns.get(slot);
    if (!rec) return;
    const g = this.game;
    switch (msg.type) {
      case 'hello':
        rec.name = String(msg.name || rec.name || '玩家').slice(0, 16);
        break;
      case 'ready':
        rec.ready = true;
        rec.spawn = msg.pos || (g.spawn || (g.player && g.player.spawn) || [0, 80, 0]).slice();
        rec.name = msg.name || rec.name;
        this.sendInit(rec);
        this.broadcast({ type: 'playerJoin', id: slot, name: rec.name, pos: rec.spawn }, slot);
        for (const [id, r] of this.conns) {
          if (id !== slot && r.ready) this.sendTo(rec, { type: 'playerJoin', id, name: r.name, pos: r.spawn });
        }
        break;
      case 'pos':
        rec.spawn = msg.pos;
        rec.yaw = msg.yaw;
        this.broadcast({ type: 'pos', id: slot, pos: msg.pos, yaw: msg.yaw, pitch: msg.pitch }, slot);
        break;
      case 'chat':
        this.broadcast({ type: 'chat', name: rec.name, text: String(msg.text || '').slice(0, 200) });
        g.ui.message('<' + String(rec.name || '玩家').slice(0, 16) + '> ' + String(msg.text || '').slice(0, 200), '#FFFFFF');
        break;
      case 'break':
        this._applying = true;
        try { g.breakBlock(msg.x, msg.y, msg.z, false, true); } catch (e) { }
        this._applying = false;
        this.broadcast({ type: 'break', x: msg.x, y: msg.y, z: msg.z }, slot);
        break;
      case 'place':
        this._applying = true;
        try { g.world.setBlock(msg.x, msg.y, msg.z, msg.id, msg.meta || 0); g.flushMesh(); } catch (e) { }
        this._applying = false;
        this.broadcast({ type: 'place', x: msg.x, y: msg.y, z: msg.z, id: msg.id, meta: msg.meta }, slot);
        break;
      case 'respawn':
        rec.spawn = (g.spawn || (g.player && g.player.spawn) || [0, 80, 0]).slice();
        this.sendTo(rec, { type: 'respawn', pos: rec.spawn });
        break;
      case 'mod':
        if (msg.channel && g.mods) g.mods.onNetwork(String(msg.channel), msg.data, { role: 'guest', slot: slot, name: rec.name });
        break;
    }
  }
  removeGuest(slot) {
    const rec = this.conns.get(slot);
    if (!rec) return;
    this.closePeer(rec);
    this.conns.delete(slot);
    this.pendingSlots.delete(slot);
    this.broadcast({ type: 'playerLeave', id: slot });
    if (rec.name) this.game.ui.message(rec.name + ' 离开了', '#AAAAAA');
  }

  // ---- 游客 ----
  async join(ipOrRoom, name) {
    this.closeAll();
    this._closed = false;
    this.role = 'guest';
    this.name = name || '玩家';
    const room = extractRoomCode(ipOrRoom);
    if (!room) { this.fail('无法从IP中识别房间号，请检查格式（如 users.66ghz.com.MC2.ABCDEF）'); return; }
    this.room = room; this.code = room;
    this.status = 'joining';
    try {
      const d = await this.api('join', { code: room, name: this.name });
      this.token = d.token; this.slot = d.slot; this.hostName = d.hostName || '房主';
      this.max = d.max || this.max;
      this.status = 'connecting';
      let offer = null;
      for (let i = 0; i < 30 && !offer; i++) {
        const p = await this.api('pollGuest', { code: room, token: this.token });
        this.hostName = p.hostName || this.hostName;
        this.max = p.max || this.max;
        if (p.offer) offer = p.offer;
        else await new Promise(r => setTimeout(r, 700));
      }
      if (!offer) throw new Error('等待房主响应超时（房间码是否正确？房主是否还在等待？）');
      const rec = { slot: 0, name: this.hostName, host: true, pc: null, dc: null, ready: false, spawn: null, yaw: 0, retries: 0, createdAt: performance.now() };
      this.hostPeer = rec;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      rec.pc = pc;
      this.wirePc(rec);
      pc.ondatachannel = (ev) => this.bindChannel(rec, ev.channel);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitIce(pc);
      await this.api('answer', { code: room, token: this.token, slot: this.slot, answer: this.desc(pc) });
      clearTimeout(this.connectTimer);
      this.connectTimer = setTimeout(() => {
        if (this.status !== 'connected') this.fail('P2P 连接失败（网络可能限制 P2P，请换 Wi-Fi 或热点重试）');
      }, 30000);
    } catch (e) { this.fail(e.message); }
  }
  onGuestMessage(data) {
    if (typeof data !== 'string' || data.length > 65536) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const g = this.game;
    switch (msg.type) {
      case 'init':
        this.onInit(msg.meta, msg.totalEdits);
        break;
      case 'initEdits':
        this.onInitEdits(msg);
        break;
      case 'pos':
        g.remotePlayers.set(msg.id, { pos: msg.pos, yaw: msg.yaw, pitch: msg.pitch, name: g.remoteNames.get(msg.id) || '玩家' });
        break;
      case 'playerJoin':
        g.remoteNames.set(msg.id, msg.name);
        g.remotePlayers.set(msg.id, { pos: msg.pos, name: msg.name });
        g.ui.message(msg.name + ' 加入了游戏', '#55FFFF');
        break;
      case 'playerLeave':
        g.remotePlayers.delete(msg.id);
        g.remoteNames.delete(msg.id);
        break;
      case 'chat':
        g.ui.message('<' + String(msg.name || '玩家').slice(0, 16) + '> ' + String(msg.text || '').slice(0, 200), '#FFFFFF');
        break;
      case 'break':
        this._applying = true;
        try { g.world.setBlock(msg.x, msg.y, msg.z, 0, 0); g.flushMesh(); } catch (e) { }
        this._applying = false;
        break;
      case 'place':
        this._applying = true;
        try { g.world.setBlock(msg.x, msg.y, msg.z, msg.id, msg.meta || 0); g.flushMesh(); } catch (e) { }
        this._applying = false;
        break;
      case 'time':
        g.worldTime = msg.time;
        g.weather = msg.weather;
        g.rainTarget = msg.rain;
        break;
      case 'respawn':
        g.player.pos = msg.pos.slice();
        g.player.vel = [0, 0, 0];
        break;
      case 'mod':
        if (msg.channel && g.mods) g.mods.onNetwork(String(msg.channel), msg.data, { role: 'host' });
        break;
      case 'kick':
        g.ui.message('你被移出房间：' + String(msg.reason || '房主关闭了房间').slice(0, 100), '#FF5555');
        this.disconnect();
        if (g.ui) g.ui.open(new TitleScreen(g));
        break;
    }
  }
  onInit(meta, totalEdits) {
    const g = this.game;
    g.ui.open(new LoadingScreen(g, '正在同步房主的世界…（0/' + (totalEdits || 0) + '）'));
    g.worldMeta = {
      id: 'mp-' + this.room, name: meta.name || '联机世界', seed: meta.seed, mode: meta.mode,
      opts: { type: 'default', structures: true }, flat: false, time: meta.time || 1000,
      spawn: meta.spawn, multiplayer: true,
    };
    g.setupWorld(meta.seed, { type: 'default', structures: true });
    g.world.flat = false;
    g.world.savedChunks = new Map();
    g._initEditTotal = totalEdits || 0;
    g._initEditGot = 0;
    g.mode = meta.mode || 'survival';
    g.worldTime = meta.time || 1000;
    g.dimension = meta.dimension || 'overworld';
    g.adv = {}; g.stats = { kills: 0, placed: 0, mined: 0 };
    g.tutorial = -1; g.tutStat = { moved: 0 };
    const sp = meta.spawn || g.findSpawn();
    g.spawn = sp;
    const p = g.player = new Player(g, sp[0] + 0.5, sp[1], sp[2] + 0.5);
    p.spawn = sp;
    p.needsGround = true;
    if (g.mode === 'creative') g.giveCreativeKit();
    g.pendingMobs = [];
    if (g.mods && meta.mods) g.mods.applyHostMods(meta.mods, meta.modPayloads || []);
    g.dirtySaved = new Set();
    g.state = 'loading';
    g.loadStart = performance.now();
    if (g._initEditTotal === 0) this.finishInit();
  }
  onInitEdits(msg) {
    const g = this.game;
    g._initEditTotal = msg.total || g._initEditTotal;
    g._initEditGot = msg.got || (g._initEditGot + (msg.list || []).length);
    for (const e of msg.list || []) {
      try {
        g.world.savedChunks.set(ckey(e.cx, e.cz), { v: e.v || 0, b: netU16FromB64(e.b), m: netU16FromB64(e.m) });
      } catch (err) { console.warn('[net] bad chunk', err); }
    }
    if (g.ui.screen && g.ui.screen instanceof LoadingScreen) g.ui.screen.text = '正在同步房主的世界…（' + g._initEditGot + '/' + g._initEditTotal + '）';
    if (g._initEditGot >= g._initEditTotal) this.finishInit();
  }
  finishInit() {
    const g = this.game;
    if (g._initFinished) return;
    g._initFinished = true;
    g._lastCC = null;
    g.genQueue = [];
    g.state = 'loading';
    g.loadStart = performance.now();
    g._loadTimeout = setTimeout(() => {
      if (g.state === 'loading') {
        console.warn('[net] load timeout, forcing play');
        g.state = 'play';
        g.ui.close();
      }
    }, 60000);
  }

  // ---- game 生命周期挂钩 ----
  tick() {
    if (!this.inGame() || !this.game.player) return;
    this.tickCount++;
    const g = this.game;
    if (this.tickCount % 3 === 0) {
      const st = { type: 'pos', pos: g.player.pos, yaw: g.player.yaw, pitch: g.player.pitch };
      if (this.role === 'host') { st.id = 'host'; this.broadcast(st); }
      else this.sendTo(this.hostPeer, st);
    }
    if (this.role === 'host' && this.tickCount % 40 === 0) {
      this.broadcast({ type: 'time', time: g.worldTime, weather: g.weather, rain: g.rainTarget });
    }
  }
  onChunkLoaded(cx, cz) { }
  onBlockChanged(x, y, z, old, id, oldMeta) {
    if (!this.inGame() || this._applying) return;
    const meta = this.game.world.getMeta(x, y, z);
    const msg = { type: 'block', x, y, z, id, meta };
    if (this.role === 'host') this.broadcast(msg);
    else this.sendTo(this.hostPeer, msg);
  }
  say(text) {
    const g = this.game;
    if (!this.inGame()) { g.ui.message('<玩家> ' + text); return; }
    g.ui.message('<' + this.name + '> ' + text);
    const msg = { type: 'chat', name: this.name, text: String(text).slice(0, 200) };
    if (this.role === 'host') this.broadcast(msg);
    else this.sendTo(this.hostPeer, msg);
  }
  leave(silent) {
    this.disconnect();
    if (!silent) this.game.ui.message('已退出联机', '#AAAAAA');
  }
  drawRemote(a, env) {
    if (!this.inGame() || !this.game.world) return;
    const r = this.game.renderer, g = this.game;
    const drawSteve = (pos, yaw) => {
      const m = M4.create();
      M4.translate(m, pos[0], pos[1], pos[2]);
      M4.rotY(m, yaw || 0);
      M4.scale(m, 0.9375, 0.9375, 0.9375);
      try { r.drawModel('steve', 'steve', m, { head: { ry: 0 } }, [1, 0], env, {}); } catch (e) { }
    };
    if (this.role === 'host') {
      for (const rec of this.conns.values()) {
        if (!rec.ready || !rec.spawn) continue;
        drawSteve(rec.spawn, rec.yaw || 0);
      }
    } else {
      for (const rp of g.remotePlayers.values()) drawSteve(rp.pos, rp.yaw || 0);
    }
  }
  drawHud(ui) {
    if (this.status === 'off') return;
    const g = this.game;
    if (!g.player) return;
    const c = ui.ctx;
    if (this.room) {
      const s = '房间 ' + this.room;
      const w = Font.width(s);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(1, 1, w + 6, 12);
      Font.draw(c, s, 3, 3, '#55FFFF', false);
      const ip = 'IP: users.66ghz.com.MC2.' + this.room;
      const iw = Font.width(ip);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(1, 14, iw + 6, 12);
      Font.draw(c, ip, 3, 16, '#55FFFF', false);
    }
    if (this.status === 'connecting') Font.draw(c, '正在连接联机…', 3, 28, '#FFFF55', false);
    else if (this.status === 'error') Font.draw(c, '联机错误：' + (this.error || ''), 3, 28, '#FF5555', false);
  }
  playerCount() {
    if (this.role === 'host') return this.conns.size + 1;
    if (this.role === 'guest') return this.game.remotePlayers.size + 1;
    return 1;
  }
}
