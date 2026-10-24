'use strict';
// ---------------------------------------------------------------------------
// 模组系统 v4：官方模组 + 本地模组 + 公开模组库 + 内容注册表
//   - 模组类型 side: 'client' | 'server' | 'both'（作者自行设置）
//     · client：仅客户端生效，权限极大，可改世界生成 / 实体渲染 / 菜单标题 / HUD
//     · server：仅联机时在房主端生效，权限严格受限，不能改渲染与世界生成
//     · both：两端都生效（默认）
//   - 配置菜单：模组作者声明 configSchema，自动生成配置界面，值持久化
//   - 高权限客户端 API：OpusMods.game 直接暴露渲染器、世界、菜单钩子
// ---------------------------------------------------------------------------
const OFFICIAL_FALLBACK = [
  { id: 'chain-mining', name: '连锁挖矿', author: 'OpusMC', version: '2.0.0', side: 'both',
    description: '按 U 开关；可在模组配置里调范围、数量、石头3×3、矿脉连锁。', file: 'chain-mining.js', official: true },
  { id: 'mod-info', name: '显示所有模组', author: 'OpusMC', version: '2.0.0', side: 'client',
    description: '按 M 打开模组列表，显示名称/作者/版本/类型/配置。', file: 'mod-info.js', official: true },
];

const MOD_SIDES = {
  client: { label: '客户端', color: '#55FFFF', desc: '仅本机生效，可改渲染/世界生成/菜单' },
  server: { label: '服务端', color: '#FFAA00', desc: '仅房主/联机生效，权限受限' },
  both:   { label: '双端',   color: '#55FF55', desc: '客户端与服务端均生效' },
};

class ModManager {
  constructor(game) {
    this.game = game;
    this.mods = new Map();
    this.loadError = null;
    this.index = [];
    this.enabled = new Set();
    this.disabled = new Set();
    this.userMods = [];
    this.loaded = false;
    this.loading = false;
    this.busy = false;
    this.loadedIds = new Set();
    this.hooks = new Map();
    this.hud = new Map();
    this.configs = {};
    // ---- v4 注册表 ----
    this.commands = new Map();
    this.keybinds = new Map();
    this.netChannels = new Map();
    this.lootHooks = new Map();
    this.ores = [];
    this.features = [];
    this._assetRefreshTimer = null;
    this._suppressAssetRefresh = false;
    this.apiVersion = '4.0';
  }
  on(name, fn, owner) { if (!this.hooks.has(name)) this.hooks.set(name, []); this.hooks.get(name).push({ fn: fn, owner: owner || null }); }
  // 可取消事件：回调返回 false 或 event.cancel = true 即取消
  fireCancelable(name, ev, ...args) {
    const list = this.hooks.get(name);
    if (!list) return true;
    for (const item of list) {
      if (!this._alive(item.owner)) continue;
      this._hookModId = item.owner;
      try { if (item.fn(this.safe(), ev, ...args) === false) ev.cancel = true; }
      catch (e) { console.warn('[mod event]', name, e); }
      finally { this._hookModId = null; }
      if (ev.cancel) return false;
    }
    return true;
  }
  scheduleAssetRefresh() {
    if (this._suppressAssetRefresh || !this.game.renderer) return;
    clearTimeout(this._assetRefreshTimer);
    this._assetRefreshTimer = setTimeout(() => {
      this._assetRefreshTimer = null;
      if (this.game && this.game.refreshModAssets) this.game.refreshModAssets();
    }, 80);
  }
  // 模组世界生成：矿物 / 自定义特征
  generateChunk(world, ch, cx, cz) {
    const rng = RNG(hashStr('modgen:' + world.seed + ':' + cx + ':' + cz));
    for (const ore of this.ores) {
      if (!this._alive(ore.owner)) continue;
      const bid = BID[ore.block];
      if (bid === undefined) continue;
      for (let n = 0; n < (ore.count || 4); n++) {
        let x = rng() * 16, y = (ore.minY ?? 0) + rng() * Math.max(1, (ore.maxY ?? 64) - (ore.minY ?? 0)), z = rng() * 16;
        const s = (ore.size || 6) * (0.6 + rng() * 0.6);
        for (let i = 0; i < s; i++) {
          const ix = x | 0, iy = y | 0, iz = z | 0;
          if (ix >= 0 && ix < 16 && iz >= 0 && iz < 16 && iy > 0 && iy < HEIGHT) {
            const k = (iy << 8) | (iz << 4) | ix;
            const cur = ch.blocks[k];
            if (cur === 1 || cur === 75 || cur === 185 || cur === 184) ch.blocks[k] = bid;
          }
          x += rng() * 2 - 1; y += rng() * 2 - 1; z += rng() * 2 - 1;
        }
      }
    }
    for (const f of this.features) {
      if (!this._alive(f.owner)) continue;
      try {
        if (rng() < (f.chance || 0.1)) f.place(this.safe(), world, ch, cx, cz, rng);
      } catch (e) { console.warn('[mod feature]', e); }
    }
    this.fire('chunkGenerate', ch, cx, cz);
    this.fire('worldGen', ch, cx, cz);
    this.fire('chunkGenerated', ch);
    ch.recount();
    ch.dirty = 0xFFFF;
  }
  getLoot(id, meta, tool, x, y, z) {
    for (const [key, item] of this.lootHooks) {
      if (BID[key] !== id || !this._alive(item.owner)) continue;
      const prev = this._hookModId; this._hookModId = item.owner;
      try { return item.fn(this.safe(), { id, meta, tool, x, y, z }); }
      catch (e) { console.warn('[mod loot]', e); }
      finally { this._hookModId = prev; }
    }
    return null;
  }
  onKeybind(code) {
    for (const [id, kb] of this.keybinds) {
      if (kb.code !== code || !this._alive(kb.owner)) continue;
      const prev = this._hookModId; this._hookModId = kb.owner;
      try { kb.run(this.safe()); } catch (e) { console.warn('[mod keybind]', id, e); }
      finally { this._hookModId = prev; }
    }
  }
  onNetwork(channel, data, from) {
    const item = this.netChannels.get(channel);
    if (!item || !this._alive(item.owner)) return false;
    const prev = this._hookModId; this._hookModId = item.owner;
    try { item.handler(this.safe(), data, from); return true; }
    catch (e) { console.warn('[mod network]', channel, e); return false; }
    finally { this._hookModId = prev; }
  }
  _alive(owner) { if (!owner) return true; const m = this.mods.get(owner); return !!(m && m.enabled); }
  fire(name, ...args) {
    const list = this.hooks.get(name);
    if (!list) return;
    for (const item of list) {
      if (!this._alive(item.owner)) continue;
      this._hookModId = item.owner; try { item.fn(this.safe(), ...args); } catch (e) { console.warn('[mod hook]', name, e); } finally { this._hookModId = null; }
    }
  }
  addHud(id, draw, owner) { this.hud.set(id, { fn: draw, owner: owner || null }); }
  removeHud(id) { this.hud.delete(id); }
  drawHud(ui, game) {
    for (const [id, item] of this.hud) {
      if (!this._alive(item.owner)) continue;
      try { item.fn(ui, game); } catch (e) { console.warn('[mod hud]', id, e); }
    }
  }
  sizeText(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }
  fileInfo(id) {
    const m = this.mods.get(id);
    if (!m) return null;
    const code = m.code || '';
    let size = code.length;
    try { size = new TextEncoder().encode(code).length; } catch (e) { }
    let url = null;
    if (m.official && m.file) { try { url = new URL('mods/' + m.file, location.href).href; } catch (e) { } }
    return {
      id: id, name: m.name || id, official: !!m.official,
      file: m.official ? m.file : (m.id + '.js'),
      path: m.official ? ('mods/' + m.file) : ('浏览器本地存储 mcjs-mod-user / ' + m.id + '.js'),
      size: size, url: url,
    };
  }
  loadConfigs() {
    try { this.configs = JSON.parse(localStorage.getItem('mcjs-mod-configs') || '{}'); } catch (e) { this.configs = {}; }
  }
  saveConfigs() {
    try { localStorage.setItem('mcjs-mod-configs', JSON.stringify(this.configs)); } catch (e) { }
  }
  getConfig(id, key, def) {
    const c = this.configs[id];
    if (!c || c[key] === undefined) return def;
    return c[key];
  }
  setConfig(id, key, val) {
    if (!this.configs[id]) this.configs[id] = {};
    this.configs[id][key] = val;
    this.saveConfigs();
    const m = this.mods.get(id);
    if (m && m.onConfigChange) { try { m.onConfigChange(this.safe(), key, val); } catch (e) { console.warn('[mod cfg]', id, e); } }
  }
  resetConfig(id) { delete this.configs[id]; this.saveConfigs(); }
  isActiveHere(mod) {
    const side = mod.side || 'both';
    if (side === 'both' || side === 'client') return true;
    if (side === 'server') {
      return !!(this.game.net && this.game.net.inGame && this.game.net.inGame() && this.game.net.role === 'host');
    }
    return true;
  }
  active() { return [...this.mods.values()].filter(m => m.enabled && this.isActiveHere(m)); }
  activeIds() { return this.active().map(m => m.id); }

  playerApi() {
    const g = this.game, m = this;
    const P = () => g.player;
    return {
      get name() { return m.game.playerName || '玩家'; },
      get health() { return P().health; }, get maxHealth() { return P().maxHealth; },
      get food() { return P().food; }, get saturation() { return P().saturation; },
      get xp() { return P().xp; }, get level() { return g.xpLevel(); },
      get pos() { return P().pos.slice(); }, get yaw() { return P().yaw; }, get pitch() { return P().pitch; },
      get mode() { return g.mode; }, get flying() { return P().flying; }, get onGround() { return P().onGround; },
      inventory() { return P().inv.slots.map(s => s ? { key: ITEMS[s.id] ? ITEMS[s.id].key : '?', count: s.count, dmg: s.dmg || 0 } : null); },
      count(key) { const id = ITEM_KEY[key]; if (id === undefined) return 0; return P().inv.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0); },
      lookAt(x, y, z) {
        const p = P(), dx = x - p.pos[0], dy = y - (p.pos[1] + 1.62), dz = z - p.pos[2];
        p.yaw = Math.atan2(-dx, -dz);
        p.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001);
      },
      setLook(yaw, pitch) { const p = P(); p.yaw = yaw; p.pitch = clamp(pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001); },
      move(fwd, strafe, ticks) { g.modInput = { fwd: clamp(fwd || 0, -1, 1), strafe: clamp(strafe || 0, -1, 1), until: g.tickCount + (ticks || 1) }; },
      jump() { const p = P(); if (p.onGround) { p.vel[1] = 0.42; p.onGround = false; } },
      attackNearest(range) { return m.attackNearest(range || 4); },
      attack(entity) { if (!entity || entity.dead) return false; g.attack(entity); return true; },
      use() { try { g.use(); return true; } catch (e) { return false; } },
      breakBlockAt(x, y, z) { return m.breakAt(x, y, z); },
      placeBlockAt(x, y, z, key) { return m.placeAt(x, y, z, key); },
      setHealth(v) { P().health = Math.max(0, Math.min(P().maxHealth, +v || 0)); return P().health; },
      heal(n) { P().health = Math.min(P().maxHealth, P().health + (+n || 0)); return P().health; },
      damage(n, type) { P().hurt(+n || 0, { type: type || 'magic' }); return P().health; },
      addXp(n) { g.addXp(+n || 0); return P().xp; },
      give(key, n) {
        const id = ITEM_KEY[String(key).replace('minecraft:', '')];
        if (id === undefined) return false;
        let left = Math.max(1, Math.min(64 * 36, +n || 1));
        while (left > 0) { const k = Math.min(left, maxStack(id)); const r = P().inv.add({ id, count: k, dmg: 0 }); if (r) g.dropFromPlayer({ id, count: r, dmg: 0 }); left -= k; }
        return true;
      },
      teleport(x, y, z) { P().pos = [+x, +y, +z]; P().prev = [...P().pos]; P().vel = [0, 0, 0]; P().fallDist = 0; return true; },
      setGameMode(mode) { g.setMode(mode === 'creative' ? 'creative' : 'survival'); return g.mode; },
      sendMessage(text, color) { g.ui.message(String(text), color); },
      get held() { const h = P().inv.held; return h ? { key: ITEMS[h.id] ? ITEMS[h.id].key : '?', count: h.count, dmg: h.dmg || 0 } : null; },
      selectSlot(i) { if (i >= 0 && i <= 8) P().inv.sel = i; },
      dropSelected() {
        const p = P(), h = p.inv.held;
        if (!h) return false;
        g.dropFromPlayer({ ...h, count: 1 }); h.count--;
        if (!h.count) p.inv.slots[p.inv.sel] = null;
        return true;
      },
      swing() { P().swingT = 6; },
    };
  }
  worldApi() {
    const g = this.game;
    return {
      get seed() { return g.world.seed; }, get time() { return g.worldTime; }, get timeOfDay() { return g.dayTime(); },
      get weather() { return g.weather; },
      getBlock(x, y, z) { return g.world.getBlock(x, y, z); },
      getBlockKey(x, y, z) { const b = BLOCKS[g.world.getBlock(x, y, z)]; return b ? b.key : null; },
      setBlock(x, y, z, key, meta) {
        const id = typeof key === 'number' ? key : BID[String(key).replace('minecraft:', '')];
        if (id === undefined || !BLOCKS[id]) return false;
        const ok = g.world.setBlock(+x, +y, +z, id, meta || 0, 1);
        if (ok) g.flushMesh(+x, +y, +z);
        return ok;
      },
      setMeta(x, y, z, meta) { return g.world.setMeta(+x, +y, +z, +meta || 0); },
      getMeta(x, y, z) { return g.world.getMeta(x, y, z); },
      getChunk(cx, cz) { return g.world.getChunk(cx, cz); },
      spawnParticle(type, x, y, z, vx, vy, vz, opts) { return g.particles.spawn(type, x, y, z, vx || 0, vy || 0, vz || 0, opts); },
      playSound(name, x, y, z, volume) {
        const pos = [x, y, z];
        const fn = { click: 'click', pop: 'pop', explode: 'explode', hurt: 'hurt', splash: 'splash', levelup: 'levelup', toast: 'toast', fizz: 'fizz', door: 'door', bow: 'bow' }[name];
        try { if (fn && Sound[fn]) Sound[fn](pos); else if (Sound.block) Sound.block(name, 'stone', pos); } catch (e) { }
      },
      explode(x, y, z, power, source) { return g.explode(+x, +y, +z, +power || 1, source || null, false); },
      get spawn() { return (g.spawn || (g.player && g.player.spawn) || [0, 80, 0]).slice(); },
      setTime(t) { g.worldTime = Math.floor(+t || 0); return g.worldTime; },
      setWeather(rain) { g.rainTarget = rain ? 1 : 0; g.weather = rain ? 1 : 0; return g.weather; },
      get isRaining() { return g.weather > 0.3; },
      get dimension() { return g.dimension || 'overworld'; },
      getLight(x, y, z) { const l = g.world.getLight(x, y, z); return { sky: l >> 4, block: l & 15 }; },
      biomeAt(x, z) { return BIOMES[g.world.biomeOf(g.world.column(x, z))]; },
      isDay() { return g.isDay(); },
      isLoaded(x, z) { return g.world.isLoaded(x, z); },
      entities() { return g.entities.filter(e => !e.dead).map(e => ({ id: e.id, type: e.type || 'item', pos: e.pos.slice(), health: e.health, hostile: !!(e.T && e.T.hostile) })); },
      nearestEntity(range) {
        let best = null, bd = range || 8;
        for (const e of g.entities) {
          if (e.dead || e === g.player) continue;
          const d = Math.hypot(e.pos[0] - g.player.pos[0], e.pos[1] - g.player.pos[1], e.pos[2] - g.player.pos[2]);
          if (d < bd) { bd = d; best = e; }
        }
        return best;
      },
      spawnMob(type, x, y, z) { if (!MOB_TYPES[type]) return null; const e = new Mob(g, type, x, y, z); g.addEntity(e); return e; },
    };
  }
  attackNearest(range) {
    const g = this.game, p = g.player;
    let best = null, bd = range || 4;
    for (const e of g.entities) {
      if (e.dead || !(e instanceof Mob)) continue;
      const d = Math.hypot(e.pos[0] - p.pos[0], e.pos[1] - p.pos[1], e.pos[2] - p.pos[2]);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return null;
    p.yaw = Math.atan2(-(best.pos[0] - p.pos[0]), -(best.pos[2] - p.pos[2]));
    p.pitch = clamp(Math.atan2((best.pos[1] + best.h * 0.5) - (p.pos[1] + 1.62), Math.hypot(best.pos[0] - p.pos[0], best.pos[2] - p.pos[2])), -1.5, 1.5);
    if (bd > g.reach() + 0.8) return null;
    g.attack(best);
    return best;
  }
  breakAt(x, y, z) {
    const g = this.game, p = g.player;
    if (!g.world.isLoaded(x, z)) return false;
    const id = g.world.getBlock(x, y, z);
    if (!id || IS_FLUID[id] || id === 6) return false;
    if (Math.hypot(x + 0.5 - p.pos[0], y + 0.5 - p.pos[1], z + 0.5 - p.pos[2]) > g.reach() + 2) return false;
    const busy = this.busy; this.busy = true;
    try { g.breakBlock(x, y, z, false, true); return true; } catch (e) { return false; } finally { this.busy = busy; }
  }
  breakUnsafe(x, y, z) {
    const g = this.game;
    const id = g.world.getBlock(x, y, z);
    if (!id || IS_FLUID[id] || id === 6) return false;
    const busy = this.busy; this.busy = true;
    try { g.breakBlock(x, y, z, true, true); return true; } catch (e) { return false; } finally { this.busy = busy; }
  }
  placeAt(x, y, z, key) {
    const g = this.game, p = g.player, id = BID[key];
    if (id === undefined || !g.world.isLoaded(x, z)) return false;
    if (Math.hypot(x + 0.5 - p.pos[0], y + 0.5 - p.pos[1], z + 0.5 - p.pos[2]) > g.reach() + 2) return false;
    const slot = p.inv.slots.findIndex(s => s && s.id === id);
    if (slot < 0) return false;
    const stack = p.inv.slots[slot];
    const busy = this.busy; this.busy = true;
    try {
      g.world.setBlock(x, y, z, id, 0);
      if (g.mode !== 'creative') {
        stack.count--;
        if (stack.count <= 0) p.inv.slots[slot] = null;
      }
      p.swingT = 6;
      g.flushMesh();
      return true;
    } catch (e) { return false; } finally { this.busy = busy; }
  }
  safe() {
    if (this._safe) return this._safe;
    const g = this.game, m = this;
    this._safe = {
      get state() { return g.state; }, get mode() { return g.mode; }, get tickCount() { return g.tickCount; },
      get player() { return m.playerApi(); }, get world() { return m.worldApi(); },
      get game() { return g; },
      blocks: { id: (k) => BID[String(k).replace('minecraft:', '')] ?? null, get: (k) => BLOCKS[BID[k]] || null, exists: (k) => BID[k] !== undefined },
      items: { get: (k) => ITEMS[ITEM_KEY[k]] || null, id: (k) => ITEM_KEY[k] ?? null, make: (k, n) => makeStack(k, n || 1) },
      entities: { spawn: (type, x, y, z) => { const e = new Mob(g, type, x, y, z); g.addEntity(e); return e; }, all: () => g.entities.filter(e => !e.dead) },
      get config() { return { get: (k, d) => m.getConfig(m._hookModId, k, d), set: (k, v) => m.setConfig(m._hookModId, k, v) }; },
      ui: {
        message: (t, c) => g.ui.message(t, c),
        actionBar: (text, color) => { g.ui.actionBar = { text: text, t: performance.now(), color: color || '#FFFFFF' }; },
        toast: (a, b, icon) => g.ui.toast(a, b, icon),
        addHud: (id, fn) => m.addHud(id, fn),
        drawText: (text, x, y, color) => Font.draw(g.ui.ctx, text, x, y, color || '#FFFFFF'),
      },
      lookDir: () => g.lookDir(),
      showModList: () => g.ui.open(new ModsScreen(g, null)),
    };
    return this._safe;
  }
  buildApi(mod, reg) {
    const m = this, g = this.game;
    const side = mod.side || 'both';
    const isClientSide = side === 'client' || side === 'both';
    const isServerSide = side === 'server' || side === 'both';
    const owner = mod.id;
    const touch = () => { mod._needsAssetRefresh = true; m.scheduleAssetRefresh(); };
    const shapeMap = { cube: SH_CUBE, cross: SH_CROSS, liquid: SH_LIQUID, boxes: SH_BOXES, torch: SH_TORCH, cactus: SH_CACTUS, crop: SH_CROP, model: SH_MODEL };
    const asKey = (v) => v == null ? v : String(v).replace(/^minecraft:/, '');
    const asCn = (v, fallback) => String(v || fallback || '').slice(0, 64);

    const assets = {
      // 注册一张 16×16 PNG 贴图，返回 texture array 层号；方块/物品可直接用这个名字
      texture(name, dataURL) {
        if (typeof name !== 'string' || !/^[a-zA-Z0-9_:.-]{1,64}$/.test(name)) throw new Error('贴图名不合法');
        if (ASSETS.tiles[name] !== undefined) return ASSETS.tiles[name];
        if (typeof dataURL !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(dataURL)) throw new Error('贴图必须是 data:image/png;base64,...');
        if (dataURL.length > 180000) throw new Error('贴图过大（最大约 128KB）');
        if (!ASSETS.tileImages) ASSETS.tileImages = {};
        const idx = ASSETS.count++;
        ASSETS.tiles[name] = idx;
        ASSETS.tileImages[name] = dataURL;
        touch();
        return idx;
      },
      tile(name) { return ASSETS.tiles[name] ?? null; },
      icon(dataURL) { return dataURL; },
    };

    const blocks = {
      all: () => BLOCKS.filter(Boolean),
      get: (key) => BLOCKS[BID[asKey(key)]] || null,
      id: (key) => BID[asKey(key)] ?? null,
      exists: (key) => BID[asKey(key)] !== undefined,
      register(def = {}) {
        const key = asKey(def.key || def.id);
        if (!key || !/^[a-zA-Z0-9_:-]{1,64}$/.test(key)) throw new Error('方块 key 不合法（只允许字母数字下划线冒号）');
        if (BID[key] !== undefined) throw new Error('方块 key 已存在: ' + key);
        let tex = def.texture ?? def.tex ?? key;
        if (typeof tex === 'string' && /^data:image\//.test(tex)) tex = assets.texture(def.textureName || (mod.id + '_' + key), tex);
        let shape = def.shape;
        if (typeof shape === 'string') shape = shapeMap[shape] ?? SH_CUBE;
        const finalShape = shape ?? (def.boxes ? SH_BOXES : SH_CUBE);
        const drops = def.drops
          ? (typeof def.drops === 'function' ? def.drops : (() => (Array.isArray(def.drops[0]) ? def.drops : [def.drops])))
          : undefined;
        const opts = {
          tex, shape: finalShape,
          render: def.render || (finalShape === SH_CUBE ? 'opaque' : 'cutout'),
          solid: def.solid, opaque: def.opaque, opacity: def.opacity, light: def.light || 0,
          hardness: def.hardness ?? 1, tool: def.tool || null, level: def.level || 0, needsTool: def.needsTool,
          sound: def.sound || 'stone', tint: def.tint || null, gravity: !!def.gravity,
          replaceable: !!def.replaceable, cullSame: !!def.cullSame, drops,
          boxes: def.boxes || null, climbable: !!def.climbable, facing: !!def.facing, axis: !!def.axis,
          needsSupport: !!def.needsSupport, flammable: !!def.flammable, fuel: def.fuel || 0,
          noItem: !!def.noItem, icon: def.icon || null, damage: def.damage || 0, slip: def.slip ?? 0.6,
          slab: !!def.slab, stairs: !!def.stairs, door: !!def.door, trapdoor: !!def.trapdoor, ladder: !!def.ladder,
          stack: def.stack || 64, flatIcon: def.flatIcon || null, onUse: def.onUse || null,
          texFn: typeof def.texFn === 'function' ? def.texFn : null,
        };
        const b = defModBlock(key, asCn(def.name || def.cn, key), opts);
        if (!b) throw new Error('方块注册失败: ' + key);
        if (def.icon && ITEMS[b.id]) ITEMS[b.id].icon = def.icon;
        if (def.onRandomTick && typeof def.onRandomTick === 'function') b.onRandomTick = def.onRandomTick.bind(b);
        if (def.onUse && typeof def.onUse === 'function') b.useAction = def.onUse.bind(b);
        if (def.onPlace && typeof def.onPlace === 'function') b.onPlace = def.onPlace.bind(b);
        if (def.onBreak && typeof def.onBreak === 'function') b.onBreak = def.onBreak.bind(b);
        b.modId = mod.id;
        touch();
        return b;
      },
    };

    const items = {
      all: () => ITEMS.filter(Boolean),
      get: (key) => ITEMS[ITEM_KEY[asKey(key)]] || null,
      make: (key, n) => makeStack(asKey(key), n || 1),
      keyOf: (id) => ITEMS[id] ? ITEMS[id].key : null,
      register(def = {}) {
        const key = asKey(def.key || def.id);
        if (!key || !/^[a-zA-Z0-9_:-]{1,64}$/.test(key)) throw new Error('物品 key 不合法');
        if (ITEM_KEY[key] !== undefined) throw new Error('物品 key 已存在: ' + key);
        let tex;
        if (def.texture && /^data:image\//.test(def.texture)) tex = assets.texture(def.textureName || ('i_' + mod.id + '_' + key), def.texture);
        else if (def.tile && ASSETS.tiles[def.tile] !== undefined) tex = ASSETS.tiles[def.tile];
        else if (def.texture && ASSETS.tiles[def.texture] !== undefined) tex = ASSETS.tiles[def.texture];
        let food = def.food || null;
        if (typeof food === 'number') food = [food, Math.round(food * 0.6 * 10) / 10];
        else if (food && !Array.isArray(food)) food = [food.hunger || food[0] || 0, food.saturation || food[1] || 0];
        const opts = {
          stack: def.stack || 64, tex, icon: def.icon || (def.texture && /^data:image\//.test(def.texture) ? def.texture : null),
          food, tool: def.tool || null, armor: def.armor || null,
          attack: def.attack || 0, durability: def.durability || 0, fuel: def.fuel || 0,
          places: def.places ? asKey(def.places) : null, spawnEgg: def.spawnEgg || null,
          block: def.block !== undefined ? (typeof def.block === 'string' ? BID[asKey(def.block)] : def.block) : undefined,
          heal: def.heal || 0, flat: def.flat || null,
        };
        if (opts.block === undefined) delete opts.block;
        const it = defModItem(key, asCn(def.name || def.cn, key), opts);
        if (def.tooltip) it.tooltip = def.tooltip;
        it.modId = mod.id;
        touch();
        return it;
      },
    };

    const recipes = {
      all: () => RECIPES.slice(),
      shaped: (result, count, pattern, keys) => { shaped(asKey(result), count, pattern, keys); return true; },
      shapeless: (result, count, ing) => { shapeless(asKey(result), count, ing.map(asKey)); return true; },
      smelting: (input, output, xp) => { smelt(asKey(input), asKey(output), xp || 0.1); return true; },
      remove: (result) => {
        const id = ITEM_KEY[asKey(result)];
        if (id === undefined) return false;
        let n = 0;
        for (let i = RECIPES.length - 1; i >= 0; i--) if (RECIPES[i].result === id) { RECIPES.splice(i, 1); n++; }
        return n > 0;
      },
    };
    const tags = {
      all: () => TAGS,
      add(name, keys) { TAGS[name] = Array.from(new Set([...(TAGS[name] || []), ...keys.map(asKey)])); return TAGS[name]; },
      get(name) { return (TAGS[name] || []).slice(); },
    };

    const entities = {
      types: () => MOB_TYPES,
      registerType(key, def = {}) {
        key = asKey(key);
        if (!/^[a-zA-Z0-9_:-]{1,64}$/.test(key)) throw new Error('实体 key 不合法');
        if (MOB_TYPES[key]) throw new Error('实体类型已存在: ' + key);
        const model = def.model || 'zombie';
        if (g.renderer && g.renderer.models && !g.renderer.models[model]) throw new Error('未知模型: ' + model);
        const t = {
          cn: asCn(def.name || def.cn, key), hp: def.health || def.hp || 20,
          w: def.width || def.w || 0.6, h: def.height || def.h || 1.8,
          speed: def.speed || 0.23, model, hostile: !!def.hostile, passive: !!def.passive,
          attack: def.attack || 0, ranged: !!def.ranged, burns: !!def.burns, climbs: !!def.climbs,
          tint: def.tint || null, scale: def.scale || 1, drops: def.drops || [],
          food: def.food || null, modId: mod.id,
        };
        MOB_TYPES[key] = t; return t;
      },
      spawn(key, x, y, z) {
        key = asKey(key);
        if (!MOB_TYPES[key]) throw new Error('未知实体类型: ' + key);
        const e = new Mob(g, key, x, y, z); e.persistent = true; g.addEntity(e); return e;
      },
      all: () => g.entities.filter(e => !e.dead),
      nearest: (range) => m.worldApi().nearestEntity(range),
    };

    const commands = {
      register(name, def = {}) {
        name = String(name || '').replace(/^\//, '').toLowerCase();
        if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error('命令名不合法');
        const reserved = ['help', 'gamemode', 'gm', 'time', 'weather', 'give', 'tp', 'summon', 'kill', 'spawnpoint', 'seed', 'clear', 'xp', 'dimension', 'dim'];
        if (reserved.indexOf(name) >= 0) throw new Error('不能覆盖原版命令: /' + name);
        if (m.commands.has(name)) throw new Error('命令已存在: /' + name);
        const rec = { owner, name, usage: def.usage || ('/' + name), description: def.description || '', permission: def.permission || 'op', run: def.run };
        if (typeof rec.run !== 'function') throw new Error('命令缺少 run 函数');
        m.commands.set(name, rec); return rec;
      },
      all: () => [...m.commands.values()],
    };

    const keybinds = {
      register(def = {}) {
        const code = def.key || def.code;
        if (!code || !/^[A-Za-z0-9]+$/.test(code)) throw new Error('按键 code 不合法');
        const id = owner + ':' + code;
        if (m.keybinds.has(id)) throw new Error('按键已注册: ' + code);
        const rec = { owner, code, name: asCn(def.name, code), run: def.run || (() => { }) };
        m.keybinds.set(id, rec); return rec;
      },
      all: () => [...m.keybinds.values()],
    };

    const worldgen = {
      addOre(def = {}) {
        if (!def.block) throw new Error('addOre 缺少 block');
        m.ores.push({ owner, block: asKey(def.block), size: def.size || 6, count: def.count || 4, minY: def.minY ?? 0, maxY: def.maxY ?? 64 });
      },
      addFeature(def = {}) {
        if (typeof def.place !== 'function') throw new Error('addFeature 缺少 place 函数');
        m.features.push({ owner, chance: def.chance ?? 0.1, place: def.place });
      },
    };

    const network = {
      register(channel, handler) {
        channel = String(channel || '');
        if (!/^[a-zA-Z0-9_:-]{1,48}$/.test(channel)) throw new Error('频道名不合法');
        if (typeof handler !== 'function') throw new Error('频道 handler 必须是函数');
        if (m.netChannels.has(channel)) throw new Error('频道已注册: ' + channel);
        m.netChannels.set(channel, { owner, handler });
      },
      send(channel, data) {
        if (!g.net || !g.net.sendMod) return false;
        return g.net.sendMod(channel, data);
      },
      get connected() { return !!(g.net && g.net.status === 'connected'); },
      get isHost() { return !!(g.net && g.net.role === 'host'); },
    };

    const data = {
      get(key, def) {
        const md = (g.worldMeta && g.worldMeta.modData) || {};
        const d = md[owner] || {};
        return d[key] === undefined ? def : d[key];
      },
      set(key, val) {
        if (!g.worldMeta) return false;
        if (!g.worldMeta.modData) g.worldMeta.modData = {};
        if (!g.worldMeta.modData[owner]) g.worldMeta.modData[owner] = {};
        g.worldMeta.modData[owner][key] = val;
        g._modDataDirty = true;
        return true;
      },
      all() { return ((g.worldMeta && g.worldMeta.modData) || {})[owner] || {}; },
    };

    const storage = {
      get(key, def) { try { const v = localStorage.getItem('mcjs-mod-storage:' + owner + ':' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
      set(key, val) { try { localStorage.setItem('mcjs-mod-storage:' + owner + ':' + key, JSON.stringify(val)); return true; } catch (e) { return false; } },
      remove(key) { try { localStorage.removeItem('mcjs-mod-storage:' + owner + ':' + key); } catch (e) { } },
    };

    const ui = {
      message: (text, color) => g.ui.message(String(text), color),
      toast: (title, sub, icon) => g.ui.toast(title, sub, icon),
      actionBar: (text, color) => { g.ui.actionBar = { text: String(text), t: performance.now(), color: color || '#FFFFFF' }; },
      addHud: (id, fn) => m.addHud(owner + ':' + id, fn, owner),
      removeHud: (id) => m.removeHud(owner + ':' + id),
      openScreen: (screen) => g.ui.open(screen),
      closeScreen: () => g.ui.close(),
      get screen() { return g.ui.screen; },
      get scale() { return g.ui.scale; }, get width() { return g.ui.w; }, get height() { return g.ui.h; },
      drawText: (text, x, y, color) => Font.draw(g.ui.ctx, text, x, y, color || '#FFFFFF'),
      drawRect: (x, y, w, h, color) => { const c = g.ui.ctx; c.fillStyle = color; c.fillRect(x, y, w, h); },
      drawItem: (stack, x, y) => g.ui.drawItem(stack, x, y),
      sprite: (name, x, y, w, h) => g.ui.sprite(name, x, y, w, h),
      nine: (name, x, y, w, h, b) => g.ui.nine(name, x, y, w, h, b),
    };

    const api = {
      id: owner, version: '4.0', apiVersion: '4.0', gameVersion: '26.2', mod,
      register: (def) => { reg.push(Object.assign({}, mod, def)); },
      on: (name, fn) => m.on(name, fn, owner),
      once: (name, fn) => { const wrap = (...a) => { fn(...a); const list = m.hooks.get(name); if (list) m.hooks.set(name, list.filter(x => x.fn !== wrap)); }; m.on(name, wrap, owner); },
      manager: m,
      showModList: () => g.ui.open(new ModsScreen(g, null)),
      player: m.playerApi(),
      world: m.worldApi(),
      blocks, items, recipes, tags, entities, commands, keybinds, worldgen, network, data, storage, ui, assets,
      config: {
        get: (key, def) => m.getConfig(owner, key, def),
        set: (key, val) => m.setConfig(owner, key, val),
        schema: (schema) => { if (Array.isArray(schema)) mod.configSchema = schema; },
      },
      loot: {
        register(blockKey, fn) {
          if (typeof fn !== 'function') throw new Error('loot.register 需要函数');
          m.lootHooks.set(asKey(blockKey), { owner, fn });
        },
      },
      events: null,
      log: (...a) => console.log('[' + owner + ']', ...a),
      warn: (...a) => console.warn('[' + owner + ']', ...a),
    };
    api.events = { on: api.on, once: api.once, emit: (name, ...args) => m.fire(name, ...args) };

    if (isClientSide) {
      api.game = g;
      api.renderer = g.renderer;
      api.worldObj = () => g.world;
      api.isClient = true;
      api.hooks = {
        onTitleDraw: (fn) => m.on('titleDraw', fn, owner),
        onMenuBuild: (fn) => m.on('menuBuild', fn, owner),
        onWorldGen: (fn) => m.on('worldGen', fn, owner),
        onEntityRender: (fn) => m.on('entityRender', fn, owner),
        onChunkMesh: (fn) => m.on('chunkMesh', fn, owner),
        onGameTick: (fn) => m.on('gameTick', fn, owner),
        onDimensionChange: (fn) => m.on('dimensionChange', fn, owner),
      };
      api.setTitle = (text) => { g.customTitle = String(text); };
      api.addTitleButton = (label, onClick) => {
        if (!g.titleExtraButtons) g.titleExtraButtons = [];
        g.titleExtraButtons.push({ label, onClick });
      };
      api.registerDimension = (id, def) => {
        if (!g.dimensions) g.dimensions = {};
        g.dimensions[id] = def;
      };
      // 兼容 v3 的位置参数写法
      api.registerBlock = (idOrDef, key, cn, opts) => {
        if (typeof idOrDef === 'object') return blocks.register(idOrDef);
        if (idOrDef >= 0 && idOrDef < MOD_BLOCK_START && !BLOCKS[idOrDef]) { defBlock(idOrDef, key, cn, opts || {}); touch(); return true; }
        return false;
      };
      api.registerItem = (key, cn, opts) => items.register(Object.assign({ key, name: cn }, opts || {}));
      api.registerRecipe = (result, count, pattern, keys) => recipes.shaped(result, count, pattern, keys);
      api.registerSmelting = (input, output, xp) => recipes.smelting(input, output, xp);
      api.setBlock = (x, y, z, key, meta) => m.worldApi().setBlock(x, y, z, key, meta);
      api.server = isServerSide ? {
        get isHost() { return !!(g.net && g.net.role === 'host' && g.net.status !== 'off'); },
        players: () => m.netPlayers(),
        broadcast: (text, color) => m.serverBroadcast(text, color),
        kick: (slot, reason) => m.serverKick(slot, reason),
        runCommand: (text) => { try { runCommand(g, text); return true; } catch (e) { return false; } },
      } : null;
    } else {
      api.game = null;
      api.renderer = null;
      api.isClient = false;
      api.hooks = { onGameTick: (fn) => m.on('gameTick', fn, owner) };
      api.setTitle = () => {};
      api.addTitleButton = () => {};
      api.registerDimension = () => {};
      api.registerBlock = (idOrDef) => typeof idOrDef === 'object' ? blocks.register(idOrDef) : false;
      api.registerItem = (key, cn, opts) => items.register(Object.assign({ key, name: cn }, opts || {}));
      api.registerRecipe = (result, count, pattern, keys) => recipes.shaped(result, count, pattern, keys);
      api.registerSmelting = (input, output, xp) => recipes.smelting(input, output, xp);
      api.server = {
        get isHost() { return !!(g.net && g.net.role === 'host' && g.net.status !== 'off'); },
        players: () => m.netPlayers(),
        broadcast: (text, color) => m.serverBroadcast(text, color),
        kick: (slot, reason) => m.serverKick(slot, reason),
        runCommand: (text) => { try { runCommand(g, text); return true; } catch (e) { return false; } },
      };
    }
    api.isServer = isServerSide;
    mod.api = api;
    return api;
  }
  apiFor(id) { const mod = this.mods.get(id); return (mod && mod.api) ? mod.api : this.safe(); }
  // ---- 服务端辅助（房主）----
  netPlayers() {
    const g = this.game;
    const out = [{ slot: 0, name: g.playerName || '房主', host: true }];
    if (g.net) for (const [slot, rec] of g.net.conns) out.push({ slot, name: rec.name, host: false });
    return out;
  }
  serverBroadcast(text, color) {
    const g = this.game;
    g.ui.message(String(text), color || '#FFFF55');
    if (g.net) g.net.broadcast({ type: 'chat', name: '服务器', text: String(text).slice(0, 200) });
  }
  serverKick(slot, reason) {
    const g = this.game;
    if (!g.net || g.net.role !== 'host') return false;
    const rec = g.net.conns.get(slot);
    if (!rec) return false;
    if (g.net.sendTo) g.net.sendTo(rec, { type: 'kick', reason: String(reason || '被房主移出房间').slice(0, 100) });
    g.net.removeGuest(slot);
    return true;
  }
  async init(force) {
    if (this.loading) return;
    if (this.loaded && !force) return;
    this.loading = true;
    this.loadError = null;
    this._suppressAssetRefresh = true;
    if (force) {
      // 重新加载：先移除旧模组注册的钩子/命令/HUD/网络频道，避免重复触发
      for (const m of this.mods.values()) { if (m.onUnload) { try { m.onUnload(this.safe(), m); } catch (e) { } } }
      this.mods.clear(); this.hooks.clear(); this.hud.clear(); this.loadedIds.clear();
      this.commands.clear(); this.keybinds.clear(); this.netChannels.clear(); this.lootHooks.clear();
      this.ores = []; this.features = [];
      this.loaded = false;
    }
    this.loadConfigs();
    try { this.enabled = new Set(JSON.parse(localStorage.getItem('mcjs-mod-enabled') || '[]')); } catch (e) { this.enabled = new Set(); }
    try { this.disabled = new Set(JSON.parse(localStorage.getItem('mcjs-mod-disabled') || '[]')); } catch (e) { this.disabled = new Set(); }
    try { this.userMods = JSON.parse(localStorage.getItem('mcjs-mod-user') || '[]') || []; } catch (e) { this.userMods = []; }
    this.index = [];
    const embedded = (typeof window !== 'undefined' && window.OFFICIAL_MODS) ? window.OFFICIAL_MODS : null;
    if (embedded && embedded.length) {
      this.index = embedded;
    } else {
      try {
        const res = await fetch('mods/index.json', { cache: 'no-store' });
        if (res.ok) this.index = await res.json();
        else this.loadError = '无法读取 mods/index.json（HTTP ' + res.status + '，使用内置模组）';
      } catch (e) {
        this.loadError = '无法读取 mods/index.json：' + e.message + '（使用内置模组）';
      }
      if (!Array.isArray(this.index) || !this.index.length) {
        this.index = OFFICIAL_FALLBACK.slice();
        if (!this.loadError) this.loadError = '官方模组清单为空，已使用内置清单';
      }
    }
    for (const m of this.index) {
      const mod = Object.assign({}, m, { official: true });
      mod.enabled = !this.disabled.has(mod.id);
      if (mod.enabled) this.enabled.add(mod.id); else this.enabled.delete(mod.id);
      this.mods.set(mod.id, mod);
    }
    this.saveEnabled();
    for (const m of this.userMods) {
      const mod = Object.assign({}, m, { official: false });
      mod.enabled = !this.disabled.has(mod.id) && this.enabled.has(mod.id);
      this.mods.set(mod.id, mod);
    }
    for (const m of this.mods.values()) await this.loadCode(m);
    this.loaded = true;
    this.loading = false;
    this._suppressAssetRefresh = false;
    if (force) this.scheduleAssetRefresh();
  }
  saveEnabled() {
    try {
      localStorage.setItem('mcjs-mod-enabled', JSON.stringify([...this.enabled]));
      localStorage.setItem('mcjs-mod-disabled', JSON.stringify([...this.disabled]));
    } catch (e) { }
  }
  saveUsers() {
    try {
      localStorage.setItem('mcjs-mod-user', JSON.stringify(this.userMods.map(m => ({
        id: m.id, name: m.name, author: m.author, version: m.version,
        description: m.description, side: m.side, code: m.code,
        tags: m.tags || [], icon: m.icon || '', license: m.license || '',
        homepage: m.homepage || '', publicId: m.publicId || '',
      }))));
    } catch (e) { }
  }
  async loadCode(mod) {
    if (mod._loading) return;
    if (this.loadedIds.has(mod.id) || !mod.enabled) return;
    mod._loading = true;
    try {
      let code = mod.code;
      if (mod.official && !code) {
        const res = await fetch('mods/' + mod.file, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        code = await res.text();
      }
      if (!code) return;
      if (this.loadedIds.has(mod.id)) return;
      const reg = [];
      this._currentModId = mod.id;
      const api = this.buildApi(mod, reg);
      new Function('OpusMods', code)(api);
      this._currentModId = null;
      for (const def of reg) {
        const merged = Object.assign({}, mod, def);
        merged.enabled = mod.enabled;
        merged.api = api;
        merged.code = mod.code;
        merged.side = def.side || mod.side || 'both';
        this.mods.set(merged.id, merged);
        if (merged.id !== mod.id) { this.mods.delete(mod.id); this.enabled.delete(mod.id); this.enabled.add(merged.id); }
        if (merged.configSchema && !this.configs[merged.id]) {
          const cfg = {};
          for (const f of merged.configSchema) cfg[f.key] = f.default;
          this.configs[merged.id] = cfg;
          this.saveConfigs();
        }
        if (merged.onLoad) { try { merged.onLoad(api, merged); } catch (e) { console.warn('[mod onLoad]', merged.id, e); } }
      }
      mod._loaded = true;
      this.loadedIds.add(mod.id);
      mod.loadOk = true;
      if (mod._needsAssetRefresh) this.scheduleAssetRefresh();
    } catch (e) {
      console.warn('[mods] 加载失败', mod.id, e);
      this.game.ui.message('模组加载失败：' + mod.name + '（' + e.message + '）', '#FF5555');
    } finally {
      mod._loading = false;
    }
  }
  async setEnabled(id, on) {
    const mod = this.mods.get(id);
    if (!mod) return;
    mod.enabled = on;
    if (on) { this.enabled.add(id); this.disabled.delete(id); await this.loadCode(mod); }
    else { this.enabled.delete(id); this.disabled.add(id); }
    this.saveEnabled();
  }
  setWorldMods(ids) {
    if (!Array.isArray(ids)) return;
    for (const m of this.mods.values()) {
      const on = ids.indexOf(m.id) >= 0;
      if (m.enabled !== on) { m.enabled = on; if (on) { this.enabled.add(m.id); this.disabled.delete(m.id); } else { this.enabled.delete(m.id); this.disabled.add(m.id); } this.loadCode(m); }
    }
    this.saveEnabled();
  }
  ensureOfficial(ids) {
    for (const id of ids || []) {
      if (this.mods.has(id) || !this.index) continue;
      const meta = this.index.find(x => x.id === id);
      if (!meta) continue;
      const mod = Object.assign({}, meta, { official: true, enabled: true });
      this.mods.set(mod.id, mod); this.enabled.add(mod.id); this.disabled.delete(mod.id); this.loadCode(mod);
    }
  }
  exportPayload(ids) {
    const out = [];
    let total = 0;
    for (const id of ids || []) {
      const m = this.mods.get(id);
      if (!m) continue;
      const item = { id: m.id, name: m.name, author: m.author, version: m.version, description: m.description, side: m.side || 'both', official: !!m.official };
      if (!m.official) item.code = String(m.code || '').slice(0, 60000);
      total += JSON.stringify(item).length;
      if (total > 220000) break;
      out.push(item);
    }
    return out;
  }
  applyHostMods(ids, payloads) {
    if (Array.isArray(payloads)) {
      for (const p of payloads) {
        if (p.official) continue;
        if (this.mods.has(p.id)) continue;
        try { this.addUserMod(p, p.code || ''); } catch (e) { }
      }
    }
    this.ensureOfficial(ids);
    for (const id of ids || []) {
      const m = this.mods.get(id);
      if (m && !m.enabled) { m.enabled = true; this.enabled.add(id); this.disabled.delete(id); this.loadCode(m); }
    }
    this.saveEnabled();
  }
  get(id) { return this.mods.get(id); }
  onKey(code) {
    for (const m of this.active()) {
      if (!m.onKey) continue;
      this._hookModId = m.id; try { m.onKey(this.safe(), code); } catch (e) { console.warn('[mod] onKey', m.id, e); } finally { this._hookModId = null; }
    }
  }
  onBlockBreak(ctx) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const m of this.active()) {
        if (!m.onBlockBreak) continue;
        this._hookModId = m.id; try { m.onBlockBreak(this.safe(), ctx); } catch (e) { console.warn('[mod] onBlockBreak', m.id, e); } finally { this._hookModId = null; }
      }
    } finally { this.busy = false; }
  }
  static parseMeta(text) {
    const m = /\/\*OPUSMOD\s*([\s\S]*?)\*\//.exec(text || '');
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  }
  addUserMod(meta, code) {
    const name = String(meta.name || '未命名模组').slice(0, 24);
    let id = String(meta.id || '').replace(/[^a-zA-Z0-9_-]/g, '') || ('user-' + Date.now().toString(36));
    if (this.mods.has(id)) id = id + '-' + Date.now().toString(36);
    const mod = {
      id: id, name: name, official: false,
      author: String(meta.author || '匿名').slice(0, 24),
      version: String(meta.version || '1.0.0').slice(0, 16),
      description: String(meta.description || '').slice(0, 2000),
      side: meta.side || 'both', tags: meta.tags || [], icon: meta.icon || '',
      license: meta.license || '', homepage: meta.homepage || '',
      publicId: meta.publicId || '', sourceId: meta.publicId || '',
      code: code, enabled: true,
    };
    this.mods.set(id, mod);
    this.enabled.add(id);
    this.userMods.push(mod);
    this.saveUsers(); this.saveEnabled();
    mod._loadPromise = this.loadCode(mod);
    return mod;
  }
  removeUserMod(id) {
    const mod = this.mods.get(id);
    if (!mod || mod.official) return false;
    if (mod.onUnload) { try { mod.onUnload(this.safe(), mod); } catch (e) { console.warn('[mod onUnload]', id, e); } }
    for (const [name, list] of this.hooks) {
      const keep = list.filter(item => item.owner !== id);
      if (keep.length) this.hooks.set(name, keep); else this.hooks.delete(name);
    }
    for (const key of [...this.hud.keys()]) if (key.indexOf(id + ':') === 0) this.hud.delete(key);
    delete this.configs[id];
    this.mods.delete(id); this.enabled.delete(id); this.disabled.delete(id);
    this.userMods = this.userMods.filter(m => m.id !== id);
    this.loadedIds.delete(id);
    this.saveUsers(); this.saveEnabled(); this.saveConfigs();
    return true;
  }
  async installPublic(meta, code) {
    if (!meta || !code) throw new Error('模组数据不完整');
    // 已经装过同一个公开模组：直接启用并返回
    for (const m of this.mods.values()) {
      if (!m.official && (m.publicId === meta.id || m.id === meta.id)) {
        if (!m.enabled) { m.enabled = true; this.enabled.add(m.id); await this.loadCode(m); this.saveEnabled(); }
        return m;
      }
    }
    const mod = this.addUserMod({
      id: meta.id, name: meta.name, author: meta.author, version: meta.version,
      description: meta.summary || meta.description || '', side: meta.side || 'both',
      icon: meta.icon || '', tags: meta.tags || [], license: meta.license || '',
      homepage: meta.homepage || '', publicId: meta.id,
    }, code);
    mod.publicId = meta.id;
    mod.description = String(meta.description || meta.summary || '').slice(0, 2000);
    await (mod._loadPromise || this.loadCode(mod));
    return mod;
  }
  exportText(id) {
    const mod = this.mods.get(id);
    if (!mod || mod.official) return null;
    const meta = { id: mod.id, name: mod.name, author: mod.author, version: mod.version, description: mod.description, side: mod.side || 'both', official: false };
    return '/*OPUSMOD\n' + JSON.stringify(meta) + '\n*/\n' + (mod.code || '');
  }
  directLink(id) {
    const mod = this.mods.get(id);
    if (!mod || !mod.official || !mod.file) return null;
    try { return new URL('mods/' + mod.file, location.href).href; } catch (e) { return null; }
  }
}


// ---------------------------------------------------------------------------
// 公开模组库（PHP API）与人机验证
// ---------------------------------------------------------------------------
const MOD_LIBRARY_DEFAULT = 'api/mods.php';
function modLibraryBase() {
  try { return (window.OPUSMC_CONFIG && window.OPUSMC_CONFIG.api) || MOD_LIBRARY_DEFAULT; } catch (e) { return MOD_LIBRARY_DEFAULT; }
}
function modLibraryURL(action, params) {
  const base = modLibraryBase();
  const q = new URLSearchParams(Object.assign({ action: action }, params || {}));
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + q.toString();
}
async function modFetchJSON(url, opts) {
  let res;
  try { res = await fetch(url, Object.assign({ cache: 'no-store', headers: { 'Content-Type': 'application/json' } }, opts || {})); }
  catch (e) { throw new Error('无法连接模组库（网络或服务器问题）'); }
  if (res.status === 404 && /\/api\/mods\.php/.test(url)) {
    const alt = url.replace('/api/mods.php', '/mods-api.php');
    if (alt !== url) return modFetchJSON(alt, opts);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { }
  if (!data) throw new Error('模组库返回异常（HTTP ' + res.status + '）');
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

const ModCaptcha = {
  sdkLoading: null, instance: null, pending: null,
  async loadSDK() {
    if (typeof window.initGeetest4 === 'function') return;
    if (this.sdkLoading) return this.sdkLoading;
    this.sdkLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://static.geetest.com/v4/gt4.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('极验 SDK 加载失败'));
      setTimeout(() => reject(new Error('极验 SDK 加载超时')), 9000);
      document.head.appendChild(s);
    });
    return this.sdkLoading;
  },
  async init(captchaId) {
    await this.loadSDK();
    if (this.instance) return this.instance;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, val) => { if (settled) return; settled = true; clearTimeout(timer); fn(val); };
      const timer = setTimeout(() => finish(reject, new Error('极验初始化超时')), 12000);
      try {
        // bind：不显示极验自带按钮，由游戏内「人机验证」按钮调用 showCaptcha()
        window.initGeetest4({ captchaId: captchaId, product: 'bind', language: 'zho', protocol: 'https://' }, (captcha) => {
          this.instance = captcha;
          captcha.onReady(() => finish(resolve, captcha));
          captcha.onSuccess(() => {
            const v = captcha.getValidate ? captcha.getValidate() : null;
            if (this.pending) { const r = this.pending; this.pending = null; r.resolve(v ? Object.assign({ type: 'geetest' }, v) : null); }
          });
          captcha.onError(() => { if (this.pending) { const r = this.pending; this.pending = null; r.reject(new Error('极验验证出错')); } });
          captcha.onClose(() => { if (this.pending) { const r = this.pending; this.pending = null; r.resolve(null); } });
          // 某些环境下 onReady 可能已经错过，给一个短兜底
          setTimeout(() => finish(resolve, captcha), 1200);
        });
      } catch (e) { finish(reject, e); }
    });
  },
  async geetest(captchaId) {
    const c = await this.init(captchaId);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      try { c.showCaptcha(); } catch (e) { this.pending = null; reject(e); }
    });
  },
  // 内置滑块验证（极验不可用时）
  local() {
    return new Promise((resolve) => {
      const old = document.getElementById('mc-captcha-overlay');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.id = 'mc-captcha-overlay';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;font-family:monospace;';
      wrap.innerHTML = '<div style="width:min(360px,90vw);background:#1b1b2b;border:2px solid #55FFFF;box-shadow:0 0 0 4px #000;padding:16px;color:#fff;box-sizing:border-box">'
        + '<div style="color:#FFFF55;font-weight:bold;margin-bottom:8px">人机验证（备用）</div>'
        + '<div id="mc-cap-text" style="font-size:13px;line-height:1.5;color:#ddd">正在获取验证挑战…</div>'
        + '<input id="mc-cap-range" type="range" min="0" max="100" value="0" style="width:100%;margin:14px 0 6px">'
        + '<div style="display:flex;justify-content:space-between;font-size:12px;color:#889"><span>0</span><span id="mc-cap-val" style="color:#55FF55">0</span><span>100</span></div>'
        + '<div style="display:flex;gap:8px;margin-top:14px"><button id="mc-cap-ok" style="flex:1;padding:8px;background:#2d6b2d;color:#fff;border:1px solid #55FF55;cursor:pointer">确认</button>'
        + '<button id="mc-cap-cancel" style="flex:1;padding:8px;background:#55222b;color:#fff;border:1px solid #FF5555;cursor:pointer">取消</button></div>'
        + '<div style="margin-top:10px;font-size:11px;color:#777;line-height:1.5">这是极验不可达时的兜底验证，仍然需要完成一次交互。</div></div>';
      document.body.appendChild(wrap);
      const text = wrap.querySelector('#mc-cap-text'), range = wrap.querySelector('#mc-cap-range'), val = wrap.querySelector('#mc-cap-val');
      wrap.addEventListener('keydown', (e) => e.stopPropagation(), true);
      const close = (r) => { wrap.remove(); resolve(r); };
      wrap.querySelector('#mc-cap-cancel').onclick = () => close(null);
      range.oninput = () => { val.textContent = range.value; };
      let token = null;
      modFetchJSON(modLibraryURL('captcha')).then(d => {
        token = d.token;
        text.textContent = '请完成行为验证：' + String(d.prompt || '拖动滑块');
        text.appendChild(document.createElement('br'));
        const hint = document.createElement('span');
        hint.style.color = '#888';
        hint.textContent = '验证令牌有效期 5 分钟';
        text.appendChild(hint);
        text.dataset.target = d.target;
        text.dataset.tolerance = d.tolerance;
      }).catch(e => {
        text.textContent = '无法获取验证挑战：' + e.message;
        wrap.querySelector('#mc-cap-ok').disabled = true;
      });
      wrap.querySelector('#mc-cap-ok').onclick = () => {
        if (!token) return;
        close({ type: 'local', token: token, value: Number(range.value) });
      };
    });
  },
};

// ---------------------------------------------------------------------------
class ModLibraryScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '公开模组库');
    this.bgDirt = true;
    this.parent = parent;
    this.mods = [];
    this.loading = false;
    this.error = null;
    this.page = 1; this.pages = 1; this.total = 0;
    this.q = ''; this.sort = 'new'; this.scroll = 0; this.sel = -1;
    this.busy = false; this.iconImgs = new Map();
    setTimeout(() => { if (!this.loading && !this.mods.length && !this.error) this.fetchList(); }, 0);
  }
  async fetchList() {
    this.loading = true; this.error = null; this.layout();
    try {
      const d = await modFetchJSON(modLibraryURL('list', { q: this.q, sort: this.sort, page: this.page, limit: 20 }));
      this.mods = d.mods || []; this.page = d.page || 1; this.pages = d.pages || 1; this.total = d.total || 0;
      for (const m of this.mods) {
        if (!m.icon || this.iconImgs.has(m.id)) continue;
        const im = new Image(); im.src = m.icon;
        this.iconImgs.set(m.id, im);
      }
      this.sel = -1; this.scroll = 0;
    } catch (e) { this.error = e.message; this.mods = []; }
    this.loading = false; this.layout();
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.searchField = { x: cx - 154, y: 32, w: 216, h: 18 };
    this.listY = 58;
    this.rowH = 30;
    const by = u.h - 76;
    this.listH = by - 8 - this.listY;
    this.vis = Math.max(1, Math.floor(this.listH / this.rowH));
    this.widgets = [
      { x: cx + 68, y: 32, w: 86, h: 18, label: '搜索', onClick: () => { this.page = 1; this.fetchList(); } },
      { x: cx - 154, y: by, w: 74, h: 20, label: '安装选中', enabled: this.sel >= 0 && !this.busy, onClick: () => this.installSelected() },
      { x: cx - 76, y: by, w: 74, h: 20, label: '详情', enabled: this.sel >= 0, onClick: () => this.openDetail() },
      { x: cx + 2, y: by, w: 74, h: 20, label: '上传模组', onClick: () => this.game.ui.open(new ModUploadScreen(this.game, this)) },
      { x: cx + 80, y: by, w: 74, h: 20, label: '刷新', onClick: () => this.fetchList() },
      { x: cx - 154, y: by + 24, w: 74, h: 20, label: '上一页', enabled: this.page > 1, onClick: () => { this.page--; this.fetchList(); } },
      { x: cx - 76, y: by + 24, w: 150, h: 20, label: () => '第 ' + this.page + ' / ' + this.pages + ' 页 · 共 ' + this.total + ' 个', enabled: false, onClick: () => { } },
      { x: cx + 80, y: by + 24, w: 74, h: 20, label: '下一页', enabled: this.page < this.pages, onClick: () => { this.page++; this.fetchList(); } },
      { x: cx - 154, y: by + 48, w: 150, h: 20, label: '排序: ' + (this.sort === 'new' ? '最新' : this.sort === 'downloads' ? '下载最多' : '名称'), onClick: () => { this.sort = this.sort === 'new' ? 'downloads' : this.sort === 'downloads' ? 'name' : 'new'; this.page = 1; this.fetchList(); } },
      { x: cx + 4, y: by + 48, w: 150, h: 20, label: '返回', onClick: () => this.game.ui.open(this.parent) },
    ];
  }
  selected() { return this.mods[this.sel] || null; }
  async installSelected() {
    const m = this.selected(); if (!m || this.busy) return;
    if (!m.installable) { this.game.ui.message('这个模组标记为不可直接安装，请查看详情', '#FFAA00'); return; }
    this.busy = true; this.layout();
    try {
      const d = await modFetchJSON(modLibraryURL('get', { id: m.id }));
      const mod = await this.game.mods.installPublic(d.mod, d.code);
      this.game.ui.message('已安装：' + (mod && mod.name || m.name), '#55FFFF');
    } catch (e) { this.game.ui.message('安装失败：' + e.message, '#FF5555'); }
    this.busy = false; this.layout();
  }
  openDetail() { const m = this.selected(); if (m) this.game.ui.open(new ModDetailScreen(this.game, this, m)); }
  drawExtra(ui) {
    const c = ui.ctx;
    Font.draw(c, '搜索：', this.searchField.x - 2, this.searchField.y - 10, '#A0A0A0');
    ui.nine('text_field', this.searchField.x, this.searchField.y, this.searchField.w, this.searchField.h, 1);
    Font.draw(c, this.q || '输入关键词…', this.searchField.x + 4, this.searchField.y + 5, this.q ? '#FFFFFF' : '#777777');
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, this.listY, ui.w, this.listH);
    if (this.loading) { Font.center(c, '正在读取公开模组库…', ui.w / 2, this.listY + 16, '#FFFF55'); return; }
    if (this.error) { Font.center(c, '⚠ ' + this.error, ui.w / 2, this.listY + 16, '#FF5555'); return; }
    if (!this.mods.length) { Font.center(c, '没有找到模组，试试上传第一个吧', ui.w / 2, this.listY + 16, '#AAAAAA'); return; }
    const start = Math.max(0, Math.min(this.scroll, Math.max(0, this.mods.length - this.vis)));
    this.mods.slice(start, start + this.vis).forEach((m, i) => {
      const idx = start + i, y = this.listY + i * this.rowH;
      if (idx === this.sel) { c.fillStyle = 'rgba(85,255,255,0.16)'; c.fillRect(4, y, ui.w - 8, this.rowH - 1); }
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(6, y + 2, 20, 20);
      if (m.icon) { const im = this.iconImgs.get(m.id); if (im && im.complete && im.width) c.drawImage(im, 8, y + 4, 16, 16); }
      Font.draw(c, String(m.name || '未命名').slice(0, 16), 32, y + 2, '#FFFFFF');
      Font.draw(c, 'v' + m.version + ' · ' + (m.author || '匿名'), 32 + Font.width(String(m.name || '').slice(0, 16)) + 8, y + 2, '#55FFFF');
      Font.draw(c, String(m.summary || '').slice(0, 46), 32, y + 12, '#A0A0A0');
      const tag = m.installable ? '可安装' : '仅查看';
      Font.draw(c, tag, ui.w - 12 - Font.width(tag), y + 12, m.installable ? '#55FF55' : '#FFAA00');
      Font.draw(c, '↓' + (m.downloads || 0), ui.w - 12 - Font.width('↓' + (m.downloads || 0)), y + 2, '#808080');
    });
    if (this.mods.length > this.vis) Font.center(c, '▲▼ 滚轮翻页', ui.w / 2, this.listY + this.listH - 9, '#707070');
  }
  mouseDown(ui, mx, my, b) {
    if (ui.hit(this.searchField, mx, my)) {
      ui.showInput(this.searchField.x + 2, this.searchField.y + 2, this.searchField.w - 4, this.searchField.h - 4, this.q, () => { this.page = 1; this.fetchList(); }, { onInput: (v) => { this.q = v; }, onEsc: () => ui.close(), max: 64 });
      return;
    }
    if (my >= this.listY && my < this.listY + this.listH) {
      const idx = Math.floor((my - this.listY) / this.rowH) + this.scroll;
      if (idx >= 0 && idx < this.mods.length) {
        if (this.sel === idx) { this.installSelected(); return; }
        this.sel = idx; this.layout(); Sound.click(); return;
      }
    }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy) * 2, 0, Math.max(0, this.mods.length - this.vis)); }
  onEsc() { this.game.ui.open(this.parent); }
}

// ---------------------------------------------------------------------------
class ModDetailScreen extends MenuScreen {
  constructor(game, parent, meta) {
    super(game, '模组详情');
    this.bgDirt = true;
    this.parent = parent; this.meta = meta; this.busy = false;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: u.h - 28, w: 150, h: 20, label: () => this.busy ? '安装中…' : '安装到本地', enabled: !this.busy && this.meta.installable, onClick: () => this.install() },
      { x: cx + 4, y: u.h - 28, w: 150, h: 20, label: '返回', onClick: () => this.game.ui.open(this.parent) },
    ];
  }
  async install() {
    this.busy = true; this.layout();
    try {
      const d = await modFetchJSON(modLibraryURL('get', { id: this.meta.id }));
      const mod = await this.game.mods.installPublic(d.mod, d.code);
      this.game.ui.message('已安装：' + (mod && mod.name || this.meta.name), '#55FFFF');
      this.game.ui.open(this.parent);
      return;
    } catch (e) { this.game.ui.message('安装失败：' + e.message, '#FF5555'); }
    this.busy = false; this.layout();
  }
  drawExtra(ui) {
    const c = ui.ctx, m = this.meta;
    let y = 34;
    Font.draw(c, String(m.name || ''), 10, y, '#FFFF55'); y += 14;
    Font.draw(c, '作者：' + (m.author || '匿名') + '   版本：v' + (m.version || '?'), 10, y, '#55FFFF'); y += 12;
    Font.draw(c, '类型：' + (MOD_SIDES[m.side] || MOD_SIDES.both).label + '   大小：' + this.game.mods.sizeText(m.size || 0) + '   下载：' + (m.downloads || 0), 10, y, '#AAAAAA'); y += 12;
    if (m.tags && m.tags.length) { Font.draw(c, '标签：' + m.tags.join(' / '), 10, y, '#55FF55'); y += 12; }
    if (m.homepage) { Font.draw(c, '主页：' + String(m.homepage).slice(0, 60), 10, y, '#8080FF'); y += 12; }
    y += 2;
    const lines = wrapText(String(m.summary || '') + '\n' + String(m.description || ''), ui.w - 20, 10);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, y - 2, ui.w, ui.h - 60 - y);
    for (const line of lines) {
      if (y > ui.h - 44) break;
      Font.draw(c, line, 10, y, '#E0E0E0'); y += 11;
    }
  }
  onEsc() { this.game.ui.open(this.parent); }
}

function wrapText(text, maxW, fontSize) {
  const out = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      if (Font.width(line + ch) > maxW) { out.push(line); line = ch; }
      else line += ch;
    }
    if (line) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
class ModUploadScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '上传模组到公开库');
    this.bgDirt = true;
    this.parent = parent;
    this.name = '';
    this.author = ''; try { this.author = localStorage.getItem('mcjs-name') || ''; } catch (e) { }
    this.version = '1.0.0';
    this.summary = '';
    this.description = '';
    this.tags = '';
    this.side = 'both';
    this.installable = true;
    this.icon = '';
    this.code = "/*OPUSMOD\n{\"id\":\"my-mod\",\"name\":\"我的模组\",\"author\":\"匿名\",\"version\":\"1.0.0\",\"side\":\"both\"}\n*/\nOpusMods.register({\n  onLoad(api) {\n    api.ui.message('模组已加载！');\n  }\n});\n";
    this.captcha = null; this.captchaInfo = '';
    this.busy = false; this.field = 0; this.ta = null; this.descTa = null;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.fields = [
      { x: cx - 154, y: 30, w: 150, h: 16 },
      { x: cx + 4, y: 30, w: 150, h: 16 },
      { x: cx - 154, y: 52, w: 100, h: 16 },
      { x: cx - 50, y: 52, w: 204, h: 16 },
      { x: cx - 154, y: 74, w: 308, h: 16 },
    ];
    this.descBox = { x: cx - 154, y: 102, w: 308, h: 24 };
    this.codeBox = { x: cx - 154, y: 144, w: 308, h: 38 };
    this.widgets = [
      { x: cx - 154, y: 188, w: 100, h: 20, label: () => '类型: ' + (MOD_SIDES[this.side] || MOD_SIDES.both).label, onClick: () => { const a = ['both', 'client', 'server']; this.side = a[(a.indexOf(this.side) + 1) % a.length]; } },
      { x: cx - 50, y: 188, w: 100, h: 20, label: () => '可安装: ' + (this.installable ? '是' : '否'), onClick: () => { this.installable = !this.installable; } },
      { x: cx + 54, y: 188, w: 100, h: 20, label: () => this.icon ? '图标已选' : '选择图标', onClick: () => this.pickIcon() },
      { x: cx - 154, y: 212, w: 100, h: 20, label: () => this.captcha ? '✓ 已验证' : '人机验证', onClick: () => this.verify() },
      { x: cx - 50, y: 212, w: 100, h: 20, label: () => this.busy ? '上传中…' : '上传', enabled: !this.busy, onClick: () => this.upload() },
      { x: cx + 54, y: 212, w: 100, h: 20, label: '取消', onClick: () => this.cancel() },
    ];
    this.focus(0);
  }
  focus(i) {
    this.field = i;
    const f = this.fields[i], u = this.game.ui;
    const vals = [this.name, this.author, this.version, this.tags, this.summary];
    u.showInput(f.x + 3, f.y + 2, f.w - 6, f.h - 4, vals[i], () => this.focus((i + 1) % 5), {
      onInput: (v) => {
        if (i === 0) this.name = v.slice(0, 40);
        else if (i === 1) this.author = v.slice(0, 32);
        else if (i === 2) this.version = v.slice(0, 20);
        else if (i === 3) this.tags = v.slice(0, 120);
        else this.summary = v.slice(0, 200);
      },
      onEsc: () => this.cancel(), max: i === 3 ? 120 : (i === 4 ? 200 : 40),
    });
  }
  ensureTextareas() {
    if (this.descTa) return;
    const u = this.game.ui, s = u.scale / u.dpr;
    const mk = (box, val, max) => {
      const ta = document.createElement('textarea');
      ta.value = val; ta.maxLength = max;
      ta.style.cssText = 'position:absolute;z-index:20;background:rgba(0,0,0,0.9);color:#EEE;border:1px solid #55FFFF;padding:4px;font:11px/1.35 monospace;resize:none;outline:none;box-sizing:border-box;display:none;';
      ta.style.left = (box.x * s) + 'px'; ta.style.top = (box.y * s) + 'px';
      ta.style.width = (box.w * s) + 'px'; ta.style.height = (box.h * s) + 'px';
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      document.body.appendChild(ta);
      return ta;
    };
    this.descTa = mk(this.descBox, this.description, 4000);
    this.codeTa = mk(this.codeBox, this.code, 262144);
  }
  showDesc() { this.ensureTextareas(); this.game.ui.hideInput(); this.descTa.style.display = 'block'; this.descTa.focus(); }
  showCode() { this.ensureTextareas(); this.game.ui.hideInput(); this.codeTa.style.display = 'block'; this.codeTa.focus(); }
  hideTextareas() { if (this.descTa) this.descTa.style.display = 'none'; if (this.codeTa) this.codeTa.style.display = 'none'; }
  pickIcon() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = () => {
      const f = input.files && input.files[0]; if (!f) return;
      if (f.size > 45000) { this.game.ui.message('图标文件不能超过 45KB（服务器上限 64KB dataURL）', '#FF5555'); return; }
      const r = new FileReader();
      r.onload = () => { const u = String(r.result || ''); if (u.length > 64000) { this.game.ui.message('图标编码后超过 64KB，请换小一点的图片', '#FF5555'); return; } this.icon = u; this.hideTextareas(); this.layout(); this.game.ui.message('图标已选择（会在上传时校验尺寸）', '#55FFFF'); };
      r.readAsDataURL(f);
    };
    input.click();
  }
  async verify() {
    const cfg = window.OPUSMC_CONFIG || {};
    if (this.descTa) this.description = this.descTa.value;
    if (this.codeTa) this.code = this.codeTa.value;
    this.hideTextareas();
    try {
      if (cfg.geetestEnabled && cfg.geetestId) {
        const r = await ModCaptcha.geetest(cfg.geetestId);
        if (r) { this.captcha = r; this.captchaInfo = '极验 4.0'; this.game.ui.message('人机验证通过（极验 4.0）', '#55FF55'); return; }
        this.game.ui.message('已取消验证', '#AAAAAA'); return;
      }
    } catch (e) {
      this.game.ui.message('极验不可用：' + e.message + '，改用备用验证', '#FFAA00');
    }
    const r = await ModCaptcha.local();
    if (r) { this.captcha = r; this.captchaInfo = '备用滑块'; this.game.ui.message('人机验证通过（备用滑块）', '#55FF55'); }
  }
  async upload() {
    if (this.busy) return;
    this.hideTextareas(); this.game.ui.hideInput();
    this.description = this.descTa ? this.descTa.value : this.description;
    this.code = this.codeTa ? this.codeTa.value : this.code;
    if (!this.name.trim()) { this.game.ui.message('请填写模组名称', '#FF5555'); return; }
    if (!this.summary.trim()) { this.game.ui.message('请填写简介（别人会看到）', '#FF5555'); return; }
    if (!this.code.trim()) { this.game.ui.message('请填写模组代码', '#FF5555'); return; }
    if (!this.captcha) { this.game.ui.message('请先完成人机验证', '#FF5555'); return; }
    this.busy = true; this.layout();
    try {
      const payload = {
        name: this.name.trim(), author: this.author.trim() || '匿名', version: this.version.trim() || '1.0.0',
        summary: this.summary.trim(), description: this.description.trim(), side: this.side,
        tags: this.tags.split(/[,，\s]+/).filter(Boolean).slice(0, 8),
        installable: !!this.installable, icon: this.icon || '', code: this.code,
        captcha: this.captcha,
      };
      const d = await modFetchJSON(modLibraryURL('upload'), { method: 'POST', body: JSON.stringify(payload) });
      this.game.ui.message('上传成功：' + d.mod.name + '（' + d.mod.id + '）', '#55FF55');
      this.captcha = null;
      this.game.ui.open(new ModLibraryScreen(this.game, this.parent));
      return;
    } catch (e) {
      if (e.data && e.data.offline) {
        this.captcha = null;
        this.game.ui.message('极验服务不可用，请改用备用滑块验证', '#FFAA00');
        this.busy = false; this.layout();
        const r = await ModCaptcha.local();
        if (r) { this.captcha = r; this.captchaInfo = '备用滑块'; this.game.ui.message('人机验证通过（备用滑块），请再次点击上传', '#55FF55'); }
        else this.game.ui.message('已取消验证', '#AAAAAA');
        this.layout();
        return;
      }
      this.game.ui.message('上传失败：' + e.message, '#FF5555');
      if (e.data && e.data.duplicate) this.game.ui.message('重复模组 ID：' + (e.data.id || ''), '#FFAA00');
    }
    this.busy = false; this.layout();
  }
  cancel() { this.hideTextareas(); this.game.ui.open(this.parent); }
  onEsc() { this.cancel(); }
  close() { this.hideTextareas(); if (this.descTa) { this.descTa.remove(); this.descTa = null; } if (this.codeTa) { this.codeTa.remove(); this.codeTa = null; } }
  drawExtra(ui) {
    const c = ui.ctx;
    const labels = ['模组名称', '作者', '版本号', '标签（逗号分隔）', '一句话简介（公开显示，必填）'];
    this.fields.forEach((f, i) => {
      Font.draw(c, labels[i], f.x, f.y - 9, '#A0A0A0');
      ui.nine(i === this.field ? 'text_field_hl' : 'text_field', f.x, f.y, f.w, f.h, 1);
    });
    Font.draw(c, '详细说明（可选）', this.descBox.x, this.descBox.y - 9, '#A0A0A0');
    c.strokeStyle = '#55FFFF'; c.strokeRect(this.descBox.x, this.descBox.y, this.descBox.w, this.descBox.h);
    if (!this.descTa || this.descTa.style.display === 'none') Font.center(c, this.description ? this.description.slice(0, 70) : '点击编辑详细说明', this.descBox.x + this.descBox.w / 2, this.descBox.y + this.descBox.h / 2 - 4, this.description ? '#FFFFFF' : '#777777');
    Font.draw(c, '模组代码（JavaScript，必填）', this.codeBox.x, this.codeBox.y - 9, '#A0A0A0');
    c.strokeStyle = '#55FFFF'; c.strokeRect(this.codeBox.x, this.codeBox.y, this.codeBox.w, this.codeBox.h);
    if (!this.codeTa || this.codeTa.style.display === 'none') Font.center(c, '点击编辑代码', this.codeBox.x + this.codeBox.w / 2, this.codeBox.y + this.codeBox.h / 2 - 4, '#777777');
    Font.center(c, this.captchaInfo ? ('人机验证：' + this.captchaInfo + ' ✓') : '上传前需要完成极验 4.0 人机验证', ui.w / 2, 184, this.captchaInfo ? '#55FF55' : '#FFAA00');
  }
  mouseDown(ui, mx, my, b) {
    for (let i = 0; i < this.fields.length; i++) if (ui.hit(this.fields[i], mx, my)) { this.hideTextareas(); this.focus(i); return; }
    if (ui.hit(this.descBox, mx, my)) { this.showDesc(); return; }
    if (ui.hit(this.codeBox, mx, my)) { this.showCode(); return; }
    super.mouseDown(ui, mx, my, b);
  }
}

// ---------------------------------------------------------------------------
class ModsScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '模组');
    this.bgDirt = true;
    this.parent = parent;
    this.pauses = true;
    this.sel = -1;
    this.scroll = 0;
  }
  list() { return [...this.game.mods.mods.values()].sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''))); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, by = u.h - 134;
    const sel = this.selected();
    const hasCfg = !!(sel && sel.configSchema && sel.configSchema.length);
    this.widgets = [
      { x: cx - 154, y: by, w: 100, h: 20, label: '创建模组', onClick: () => this.game.ui.open(new ModCreateScreen(this.game, this)) },
      { x: cx - 50, y: by, w: 100, h: 20, label: '导入 .js', onClick: () => this.importFile() },
      { x: cx + 54, y: by, w: 100, h: 20, label: () => sel ? (sel.enabled ? '禁用选中' : '启用选中') : '启用/禁用', enabled: !!sel, onClick: () => this.toggle() },
      { x: cx - 154, y: by + 24, w: 100, h: 20, label: '配置…', enabled: hasCfg, onClick: () => this.openConfig() },
      { x: cx - 50, y: by + 24, w: 100, h: 20, label: '导出选中', enabled: !!sel && !sel.official, onClick: () => this.exportSel() },
      { x: cx + 54, y: by + 24, w: 100, h: 20, label: '复制直链', enabled: !!sel && !!sel.official, onClick: () => this.copyLink() },
      { x: cx - 154, y: by + 48, w: 100, h: 20, label: '直链下载', onClick: () => this.game.ui.open(new ModDownloadScreen(this.game, this)) },
      { x: cx - 50, y: by + 48, w: 100, h: 20, label: '删除选中', enabled: !!sel && !sel.official, onClick: () => this.del() },
      { x: cx + 54, y: by + 48, w: 100, h: 20, label: '模组帮助', onClick: () => this.game.ui.open(new ModHelpScreen(this.game, this)) },
      { x: cx - 154, y: by + 72, w: 100, h: 20, label: '重新加载', onClick: async () => { await this.game.mods.init(true); this.sel = -1; this.layout(); } },
      { x: cx - 50, y: by + 72, w: 100, h: 20, label: '完成', onClick: () => this.done() },
      { x: cx + 54, y: by + 72, w: 100, h: 20, label: '公开模组库', onClick: () => this.game.ui.open(new ModLibraryScreen(this.game, this)) },
    ];
    this.listY = 38;
    this.rowH = 28;
    this.listH = by - 8 - this.listY;
    this.vis = Math.max(1, Math.floor(this.listH / this.rowH));
  }
  selected() { const l = this.list(); return l[this.sel] || null; }
  toggle() { const s = this.selected(); if (!s) return; this.game.mods.setEnabled(s.id, !s.enabled); this.layout(); }
  openConfig() {
    const s = this.selected();
    if (!s || !s.configSchema) return;
    this.game.ui.open(new ModConfigScreen(this.game, this, s));
  }
  importFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.js,text/javascript';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => this.onImport(String(r.result || ''), f.name);
      r.onerror = () => this.game.ui.message('读取文件失败', '#FF5555');
      r.readAsText(f);
    };
    input.click();
  }
  onImport(text, filename) {
    const meta = ModManager.parseMeta(text) || { name: filename.replace(/\.js$/i, ''), author: '未知', version: '1.0.0', description: '导入的本地模组', side: 'both' };
    if (!text.trim()) { this.game.ui.message('文件是空的', '#FF5555'); return; }
    const mod = this.game.mods.addUserMod(meta, text);
    this.game.ui.message('已导入模组：' + mod.name, '#55FFFF');
    this.sel = -1; this.layout();
  }
  exportSel() {
    const s = this.selected();
    if (!s) return;
    if (s.official) { this.game.ui.message('官方模组不可导出', '#FF5555'); return; }
    const text = this.game.mods.exportText(s.id);
    if (!text) return;
    try {
      const blob = new Blob([text], { type: 'text/javascript' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = (s.name || 'mod') + '.js';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      this.game.ui.message('已导出 ' + s.name + '.js', '#55FFFF');
    } catch (e) { this.game.ui.message('导出失败：' + e.message, '#FF5555'); }
  }
  copyLink() {
    const s = this.selected(); if (!s) return;
    const link = this.game.mods.directLink(s.id);
    if (!link) { this.game.ui.message('官方模组直链不可用', '#FF5555'); return; }
    try { navigator.clipboard.writeText(link); this.game.ui.message('直链已复制：' + link, '#55FFFF'); }
    catch (e) { this.game.ui.message('直链：' + link, '#55FFFF'); }
  }
  del() {
    const s = this.selected(); if (!s) return;
    if (s.official) { this.game.ui.message('官方模组不能删除', '#FF5555'); return; }
    this.game.mods.removeUserMod(s.id);
    this.sel = -1; this.layout();
    this.game.ui.message('已删除模组：' + s.name, '#FFAA00');
  }
  done() {
    const g = this.game;
    if (g.worldMeta && g.mods) { g.worldMeta.mods = g.mods.activeIds(); if (g.state === 'play') g.saveWorld(true); }
    g.ui.open(this.parent || new TitleScreen(g));
  }
  onEsc() { this.done(); }
  drawExtra(ui) {
    const c = ui.ctx, list = this.list();
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, this.listY, ui.w, this.listH);
    if (this.game.mods.loadError) Font.draw(c, '⚠ ' + this.game.mods.loadError, 6, this.listY + 2, '#FFAA00');
    else if (!list.length) { Font.center(c, '还没有模组', ui.w / 2, this.listY + 20, '#FFAA00'); return; }
    const shown = list.slice(this.scroll, this.scroll + this.vis);
    shown.forEach((m, i) => {
      const idx = i + this.scroll, y = this.listY + i * this.rowH;
      if (idx === this.sel) { c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(4, y, ui.w - 8, this.rowH - 1); }
      const side = MOD_SIDES[m.side || 'both'] || MOD_SIDES.both;
      const tag = m.official ? '[官方]' : '[本地]';
      Font.draw(c, m.name, 10, y + 2, m.enabled ? '#FFFFFF' : '#777777');
      Font.draw(c, tag + ' v' + m.version, 10 + Font.width(m.name) + 6, y + 2, m.official ? '#55FFFF' : '#FFAA00');
      Font.draw(c, '[' + side.label + ']', 10 + Font.width(m.name) + Font.width(tag + ' v' + m.version) + 12, y + 2, side.color);
      Font.draw(c, m.enabled ? '开' : '关', ui.w - 22, y + 2, m.enabled ? '#55FF55' : '#FF5555');
      Font.draw(c, (m.author || '?') + ' · ' + (m.description || '').slice(0, 60), 10, y + 14, '#909090');
    });
  }
  mouseDown(ui, mx, my, b) {
    if (my >= this.listY && my < this.listY + this.listH) {
      const idx = Math.floor((my - this.listY) / this.rowH) + this.scroll;
      if (idx >= 0 && idx < this.list().length) { this.sel = idx; this.layout(); Sound.click(); return; }
    }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy), 0, Math.max(0, this.list().length - this.vis)); }
}

// ---------------------------------------------------------------------------
class ModConfigScreen extends MenuScreen {
  constructor(game, parent, mod) {
    super(game, mod.name + ' · 配置');
    this.bgDirt = true;
    this.pauses = true;
    this.parent = parent;
    this.mod = mod;
    this.schema = mod.configSchema || [];
    this.scroll = 0;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: u.h - 28, w: 150, h: 20, label: '恢复默认', onClick: () => { this.game.mods.resetConfig(this.mod.id); this.layout(); } },
      { x: cx + 4, y: u.h - 28, w: 150, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
    ];
    this.listY = 40;
    this.rowH = 26;
    this.listH = u.h - 80 - this.listY;
    this.vis = Math.max(1, Math.floor(this.listH / this.rowH));
  }
  val(key, def) { return this.game.mods.getConfig(this.mod.id, key, def); }
  drawExtra(ui) {
    const c = ui.ctx;
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, this.listY, ui.w, this.listH);
    const shown = this.schema.slice(this.scroll, this.scroll + this.vis);
    shown.forEach((f, i) => {
      const idx = i + this.scroll, y = this.listY + i * this.rowH + 4;
      const v = this.val(f.key, f.default);
      Font.draw(c, f.label || f.key, 12, y, '#FFFFA0');
      let valText = '';
      if (f.type === 'toggle') valText = v ? '开' : '关';
      else if (f.type === 'slider') valText = (Math.round(v * 100) / 100) + (f.unit || '');
      else if (f.type === 'select') valText = (f.options[v] || v);
      else valText = String(v);
      Font.draw(c, valText, ui.w - 12 - Font.width(valText), y, '#55FF55');
      if (f.desc) Font.draw(c, f.desc.slice(0, 70), 12, y + 11, '#808080');
    });
    if (this.scroll > 0) Font.center(c, '▲', ui.w - 10, this.listY + 2, '#AAAAAA');
    if (this.scroll + this.vis < this.schema.length) Font.center(c, '▼', ui.w - 10, this.listY + this.listH - 10, '#AAAAAA');
  }
  mouseDown(ui, mx, my, b) {
    if (my >= this.listY && my < this.listY + this.listH) {
      const idx = Math.floor((my - this.listY) / this.rowH) + this.scroll;
      const f = this.schema[idx];
      if (f) {
        const v = this.val(f.key, f.default);
        if (f.type === 'toggle') this.game.mods.setConfig(this.mod.id, f.key, !v);
        else if (f.type === 'slider') {
          const nv = clamp(v + (f.step || 0.1) * (mx < ui.w / 2 ? -1 : 1), f.min || 0, f.max || 1);
          this.game.mods.setConfig(this.mod.id, f.key, Math.round(nv * 1000) / 1000);
        } else if (f.type === 'select') {
          const keys = Object.keys(f.options);
          const ni = (keys.indexOf(String(v)) + 1) % keys.length;
          this.game.mods.setConfig(this.mod.id, f.key, keys[ni]);
        } else if (f.type === 'int') {
          this.game.mods.setConfig(this.mod.id, f.key, v + (mx < ui.w / 2 ? -1 : 1));
        }
        Sound.click();
        return;
      }
    }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy), 0, Math.max(0, this.schema.length - this.vis)); }
  onEsc() { this.game.ui.open(this.parent); }
}

// ---------------------------------------------------------------------------
class ModHelpScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '模组帮助');
    this.bgDirt = true;
    this.pauses = true;
    this.parent = parent;
    this.page = 0;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: u.h - 26, w: 74, h: 20, label: '< 上一页', onClick: () => { this.page = Math.max(0, this.page - 1); } },
      { x: cx - 76, y: u.h - 26, w: 152, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      { x: cx + 80, y: u.h - 26, w: 74, h: 20, label: '下一页 >', onClick: () => { this.page = Math.min(MOD_HELP_PAGES.length - 1, this.page + 1); } },
    ];
  }
  drawExtra(ui) {
    const c = ui.ctx, pg = MOD_HELP_PAGES[this.page];
    Font.center(c, pg.title + '  (' + (this.page + 1) + '/' + MOD_HELP_PAGES.length + ')', ui.w / 2, 24, '#FFFF55');
    let y = 42;
    for (const line of pg.lines) {
      if (y > ui.h - 44) break;
      if (line.startsWith('  ')) Font.draw(c, line.slice(2), ui.w / 2 - 140, y, '#A0E0A0');
      else if (line.startsWith('# ')) Font.draw(c, line.slice(2), ui.w / 2 - 150, y, '#FFAA00');
      else Font.draw(c, line, ui.w / 2 - 150, y, '#E0E0E0');
      y += 11;
    }
  }
  onEsc() { this.game.ui.open(this.parent); }
}

const MOD_HELP_PAGES = [
  { title: '模组使用', lines: [
    '# 如何启用/禁用模组',
    '主菜单 → 模组 → 选中模组 → 点「启用选中/禁用选中」',
    '官方模组默认全部启用，本地模组导入后自动启用',
    '',
    '# 模组类型',
    '[客户端] 仅本机生效，可改渲染/世界生成/菜单/HUD',
    '[服务端] 仅房主端在联机时生效，不能改渲染',
    '[双端]   客户端与服务端均生效（默认）',
    '',
    '# 模组配置',
    '部分模组支持配置：选中后点「配置…」',
    '点击配置项可切换/调节，值会自动保存',
    '连锁挖矿可配置：范围、最大数量、石头3×3、矿脉连锁',
    '',
    '# 快捷键',
    'U → 连锁挖矿开关',
    'M → 打开模组列表',
    'J → 示例模组：获得红宝石',
    'H → 游戏帮助',
    '',
    '# 公开模组库',
    '模组列表底部 → 「公开模组库」',
    '可搜索、安装；「上传模组」发布自己的模组',
    '上传需要完成极验 4.0 人机验证',
  ]},
  { title: '模组制作入门', lines: [
    '# 最小模组',
    'OpusMods.register({',
    '  onKey(api, code) {',
    '    if (code === "KeyG") api.ui.message("你好！");',
    '  }',
    '});',
    '',
    '# 设置模组类型',
    '在 /*OPUSMOD ...*/ 元信息里加 "side": "client"',
    '可选值: client / server / both',
    '',
    '# 客户端高权限 API',
    'OpusMods.game → Game 实例',
    'OpusMods.renderer → WebGL 渲染器',
    'OpusMods.hooks.onTitleDraw(fn) → 改标题画面',
    'OpusMods.hooks.onWorldGen(fn) → 改世界生成',
    'OpusMods.hooks.onEntityRender(fn) → 改实体渲染',
    'OpusMods.setTitle("文字") → 改标题',
    'OpusMods.addTitleButton("标签", onClick) → 加按钮',
  ]},
  { title: '模组配置与服务端', lines: [
    '# 声明配置项',
    'OpusMods.config.schema([',
    '  { key:"radius", type:"slider", label:"范围",',
    '    default:4, min:1, max:16, step:1 },',
    '  { key:"stone3x3", type:"toggle",',
    '    label:"石头3×3", default:true },',
    '  { key:"mode", type:"select",',
    '    label:"模式", default:"a",',
    '    options:{a:"模式A",b:"模式B"} }',
    ']);',
    '读取: OpusMods.config.get("radius", 4)',
    '',
    '# 服务端模组（受限）',
    'side: "server" 的模组只能在房主端运行',
    '不能访问 renderer / 世界生成 / 菜单',
    '可用于：聊天指令、权限、计分、联机规则',
    '',
    '# 导出与分享',
    '本地模组可「导出选中」为 .js 文件',
    '文件头带 /*OPUSMOD {...}*/ 元信息',
    '别人可通过「导入 .js」或「直链下载」安装',
  ]},
  { title: 'API 4.0 内容注册', lines: [
    '# 方块',
    'api.blocks.register({ key:"a:b", name:"名字",',
    '  texture:"redstone_block", hardness:2, tool:"pickaxe" })',
    '',
    '# 物品',
    'api.items.register({ key:"a:i", name:"物品",',
    '  tile:"i_diamond", stack:64 })',
    '',
    '# 配方 / 标签 / 熔炼 / 战利品',
    'api.recipes.shaped(result, n, pattern, keys)',
    'api.recipes.shapeless(result, n, [ing...])',
    'api.recipes.smelting(input, output, xp)',
    'api.tags.add("gems", ["a:i","diamond"])',
    'api.loot.register(blockKey, (api,ctx)=>[[key,n]])',
    '',
    '# 实体 / 世界生成',
    'api.entities.registerType("a:mob", {model:"zombie",...})',
    'api.worldgen.addOre({block:"a:b", size:4, count:2})',
    '',
    '# 事件 / 命令 / 按键 / 网络',
    'api.on("blockBreakPre", (api,ev)=>{ ev.cancel=true })',
    'api.commands.register("cmd", {run(api,args){...}})',
    'api.keybinds.register({key:"KeyK", run(){...}})',
    'api.network.register("a:chan", (api,data,from)=>{})',
    '',
    '# 自定义贴图',
    'api.assets.texture("a:tex", "data:image/png;base64,...")',
    '然后 texture:"a:tex" / tile:"a:tex"',
  ]},
];

// ---------------------------------------------------------------------------
class ModDownloadScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '直链下载模组');
    this.bgDirt = true;
    this.pauses = true;
    this.parent = parent;
    this.url = '';
    this.busy = false;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.urlField = { x: cx - 154, y: 74, w: 308, h: 20 };
    this.widgets = [
      { x: cx - 154, y: 108, w: 150, h: 20, label: () => this.busy ? '下载中…' : '下载并安装', enabled: !this.busy, onClick: () => this.download() },
      { x: cx + 4, y: 108, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(this.parent) },
    ];
    this.focus();
  }
  focus() {
    const u = this.game.ui, f = this.urlField;
    u.showInput(f.x + 4, f.y + 2, f.w - 8, f.h - 4, this.url, () => this.download(), {
      onInput: (v) => { this.url = v.trim(); },
      onEsc: () => u.open(this.parent), max: 512,
    });
  }
  download() {
    const url = this.url.trim();
    if (!/^https?:\/\//i.test(url)) { this.game.ui.message('请输入 http(s) 开头的直链', '#FF5555'); return; }
    this.busy = true;
    this.game.ui.message('正在下载：' + url, '#AAAAAA');
    fetch(url, { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(text => {
      if (!text || text.length > 320000) throw new Error('文件为空或过大（限 320KB）');
      const meta = ModManager.parseMeta(text) || {
        name: (url.split('/').pop() || '直链模组').replace(/\.js$/i, '').slice(0, 24),
        author: '直链下载', version: '1.0.0', description: '从 ' + url.slice(0, 80), side: 'both',
      };
      const mod = this.game.mods.addUserMod(meta, text);
      try {
        const blob = new Blob([text], { type: 'text/javascript' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (meta.name || 'mod') + '.js';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      } catch (e) { }
      this.busy = false;
      this.game.ui.message('已安装模组并保存到本地：' + mod.name, '#55FFFF');
      this.game.ui.open(this.parent);
    }).catch(e => {
      this.busy = false;
      this.game.ui.message('下载失败：' + e.message + '（可能是 403/CORS/网络问题）', '#FF5555');
    });
  }
  drawExtra(ui) {
    const c = ui.ctx;
    Font.draw(c, '模组直链（.js 文件 URL）', this.urlField.x, this.urlField.y - 10, '#A0A0A0');
    ui.nine('text_field', this.urlField.x, this.urlField.y, this.urlField.w, this.urlField.h, 1);
    Font.center(c, '例：https://你的域名/MC2/mods/chain-mining.js', ui.w / 2, 136, '#AAAAAA');
    Font.center(c, '注意：只导入你信任的模组（模组会执行 JS）', ui.w / 2, 164, '#FFAA00');
  }
  mouseDown(ui, mx, my, b) {
    if (ui.hit(this.urlField, mx, my)) { this.focus(); return; }
    super.mouseDown(ui, mx, my, b);
  }
  onEsc() { this.game.ui.open(this.parent); }
}

class ModCreateScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '创建模组');
    this.bgDirt = true;
    this.parent = parent;
    this.pauses = true;
    this.name = '我的模组';
    this.author = '匿名';
    try { this.author = localStorage.getItem('mcjs-name') || '匿名'; } catch (e) { }
    this.version = '1.0.0';
    this.description = '';
    this.side = 'both';
    this.field = 0;
    this.ta = null;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.fields = [
      { x: cx - 154, y: 30, w: 308, h: 16 },
      { x: cx - 154, y: 52, w: 140, h: 16 },
      { x: cx + 14, y: 52, w: 154, h: 16 },
      { x: cx - 154, y: 74, w: 308, h: 16 },
    ];
    this.codeBox = { x: cx - 154, y: 104, w: 308, h: 80 };
    this.widgets = [
      { x: cx - 154, y: u.h - 50, w: 150, h: 20, label: () => '类型: ' + (MOD_SIDES[this.side] || MOD_SIDES.both).label, onClick: () => { const sides = ['both', 'client', 'server']; this.side = sides[(sides.indexOf(this.side) + 1) % sides.length]; } },
      { x: cx + 4, y: u.h - 50, w: 150, h: 20, label: '保存模组', onClick: () => this.save() },
      { x: cx - 154, y: u.h - 26, w: 308, h: 20, label: '取消', onClick: () => this.cancel() },
    ];
    this.focus(0);
  }
  focus(i) {
    this.field = i;
    const f = this.fields[i], u = this.game.ui;
    const vals = [this.name, this.author, this.version, this.description];
    u.showInput(f.x + 3, f.y + 2, f.w - 6, f.h - 4, vals[i], () => this.focus((i + 1) % 4), {
      onInput: (v) => {
        if (i === 0) this.name = v.slice(0, 24);
        else if (i === 1) this.author = v.slice(0, 24);
        else if (i === 2) this.version = v.slice(0, 16);
        else this.description = v.slice(0, 200);
      },
      onEsc: () => this.cancel(), max: i === 3 ? 200 : 24,
    });
  }
  ensureTextarea() {
    if (this.ta) return;
    const ta = document.createElement('textarea');
    ta.value = "/*OPUSMOD\n{\"id\":\"my-mod\",\"name\":\"我的模组\",\"author\":\"匿名\",\"version\":\"1.0.0\",\"side\":\"both\"}\n*/\nOpusMods.register({\n  onKey(api, code) {\n    if (code === 'KeyG') api.ui.message('你好，模组！');\n  },\n  onBlockBreak(api, ctx) {\n    // ctx = { x, y, z, id, meta }\n  }\n});\n";
    const u = this.game.ui, s = u.scale / u.dpr;
    ta.style.cssText = 'position:absolute;z-index:20;background:rgba(0,0,0,0.88);color:#EEE;border:1px solid #55FFFF;padding:4px;font:11px/1.35 monospace;resize:none;outline:none;box-sizing:border-box;';
    ta.style.left = (this.codeBox.x * s) + 'px';
    ta.style.top = (this.codeBox.y * s) + 'px';
    ta.style.width = (this.codeBox.w * s) + 'px';
    ta.style.height = (this.codeBox.h * s) + 'px';
    ta.style.display = 'none';
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(ta);
    this.ta = ta;
  }
  showCode() { this.ensureTextarea(); this.ta.style.display = 'block'; this.ta.focus(); }
  hideCode() { if (this.ta) { this.ta.style.display = 'none'; } }
  save() {
    if (!this.name.trim()) { this.game.ui.message('模组名称不能为空', '#FF5555'); return; }
    const code = this.ta ? this.ta.value : '';
    if (!code.trim()) { this.game.ui.message('模组功能代码不能为空', '#FF5555'); return; }
    const mod = this.game.mods.addUserMod({
      name: this.name.trim(), author: this.author.trim() || '匿名',
      version: this.version.trim() || '1.0.0', description: this.description.trim(),
      side: this.side,
    }, code);
    this.game.ui.message('已创建模组：' + mod.name + '（' + (MOD_SIDES[this.side] || MOD_SIDES.both).label + '）', '#55FFFF');
    this.game.ui.open(new ModsScreen(this.game, this.parent));
  }
  cancel() { this.game.ui.open(this.parent); }
  onEsc() { this.cancel(); }
  close() { if (this.ta) { this.ta.remove(); this.ta = null; } }
  drawExtra(ui) {
    const c = ui.ctx;
    const labels = ['模组名称', '作者', '版本号', '简介'];
    this.fields.forEach((f, i) => {
      Font.draw(c, labels[i], f.x, f.y - 9, '#A0A0A0');
      ui.nine(i === this.field ? 'text_field_hl' : 'text_field', f.x, f.y, f.w, f.h, 1);
    });
    Font.draw(c, '模组功能（JavaScript）', this.codeBox.x, this.codeBox.y - 9, '#A0A0A0');
    c.strokeStyle = '#55FFFF'; c.strokeRect(this.codeBox.x, this.codeBox.y, this.codeBox.w, this.codeBox.h);
    if (!this.ta || this.ta.style.display === 'none') {
      Font.center(c, '点击这里编辑代码', this.codeBox.x + this.codeBox.w / 2, this.codeBox.y + this.codeBox.h / 2 - 4, '#808080');
    }
  }
  mouseDown(ui, mx, my, b) {
    for (let i = 0; i < this.fields.length; i++) if (ui.hit(this.fields[i], mx, my)) { this.hideCode(); this.focus(i); return; }
    if (ui.hit(this.codeBox, mx, my)) { this.game.ui.hideInput(); this.showCode(); return; }
    super.mouseDown(ui, mx, my, b);
  }
}
