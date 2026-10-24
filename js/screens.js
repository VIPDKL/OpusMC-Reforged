'use strict';
// ---------------------------------------------------------------------------
// Menu screens
// ---------------------------------------------------------------------------
const SPLASHES = ['也试试 Java 版！', '100% 纯手工打造！', '方块！', '在浏览器里运行！', '无需安装！', '还有苦力怕！', '挖矿与合成！', 'WebGL2！', '平滑光照！', '流动的水！', '会爆炸的 TNT！', '自带昼夜循环！', '小心岩浆！', '钻石！', '羊毛有很多颜色！', '现在可以联机了！', '和朋友一起挖矿！'];

class TitleScreen extends MenuScreen {
  constructor(game) { super(game, null); this.bgDim = 0; this.splash = SPLASHES[(Math.random() * SPLASHES.length) | 0]; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = u.h / 4 + 48;
    const g = this.game;
    const extra = g.titleExtraButtons || [];
    this.widgets = [
      { x: cx - 100, y, w: 200, h: 20, label: '单人游戏', onClick: () => this.game.ui.open(new WorldListScreen(this.game)) },
      { x: cx - 100, y: y + 24, w: 200, h: 20, label: '多人游戏', onClick: () => this.game.ui.open(new MultiplayerScreen(this.game)) },
      { x: cx - 100, y: y + 48, w: 200, h: 20, label: '模组', onClick: () => this.game.ui.open(new ModsScreen(this.game, this)) },
      { x: cx - 100, y: y + 72, w: 200, h: 20, label: '游戏说明', onClick: () => this.game.ui.open(new HelpScreen(this.game, this)) },
    ];
    let ey = y + 96;
    for (const eb of extra) {
      this.widgets.push({ x: cx - 100, y: ey, w: 200, h: 20, label: eb.label, onClick: eb.onClick });
      ey += 24;
    }
    this.widgets.push(
      { x: cx - 100, y: ey, w: 98, h: 20, label: '选项…', onClick: () => this.game.ui.open(new OptionsScreen(this.game, this)) },
      { x: cx + 2, y: ey, w: 98, h: 20, label: '全屏', onClick: () => toggleFullscreen() },
    );
  }
  drawExtra(ui) {
    const c = ui.ctx, w = ui.w;
    const gr = c.createLinearGradient(0, 0, 0, ui.h);
    gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = gr; c.fillRect(0, 0, ui.w, ui.h);
    const logoW = 256, logoH = 64;
    const lx = Math.floor(w / 2 - logoW / 2), ly = 30;
    c.imageSmoothingEnabled = true;
    if (this.game.customTitle) {
      Font.center(c, this.game.customTitle, w / 2, ly + 20, '#FFFFFF');
    } else {
      c.drawImage(ui.img.logo, 0, 0, 1024, 256, lx, ly, logoW, logoH);
      c.drawImage(ui.img.edition, 0, 0, 512, 64, Math.floor(w / 2 - 64), ly + 50, 128, 16);
    }
    c.imageSmoothingEnabled = false;
    c.save();
    c.translate(lx + logoW - 30, ly + 48);
    c.rotate(-20 * Math.PI / 180);
    const s = 1.8 - Math.abs(Math.sin(performance.now() / 1000 * Math.PI * 2 % (Math.PI * 2)) * 0.1);
    const sw = Font.width(this.splash);
    c.scale(s * 100 / (sw + 32) , s * 100 / (sw + 32));
    Font.center(c, this.splash, 0, -8, '#FFFF00');
    c.restore();
    Font.draw(c, 'Minecraft JS 复刻 v4 (MC2)', 2, ui.h - 10, '#FFFFFF');
    const t = '部署于 users.66ghz.com/MC2';
    Font.draw(c, t, ui.w - Font.width(t) - 2, ui.h - 10, '#FFFFFF');
    // 模组标题钩子
    this.game.mods && this.game.mods.fire('titleDraw', ui, this.game);
  }
}

class LoadingScreen extends MenuScreen {
  constructor(game, text) { super(game, null); this.text = text; this.bgDirt = true; this.pauses = false; }
  drawExtra(ui) {
    const c = ui.ctx, g = this.game, net = g.net;
    let p = g.loadProgress || 0;
    let msg = g.state === 'loading' ? '正在生成地形…' : this.text;
    if (net && net.progress > 0) {
      p = Math.max(p, net.progress);
      if (net.statusMessage && (net.status !== 'off' && net.status !== 'waiting')) msg = net.statusMessage;
    }
    if (net && net.status === 'waiting') msg = '房间已创建，等待玩家加入…';
    p = clamp(p, 0, 1);
    Font.center(c, msg, ui.w / 2, ui.h / 2 - 24, '#FFFFFF');
    const bw = 182, bx = Math.floor(ui.w / 2 - bw / 2), by = Math.floor(ui.h / 2);
    c.fillStyle = '#808080'; c.fillRect(bx, by, bw, 5);
    c.fillStyle = '#80FF80'; c.fillRect(bx, by, Math.floor(bw * p), 5);
    // 流动高光，避免看起来完全卡住
    const stripe = ((performance.now() / 900) % 1) * (bw + 40) - 40;
    const sx = Math.max(0, Math.min(bw - 1, stripe)), sw = Math.max(0, Math.min(32, bw - sx));
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(bx + sx, by, sw, 5);
    Font.center(c, Math.round(p * 100) + '%   区块: ' + (g.world ? g.world.chunks.size : 0), ui.w / 2, by + 12, '#A0A0A0');
    if (net && net.status === 'connecting') Font.center(c, '如果长时间无响应，请检查房间号/HTTPS/P2P 网络', ui.w / 2, by + 26, '#FFAA00');
  }
}

class WorldListScreen extends MenuScreen {
  constructor(game) { super(game, '选择世界'); this.bgDirt = true; this.worlds = null; this.sel = -1; this.scroll = 0; DB.listWorlds().then(w => { this.worlds = w; this.layout(); }); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, by = u.h - 124;
    const has = this.sel >= 0 && this.worlds && this.worlds[this.sel];
    this.widgets = [
      { x: cx - 154, y: by, w: 150, h: 20, label: '进入选中的世界', enabled: !!has, onClick: () => this.play() },
      { x: cx + 4, y: by, w: 150, h: 20, label: '创建新的世界', onClick: () => this.game.ui.open(new CreateWorldScreen(this.game, this)) },
      { x: cx - 154, y: by + 24, w: 72, h: 20, label: '删除', enabled: !!has, onClick: () => this.del() },
      { x: cx - 78, y: by + 24, w: 72, h: 20, label: '重命名', enabled: !!has, onClick: () => this.rename() },
      { x: cx - 154, y: by + 48, w: 150, h: 20, label: '开放联机…', enabled: !!has, onClick: () => this.game.ui.open(new LanScreen(this.game, this, this.worlds[this.sel])) },
      { x: cx + 4, y: by + 24, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(new TitleScreen(this.game)) },
      { x: cx - 154, y: by + 72, w: 150, h: 20, label: '导出选中', enabled: !!has, onClick: () => this.exportSel() },
      { x: cx + 4, y: by + 72, w: 150, h: 20, label: '导入存档', onClick: () => this.importFile() },
    ];
    this.listY = 36; this.listH = by - 8 - 36; this.titleY = 16;
  }
  play() { const w = this.worlds[this.sel]; if (w) this.game.loadWorld(w.id); }
  exportSel() {
    const w = this.worlds[this.sel];
    if (!w) { this.game.ui.message('请先选中一个世界', '#FF5555'); return; }
    this.game.exportWorldFile(w.id);
  }
  importFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const id = await this.game.importWorldFile(f);
      if (id) { this.worlds = await DB.listWorlds(); this.sel = -1; this.layout(); }
    };
    input.click();
  }
  async del() {
    const w = this.worlds[this.sel]; if (!w) return;
    if (this.confirmDel !== w.id) { this.confirmDel = w.id; this.game.ui.message(`再次点击“删除”以确认删除 “${w.name}”`, '#FF5555'); this.widgets[2].label = '确认删除？'; return; }
    await DB.deleteWorld(w.id); this.confirmDel = null; this.sel = -1;
    this.worlds = await DB.listWorlds(); this.layout();
  }
  rename() {
    const w = this.worlds[this.sel]; if (!w) return;
    const u = this.game.ui, cx = u.w / 2;
    u.showInput(cx - 100, this.listY + 4 + (this.sel - this.scroll) * 36, 200, 14, w.name, async (v) => { w.name = v.trim() || w.name; await DB.putWorld(w); u.hideInput(); });
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2;
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, this.listY, ui.w, this.listH);
    if (DB.backend === 'memory') Font.center(c, '注意：当前浏览器禁止本地存储，存档在关闭页面后会丢失', cx, this.listY + this.listH + 2 - 12, '#FF5555');
    if (!this.worlds) { Font.center(c, '载入中…', cx, this.listY + 20, '#AAAAAA'); return; }
    if (!this.worlds.length) Font.center(c, '还没有世界，点击“创建新的世界”开始吧！', cx, this.listY + 20, '#AAAAAA');
    const vis = Math.floor(this.listH / 36);
    this.worlds.slice(this.scroll, this.scroll + vis).forEach((w, i) => {
      const y = this.listY + 4 + i * 36, x = cx - 110, idx = i + this.scroll;
      if (idx === this.sel) { c.strokeStyle = '#FFFFFF'; c.lineWidth = 1; c.strokeRect(x - 2.5, y - 2.5, 225, 35); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x - 2, y - 2, 224, 34); }
      ui.drawItem({ id: w.mode === 'creative' ? item('grass_block') : item('iron_pickaxe'), count: 1 }, x + 4, y + 7);
      Font.draw(c, w.name, x + 28, y + 1, '#FFFFFF');
      Font.draw(c, new Date(w.lastPlayed).toLocaleString('zh-CN'), x + 28, y + 11, '#808080');
      const wt = WORLD_TYPES.find(t => t.id === ((w.opts && w.opts.type) || (w.flat ? 'flat' : 'default')));
      Font.draw(c, (w.mode === 'creative' ? '创造模式' : '生存模式') + '  ' + (wt ? wt.name : '默认') + '  种子: ' + w.seed, x + 28, y + 21, '#808080');
    });
  }
  mouseDown(ui, mx, my, b) {
    if (this.worlds && my >= this.listY && my < this.listY + this.listH && Math.abs(mx - ui.w / 2) < 112) {
      const i = Math.floor((my - this.listY - 4) / 36) + this.scroll;
      if (i < this.worlds.length && i >= 0) {
        const now = performance.now();
        if (this.sel === i && now - (this.lastT || 0) < 350) { this.play(); return; }
        this.sel = i; this.lastT = now; this.confirmDel = null; this.layout(); Sound.init(); Sound.click();
      }
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(ui, dy) { if (this.worlds) this.scroll = clamp(this.scroll + Math.sign(dy), 0, Math.max(0, this.worlds.length - Math.floor(this.listH / 36))); }
  onEsc() { this.game.ui.open(new TitleScreen(this.game)); }
}

const WORLD_TYPES = [
  { id: 'default', name: '默认', desc: '山地、森林、海洋、洞穴与矿石' },
  { id: 'flat', name: '超平坦', desc: '一望无际的草地，适合建筑' },
  { id: 'amplified', name: '放大化', desc: '地形起伏被放大，山峰更高、海沟更深' },
  { id: 'large_biomes', name: '大型生物群系', desc: '生物群系与地形特征尺寸更大' },
  { id: 'ocean', name: '海洋世界', desc: '大片海洋与岛屿，适合航海与水下探索' },
  { id: 'mountain', name: '山地世界', desc: '地势整体抬高，山峰与矿洞更多' },
  { id: 'snowy', name: '雪原世界', desc: '气候整体寒冷，冰雪群系占多数' },
];

class CreateWorldScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '创建新的世界');
    this.bgDirt = true; this.parent = parent;
    this.name = '新的世界'; this.seed = ''; this.mode = 'survival';
    this.type = 'default'; this.structures = true; this.bonusChest = false; this.cheats = false;
    this.rules = { keepInventory: false, hardcore: false };
    this.field = 0;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    const lx = cx - 154, rx = cx + 4;
    this.fields = [{ x: cx - 100, y: 50, w: 200, h: 20 }, { x: cx - 100, y: 80, w: 200, h: 20 }];
    const toggle = (x, y, label, get, set, tip) => ({ x, y, w: 150, h: 20, label: () => label + (get() ? '开' : '关'), onClick: () => set(!get()), tip });
    this.widgets = [
      { x: lx, y: 106, w: 150, h: 20, label: () => '游戏模式: ' + (this.mode === 'creative' ? '创造' : '生存'),
        onClick: () => { this.mode = this.mode === 'creative' ? 'survival' : 'creative'; },
        tip: ['生存：收集资源、合成、对抗怪物', '创造：无限方块、飞行、无敌'] },
      { x: rx, y: 106, w: 150, h: 20, label: () => '世界类型: ' + WORLD_TYPES.find(t => t.id === this.type).name,
        onClick: () => { const i = WORLD_TYPES.findIndex(t => t.id === this.type); this.type = WORLD_TYPES[(i + 1) % WORLD_TYPES.length].id; } },
      toggle(lx, 130, '生成结构: ', () => this.structures, v => this.structures = v, ['开启后地下会生成地牢与战利品箱']),
      toggle(rx, 130, '奖励箱: ', () => this.bonusChest, v => this.bonusChest = v, ['在出生点附近生成一个装有初始物资的箱子']),
      toggle(lx, 154, '允许作弊: ', () => this.cheats, v => this.cheats = v, ['开启后可以使用 /gamemode、/give 等命令']),
      { x: rx, y: 154, w: 150, h: 20, label: '随机种子', onClick: () => { this.seed = String((Math.random() * 2 ** 31) | 0); this.focus(1); } },
      { x: cx - 100, y: 178, w: 200, h: 20, label: () => '游戏规则：死亡不掉落 ' + (this.rules.keepInventory ? '开' : '关') + ' / 极限模式 ' + (this.rules.hardcore ? '开' : '关'),
        onClick: () => this.game.ui.open(new RulesScreen(this.game, this, this)) },
      { x: cx - 154, y: u.h - 28, w: 150, h: 20, label: '创建新的世界', onClick: () => this.create() },
      { x: cx + 4, y: u.h - 28, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(this.parent) },
    ];
    this.focus(this.field);
  }
  focus(i) {
    this.field = i;
    const f = this.fields[i], u = this.game.ui;
    u.showInput(f.x + 4, f.y + 2, f.w - 8, f.h - 4, i === 0 ? this.name : this.seed, () => this.create(),
      { onInput: (v) => { if (this.field === 0) this.name = v; else this.seed = v; }, onEsc: () => u.open(this.parent), max: 32 });
  }
  create() {
    this.game.ui.hideInput();
    this.game.createWorld(this.name.trim() || '新的世界', this.seed.trim(), this.mode,
      { type: this.type, structures: this.structures, bonusChest: this.bonusChest, cheats: this.cheats, rules: this.rules });
  }
  drawExtra(ui) {
    const c = ui.ctx;
    Font.draw(c, '世界名称', this.fields[0].x, this.fields[0].y - 11, '#A0A0A0');
    Font.draw(c, '世界生成器的种子（留空则随机）', this.fields[1].x, this.fields[1].y - 11, '#A0A0A0');
    this.fields.forEach((f, i) => { ui.nine(i === this.field ? 'text_field_hl' : 'text_field', f.x, f.y, f.w, f.h, 1); });
    const wt = WORLD_TYPES.find(t => t.id === this.type);
    Font.center(c, wt.desc, ui.w / 2, 200, '#FFFF55');
  }
  mouseDown(ui, mx, my, b) {
    for (let i = 0; i < 2; i++) if (ui.hit(this.fields[i], mx, my)) { this.focus(i); return; }
    super.mouseDown(ui, mx, my, b);
  }
  onEsc() { this.game.ui.open(this.parent); }
}

class MultiplayerScreen extends MenuScreen {
  constructor(game) {
    super(game, '多人游戏');
    this.bgDirt = true;
    let n = '';
    try { n = localStorage.getItem('mcjs-name') || ''; } catch (e) { }
    this.name = n || ('玩家' + (100 + Math.floor(Math.random() * 900)));
    this.addr = '';
    this.max = 8;
    this.busy = false;
    this.field = 0;
    this.lastError = (game.net && game.net.error) || '';
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.nameField = { x: cx - 154, y: 34, w: 308, h: 20 };
    this.addrField = { x: cx - 154, y: 62, w: 308, h: 20 };
    this.createPanel = { x: cx - 154, y: 90, w: 150, h: 58 };
    this.joinPanel = { x: cx + 4, y: 90, w: 150, h: 58 };
    const by = u.h - 26;
    this.widgets = [
      { x: cx - 150, y: 116, w: 142, h: 20, label: () => this.busy ? '请稍候…' : '创建房间（房主）', enabled: !this.busy, onClick: () => this.host() },
      { x: cx + 8, y: 116, w: 142, h: 20, label: () => this.busy ? '请稍候…' : '加入房间（游客）', enabled: !this.busy, onClick: () => this.join() },
      { x: cx - 154, y: 156, w: 30, h: 20, label: '−', enabled: !this.busy, onClick: () => this.setMax(-1) },
      { x: cx - 122, y: 156, w: 140, h: 20, label: () => '房间人数：' + this.max + ' 人', enabled: false, onClick: () => { } },
      { x: cx + 20, y: 156, w: 30, h: 20, label: '+', enabled: !this.busy, onClick: () => this.setMax(1) },
      { x: cx + 54, y: 156, w: 100, h: 20, label: '模组…', onClick: () => this.game.ui.open(new ModsScreen(this.game, this)) },
      { x: cx - 154, y: by, w: 100, h: 20, label: '返回', onClick: () => this.game.ui.open(new TitleScreen(this.game)) },
      { x: cx - 50, y: by, w: 100, h: 20, label: '粘贴地址', onClick: () => this.paste() },
      { x: cx + 54, y: by, w: 100, h: 20, label: () => this.game.net && this.game.net.room ? '复制房间码' : '默认地址', onClick: () => this.copyOrDefault() },
    ];
    this.focus(this.field);
  }
  setMax(d) { this.max = Math.max(2, Math.min(20, this.max + d)); this.layout(); }
  focus(i) {
    this.field = i;
    const u = this.game.ui, f = i === 0 ? this.nameField : this.addrField;
    u.showInput(f.x + 4, f.y + 2, f.w - 8, f.h - 4, i === 0 ? this.name : this.addr, () => { if (i === 0) this.focus(1); else this.join(); }, {
      onInput: (v) => {
        if (i === 0) { this.name = v.slice(0, 16); try { localStorage.setItem('mcjs-name', this.name); } catch (e) { } }
        else this.addr = v.slice(0, 120);
      },
      onEsc: () => u.open(new TitleScreen(this.game)), max: i === 0 ? 16 : 120,
    });
  }
  host() {
    if (!this.name.trim()) { this.game.ui.message('请先填写玩家名', '#FF5555'); this.focus(0); return; }
    this.busy = true; this.game.ui.hideInput();
    this.game.startHosting({ name: this.name.trim(), max: this.max });
  }
  join() {
    if (!this.name.trim()) { this.game.ui.message('请先填写玩家名', '#FF5555'); this.focus(0); return; }
    const addr = this.addr.trim();
    if (!addr) { this.game.ui.message('请输入房间号或完整地址', '#FF5555'); this.focus(1); return; }
    const code = (typeof extractRoomCode === 'function' ? extractRoomCode(addr) : '') || addr;
    if (!code) { this.game.ui.message('无法识别房间号', '#FF5555'); return; }
    this.busy = true; this.game.ui.hideInput();
    this.game.startJoining(code, this.name.trim());
  }
  async paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { this.addr = t.trim(); this.focus(1); }
    } catch (e) { this.game.ui.message('无法读取剪贴板，请手动输入', '#FF5555'); }
  }
  copyOrDefault() {
    const net = this.game.net;
    if (net && net.room) {
      const addr = 'users.66ghz.com.MC2.' + net.room;
      try { navigator.clipboard.writeText(addr); this.game.ui.message('已复制：' + addr, '#55FF55'); }
      catch (e) { this.game.ui.message('房间码：' + net.room, '#FFFF55'); }
      return;
    }
    this.addr = 'users.66ghz.com.MC2.';
    this.focus(1);
    this.game.ui.message('已填入默认服务器前缀，请补房间号', '#55FFFF');
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2;
    Font.draw(c, '玩家名', this.nameField.x, this.nameField.y - 10, '#A0A0A0');
    Font.draw(c, '房间号 / 服务器地址（如 ABC123 或 users.66ghz.com.MC2.ABC123）', this.addrField.x, this.addrField.y - 10, '#A0A0A0');
    ui.nine(this.field === 0 ? 'text_field_hl' : 'text_field', this.nameField.x, this.nameField.y, this.nameField.w, this.nameField.h, 1);
    ui.nine(this.field === 1 ? 'text_field_hl' : 'text_field', this.addrField.x, this.addrField.y, this.addrField.w, this.addrField.h, 1);
    // panels
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(this.createPanel.x, this.createPanel.y, this.createPanel.w, this.createPanel.h);
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(this.joinPanel.x, this.joinPanel.y, this.joinPanel.w, this.joinPanel.h);
    Font.center(c, '房主', this.createPanel.x + this.createPanel.w / 2, this.createPanel.y + 6, '#55FF55');
    Font.center(c, '创建后显示房间码', this.createPanel.x + this.createPanel.w / 2, this.createPanel.y + 20, '#A0A0A0');
    Font.center(c, '游客', this.joinPanel.x + this.joinPanel.w / 2, this.joinPanel.y + 6, '#55FFFF');
    Font.center(c, '输入房间号即可加入', this.joinPanel.x + this.joinPanel.w / 2, this.joinPanel.y + 20, '#A0A0A0');
    Font.center(c, '房主默认 OP；游客默认空物品栏，由房主决定给什么', cx, 182, '#AAAAAA');
    const net = this.game.net;
    if (net && net.room) Font.center(c, '当前房间：' + net.room + '  ·  ' + net.status, cx, 196, '#FFFF55');
    else if (this.lastError) Font.center(c, '上次错误：' + this.lastError.slice(0, 60), cx, 196, '#FF5555');
    else Font.center(c, '需要 HTTPS 与支持 WebRTC 的浏览器（Chrome/Edge）', cx, 196, '#808080');
  }
  mouseDown(ui, mx, my, b) {
    if (ui.hit(this.nameField, mx, my)) { this.focus(0); return; }
    if (ui.hit(this.addrField, mx, my)) { this.focus(1); return; }
    super.mouseDown(ui, mx, my, b);
  }
  onEsc() { this.game.ui.open(new TitleScreen(this.game)); }
}

class RulesScreen extends MenuScreen {
  constructor(game, parent, target) {
    super(game, '游戏规则');
    this.bgDirt = true;
    this.pauses = true;
    this.parent = parent;
    this.target = target || game.worldMeta;
    this.rules = Object.assign({ keepInventory: false, hardcore: false }, (this.target && this.target.rules) || game.rules || {});
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    const tg = (y, label, get, set, tip) => ({ x: cx - 100, y: y, w: 200, h: 20, label: () => label + ': ' + (get() ? '开' : '关'), onClick: () => { set(!get()); this.layout(); }, tip: tip });
    this.widgets = [
      tg(56, '死亡不掉落', () => this.rules.keepInventory, v => this.rules.keepInventory = v, ['开启后死亡不会掉落物品与经验']),
      tg(86, '极限模式', () => this.rules.hardcore, v => this.rules.hardcore = v, ['开启后死亡无法重生（建议创建世界时选择）']),
      { x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.done() },
    ];
  }
  done() {
    const g = this.game;
    this.rules.keepInventory = !!this.rules.keepInventory;
    this.rules.hardcore = !!this.rules.hardcore;
    g.rules = this.rules;
    if (this.target && this.target !== g) this.target.rules = this.rules;
    if (g.worldMeta) g.worldMeta.rules = this.rules;
    if (g.state === 'play') g.saveWorld(true);
    g.ui.message('游戏规则已更新：死亡不掉落 ' + (this.rules.keepInventory ? '开' : '关') + '，极限模式 ' + (this.rules.hardcore ? '开' : '关'), '#FFFF55');
    g.ui.open(this.parent);
  }
  drawExtra(ui) {
    Font.center(ui.ctx, '只影响当前世界；默认都为关闭', ui.w / 2, 36, '#AAAAAA');
    Font.center(ui.ctx, '极限模式开启后死亡只会回到标题屏幕', ui.w / 2, 118, '#808080');
    Font.center(ui.ctx, '联机时以房主的世界规则为准', ui.w / 2, 130, '#808080');
  }
  onEsc() { this.done(); }
}

class OptionsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '选项'); this.parent = parent; this.pauses = !(parent instanceof TitleScreen); this.bgDim = parent instanceof TitleScreen ? 0 : 0.6; this.bgDirt = parent instanceof TitleScreen; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, s = this.game.settings, g = this.game;
    const W = 98, X = [cx - 154, cx - 50, cx + 54];
    let idx = 0;
    const cell = () => X[idx++ % 3];
    const row = () => 36 + Math.floor((idx - 1) / 3) * 24;
    const sl = (label, val, set) => { const x = cell(); return { slider: true, x: x, y: row(), w: W, h: 20, value: val, label, onChange: (v) => { set(v); g.applySettings(); g.saveSettings(); } }; };
    const bt = (label, fn) => { const x = cell(); return { x: x, y: row(), w: W, h: 20, label, onClick: () => { fn(); g.applySettings(); g.saveSettings(); } }; };
    this.widgets = [
      bt(() => '画质: ' + (GRAPHICS_PRESETS[s.graphics] || GRAPHICS_PRESETS[2]).name, () => {
        s.graphics = ((s.graphics || 0) + 1) % GRAPHICS_PRESETS.length;
        const p = GRAPHICS_PRESETS[s.graphics];
        s.resScale = p.res; s.renderDist = p.dist; s.clouds = p.clouds; s.particles = p.particles;
        setTimeout(() => g.ui.resize(), 0);
      }),
      bt(() => '分辨率: ' + Math.round(s.resScale * 100) + '%', () => { s.resScale = s.resScale >= 1 ? 0.5 : s.resScale + 0.25; setTimeout(() => g.ui.resize(), 0); }),
      bt(() => '云: ' + (s.clouds ? '开' : '关'), () => s.clouds = !s.clouds),
      sl(() => '视野: ' + Math.round(s.fov), (s.fov - 30) / 80, v => s.fov = Math.round(30 + v * 80)),
      sl(() => '距离: ' + s.renderDist, (s.renderDist - 2) / 14, v => s.renderDist = Math.round(2 + v * 14)),
      sl(() => '灵敏度: ' + Math.round(s.sens * 200) + '%', s.sens, v => s.sens = Math.max(0.05, v)),
      sl(() => '亮度: ' + Math.round(s.gamma * 100) + '%', s.gamma, v => s.gamma = v),
      sl(() => '音效: ' + Math.round(s.volume * 100) + '%', s.volume, v => s.volume = v),
      sl(() => '音乐: ' + Math.round(s.music * 100) + '%', s.music, v => s.music = v),
      bt(() => '摇晃: ' + (s.bobbing ? '开' : '关'), () => s.bobbing = !s.bobbing),
      bt(() => '界面: ' + (s.guiScale || '自动'), () => { s.guiScale = (s.guiScale + 1) % 5; setTimeout(() => g.ui.resize(), 0); }),
      bt(() => '提示框: ' + (s.advTooltips ? '开' : '关'), () => s.advTooltips = !s.advTooltips),
      sl(() => '粒子: ' + Math.round(s.particles * 100) + '%', s.particles, v => s.particles = v),
      bt(() => '实体阴影: ' + (s.shadows !== false ? '开' : '关'), () => s.shadows = !(s.shadows !== false)),
      bt('全屏', () => toggleFullscreen()),
      { x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '完成', onClick: () => this.done() },
    ];
  }
  done() { this.game.saveSettings(); this.game.ui.open(this.parent); }
  onEsc() { this.done(); }
}

class LanScreen extends MenuScreen {
  constructor(game, parent, world) { super(game, '开放联机'); this.bgDirt = true; this.parent = parent; this.world = world; this.max = 8; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: 96, w: 30, h: 20, label: '−', onClick: () => { this.max = Math.max(2, this.max - 1); this.layout(); } },
      { x: cx - 122, y: 96, w: 140, h: 20, label: () => '人数：' + this.max + ' 人（含房主）', enabled: false, onClick: () => { } },
      { x: cx + 20, y: 96, w: 30, h: 20, label: '+', onClick: () => { this.max = Math.min(20, this.max + 1); this.layout(); } },
      { x: cx - 154, y: u.h - 28, w: 150, h: 20, label: '开放联机', onClick: () => this.open() },
      { x: cx + 4, y: u.h - 28, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(this.parent) },
    ];
    this.titleY = 20;
  }
  open() { this.game.startHostingWorld(this.world.id, this.max); }
  drawExtra(ui) {
    const c = ui.ctx;
    Font.center(c, '世界：' + this.world.name, ui.w / 2, 44, '#FFFF55');
    Font.center(c, '房主默认 OP，可用 /gamemode /give /tp 等指令', ui.w / 2, 60, '#AAAAAA');
    Font.center(c, '游客加入后没有指令权限', ui.w / 2, 72, '#AAAAAA');
    Font.center(c, '开放后左上角会显示 6 位房间码，按 Tab 看玩家列表', ui.w / 2, 120, '#808080');
  }
  onEsc() { this.game.ui.open(this.parent); }
}

class PauseScreen extends MenuScreen {
  constructor(game) { super(game, '游戏菜单'); this.pauses = true; this.titleY = 40; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = u.h / 4 + 8, g = this.game;
    this.widgets = [
      { x: cx - 102, y, w: 204, h: 20, label: '回到游戏', onClick: () => g.ui.close() },
      { x: cx - 102, y: y + 24, w: 98, h: 20, label: '进度', onClick: () => g.ui.open(new AdvancementsScreen(g, this)) },
      { x: cx + 4, y: y + 24, w: 98, h: 20, label: '统计信息', onClick: () => g.ui.open(new StatsScreen(g, this)) },
      { x: cx - 102, y: y + 48, w: 98, h: 20, label: '游戏说明', onClick: () => g.ui.open(new HelpScreen(g, this)) },
      { x: cx + 4, y: y + 48, w: 98, h: 20, label: () => '模式: ' + (g.mode === 'creative' ? '创造' : '生存'), onClick: () => { g.setMode(g.mode === 'creative' ? 'survival' : 'creative'); } },
      { x: cx - 102, y: y + 72, w: 98, h: 20, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      { x: cx + 4, y: y + 72, w: 98, h: 20, label: '游戏规则…', onClick: () => g.ui.open(new RulesScreen(g, this, g.worldMeta)) },
      { x: cx - 102, y: y + 96, w: 204, h: 20, label: '模组…', onClick: () => g.ui.open(new ModsScreen(g, this)) },
      { x: cx - 102, y: y + 120, w: 204, h: 20, label: '保存并退回到标题屏幕', onClick: () => g.quitToTitle() },
    ];
    if (g.net && g.net.status !== 'off') {
      this.widgets.push({ x: cx - 102, y: y + 144, w: 98, h: 20, label: '复制房间码',
        enabled: !!g.net.code, onClick: () => {
          if (!g.net.code) return;
          try { navigator.clipboard.writeText(g.net.code); g.ui.message('房间码已复制：' + g.net.code, '#55FFFF'); }
          catch (e) { g.ui.message('请手动记录房间码：' + g.net.code, '#FFAA00'); }
        } });
      this.widgets.push({ x: cx + 4, y: y + 144, w: 98, h: 20, label: '断开联机', onClick: () => g.quitToTitle() });
    }
  }
  onEsc() { this.game.ui.close(); }
}

const ADV_DESC = {
  wood: '用斧头砍下一块原木', crafting_table: '合成一个工作台', pickaxe: '合成一把木镐',
  stone_pickaxe: '用圆石升级你的镐', furnace: '合成一个熔炉', iron: '冶炼出一块铁锭',
  diamond: '挖到一颗钻石', bread: '烤一个面包', kill: '击杀一只怪物', armor: '穿上一件铁质盔甲',
  tnt: '引爆一个 TNT', deep: '到达世界深层', night: '度过第一个夜晚', build: '放置 100 个方块',
  farm: '收获成熟的小麦', cook: '烹饪一份食物', bow: '用弓射中目标', sleep: '在床上睡一觉',
};

class AdvancementsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '进度'); this.parent = parent; this.pauses = true; this.bgDim = 0.75; this.titleY = 14; this.scroll = 0; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.rowH = 20; this.listY = 40; this.listH = u.h - 40 - 70;
    this.vis = Math.max(1, Math.floor(this.listH / this.rowH));
    this.widgets = [
      { x: cx - 154, y: u.h - 52, w: 150, h: 20, label: () => '成就提示: ' + (this.game.settings.advToast !== false ? '开' : '关'),
        onClick: () => { this.game.settings.advToast = this.game.settings.advToast === false; this.game.saveSettings(); } },
      { x: cx + 4, y: u.h - 52, w: 150, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      { x: cx - 154, y: u.h - 28, w: 72, h: 20, label: '< 上一页', onClick: () => { this.scroll = Math.max(0, this.scroll - this.vis); } },
      { x: cx - 78, y: u.h - 28, w: 152, h: 20, label: () => '已完成 ' + this.doneCount() + ' / ' + Object.keys(ADVANCEMENTS).length, enabled: false, onClick: () => { } },
      { x: cx + 80, y: u.h - 28, w: 74, h: 20, label: '下一页 >', onClick: () => { this.scroll = Math.min(this.maxScroll(), this.scroll + this.vis); } },
    ];
  }
  doneCount() { return Object.keys(ADVANCEMENTS).filter(k => this.game.adv[k]).length; }
  maxScroll() { return Math.max(0, Object.keys(ADVANCEMENTS).length - this.vis); }
  drawExtra(ui) {
    const c = ui.ctx, keys = Object.keys(ADVANCEMENTS), done = this.doneCount();
    Font.center(c, '进度达成 ' + done + ' / ' + keys.length, ui.w / 2, 24, '#FFFF55');
    const bw = 182, bx = Math.floor(ui.w / 2 - bw / 2), by = 32;
    c.fillStyle = '#808080'; c.fillRect(bx, by, bw, 3);
    c.fillStyle = '#55FF55'; c.fillRect(bx, by, Math.floor(bw * done / keys.length), 3);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, this.listY - 2, ui.w, this.listH + 2);
    keys.slice(this.scroll, this.scroll + this.vis).forEach((k, i) => {
      const y = this.listY + i * this.rowH, got = !!this.game.adv[k], a = ADVANCEMENTS[k];
      if (got) { c.fillStyle = 'rgba(40,110,40,0.55)'; c.fillRect(4, y, ui.w - 8, this.rowH - 2); }
      ui.drawItem({ id: item(a[1]), count: 1 }, 8, y + 2);
      Font.draw(c, a[0], 30, y + 2, got ? '#FFFF55' : '#909090');
      Font.draw(c, got ? '已完成' : '未完成', 30 + Font.width(a[0]) + 8, y + 2, got ? '#55FF55' : '#707070');
      const desc = ADV_DESC[k] || '';
      Font.draw(c, desc, 30, y + 11, got ? '#C0C0A0' : '#707070');
    });
    if (this.scroll > 0) Font.center(c, '▲', ui.w - 10, this.listY, '#AAAAAA');
    if (this.scroll < this.maxScroll()) Font.center(c, '▼', ui.w - 10, this.listY + this.listH - 10, '#AAAAAA');
  }
  wheel(ui, dy) { this.scroll = clamp(this.scroll + Math.sign(dy) * 2, 0, this.maxScroll()); }
  onEsc() { this.game.ui.open(this.parent); }
}

class StatsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '统计信息'); this.parent = parent; this.pauses = true; this.bgDim = 0.75; }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) }]; }
  drawExtra(ui) {
    const g = this.game, s = g.stats, c = ui.ctx;
    const lines = [['游戏天数', Math.floor(g.worldTime / 24000) + 1], ['放置的方块', s.placed], ['挖掘的方块', s.mined], ['击杀的生物', s.kills], ['经验等级', g.xpLevel()], ['世界种子', g.world.seed]];
    lines.forEach(([a, b], i) => { Font.draw(c, a, ui.w / 2 - 100, 50 + i * 14, '#FFFFFF'); const t = String(b); Font.draw(c, t, ui.w / 2 + 100 - Font.width(t), 50 + i * 14, '#FFFF55'); });
  }
  onEsc() { this.game.ui.open(this.parent); }
}

class DeathScreen extends MenuScreen {
  constructor(game) { super(game, null); this.bgDim = 0; this.pauses = false; this.t = performance.now(); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = u.h / 4 + 72;
    const hc = this.game.rules && this.game.rules.hardcore;
    this.widgets = [
      { x: cx - 100, y, w: 200, h: 20, label: hc ? '极限模式：世界结束' : '重生', enabled: !hc, onClick: () => { if (!hc) this.game.respawn(); } },
      { x: cx - 100, y: y + 24, w: 200, h: 20, label: hc ? '回到标题屏幕' : '标题屏幕', onClick: () => { this.game.player.health = 20; this.game.player.deathTime = 0; if (!hc) this.game.respawn(); this.game.quitToTitle(); } },
    ];
  }
  draw(ui) {
    const c = ui.ctx;
    c.save(); c.translate(ui.w / 2, 60); c.scale(2, 2); Font.center(c, '你死了！', 0, 0, '#FFFFFF'); c.restore();
    Font.center(c, this.game.deathMsg || '', ui.w / 2, 85, '#FFFFFF');
    Font.center(c, '分数: ' + (this.game.deathScore || 0), ui.w / 2, 100, '#FFFF55');
    const ok = performance.now() - this.t > 1000;
    for (const w of this.widgets) { w.enabled = ok; ui.button(w); }
  }
}

class HelpScreen extends MenuScreen {
  constructor(game, parent) { super(game, '游戏说明'); this.parent = parent; this.pauses = true; this.bgDim = 0.8; this.bgDirt = parent instanceof TitleScreen; this.page = 0; this.titleY = 10; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: u.h - 52, w: 308, h: 20, label: '▶ 快速开始游戏（直接进入）', onClick: () => this.quickPlay() },
      { x: cx - 154, y: u.h - 26, w: 74, h: 20, label: '< 上一页', onClick: () => this.page = Math.max(0, this.page - 1) },
      { x: cx - 76, y: u.h - 26, w: 152, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      { x: cx + 80, y: u.h - 26, w: 74, h: 20, label: '下一页 >', onClick: () => this.page = Math.min(HELP_PAGES.length - 1, this.page + 1) },
    ];
  }
  quickPlay() {
    const g = this.game;
    g.ui.close();
    g.ui.message('正在创建世界…', '#AAAAAA');
    const seed = Math.floor(Math.random() * 2147483647);
    g.createWorld({ name: '快速游戏', seed: seed, mode: 'creative', type: 'default', cheats: true, difficulty: 'normal' });
  }
  drawExtra(ui) {
    const c = ui.ctx, pg = HELP_PAGES[this.page];
    Font.center(c, `${pg.title}  (${this.page + 1}/${HELP_PAGES.length})`, ui.w / 2, 24, '#FFFF55');
    let y = 40;
    for (const line of pg.lines) {
      if (y > ui.h - 40) break;
      const [k, v] = line.split('|');
      if (v !== undefined) { Font.draw(c, k, ui.w / 2 - 150, y, '#FFFFA0'); Font.draw(c, v, ui.w / 2 - 60, y, '#FFFFFF'); }
      else Font.draw(c, k, ui.w / 2 - 150, y, '#E0E0E0');
      y += 11;
    }
  }
  onEsc() { this.game.ui.open(this.parent); }
}
const HELP_PAGES = [
  { title: '基本操作', lines: ['W A S D|移动', '空格|跳跃 / 游泳上浮 / (创造) 双击切换飞行', '左 Shift|潜行（不会从边缘掉落）/ 飞行下降', '左 Ctrl 或 双击 W|疾跑', '鼠标移动|转动视角', '鼠标左键|挖掘方块 / 攻击生物（按住持续挖掘）', '鼠标右键|放置方块 / 使用物品 / 打开容器 / 吃东西 / 拉弓', '鼠标中键|选取方块', '滚轮 / 1-9|切换快捷栏', 'E|打开物品栏', 'Q|丢弃物品 (Ctrl+Q 丢弃一组)', 'F1 / F3 / F5|隐藏界面 / 调试信息 / 切换视角', 'F3 + B / F3 + G|显示碰撞箱 / 区块边界', 'F3 + Esc|暂停/继续游戏并保留调试屏', 'F3 + F4|快速切换创造/生存模式', 'F3 + T|重载数据包与模组', 'T 或 /|打开聊天与命令', 'Esc|游戏菜单（暂停）', '多人游戏|标题屏幕 → 多人游戏，创建或输入 6 位房间码'] },
  { title: '物品栏操作', lines: ['左键|拿起 / 放下整组物品', '右键|拿起一半 / 放下一个', 'Shift + 左键|快速移动物品', '按住左键拖动|在多个格子之间平均分配', '按住右键拖动|每个格子放一个', '双击|收集同类物品', '悬停 + 数字键|与快捷栏交换', '悬停 + Q|丢弃物品', '', '创造模式物品栏：点击顶部标签切换分类，', '滚轮滚动；最后一个标签可以搜索物品。', '把物品放到右下角的 X 格可以删除。'] },
  { title: '生存入门', lines: ['1. 徒手撸树获得原木，合成木板（在物品栏 2x2 合成格）', '2. 4 个木板合成工作台，右键打开 3x3 合成', '3. 木板竖放 2 个合成木棍，制作木镐', '4. 挖石头获得圆石，制作石镐、熔炉', '5. 煤炭 + 木棍合成火把，照亮洞穴防止怪物生成', '6. 用熔炉把粗铁冶炼成铁锭，制作铁镐与铁甲', '7. 铁镐可以挖掘钻石矿（在 Y<16 的深层）', '', '饥饿值不足时无法疾跑、不能回血，记得吃东西！', '夜晚会生成僵尸、骷髅、苦力怕和蜘蛛。', '摔落、溺水、岩浆、仙人掌都会造成伤害。', '按 Esc → 进度 查看你的成就目标。'] },
  { title: '常用配方', lines: ['工作台|4 木板 (2x2)', '木棍|2 木板竖放', '镐|上排 3 材料 + 中间竖放 2 木棍', '斧 / 锹 / 剑 / 锄|同原版摆法', '熔炉|8 圆石围一圈', '箱子|8 木板围一圈', '火把|煤炭/木炭 在 木棍 上方', '面包|3 小麦横排', 'TNT|火药与沙子交错 (5 火药 + 4 沙子)', '床|3 羊毛 + 3 木板，夜晚右键睡觉跳过黑夜', '弓 / 箭|木棍+线 / 燧石+木棍+羽毛', '桶|3 铁锭 V 形；可装水和熔岩', '盔甲|皮革/铁/钻石，同原版摆法', '其他: 楼梯、台阶、门、梯子、书架、砖块…'] },
  { title: '玩法机制', lines: ['• 平滑光照与环境光遮蔽，火把/荧石/熔岩发光', '• 真实的水与熔岩流动，水遇熔岩生成黑曜石/圆石', '• 沙子与沙砾会受重力下落', '• TNT 与苦力怕爆炸可以破坏地形并连锁引爆', '• 用锄头耕地、种小麦，骨粉催熟；树苗可以长成树', '• 用剪刀剪羊毛，用小麦/种子/胡萝卜引诱并繁殖动物', '• 熔炉冶炼矿石与烹饪食物，获得经验', '• 昼夜循环、月相、星空、云层、雨雪天气；床可跳过夜晚', '• 多种生物群系：平原、森林、桦木林、针叶林、', '  雪原、沙漠、山地、海洋、河流、沙滩', '• 世界自动保存，可在主菜单管理多个存档'] },
  { title: '命令 (按 T 或 /)', lines: ['/gamemode creative|survival|切换游戏模式', '/time set day|night|noon|<数值>|设置时间', '/weather clear|rain|设置天气', '/give <物品英文名> [数量]|给予物品，如 /give diamond 64', '/tp <x> <y> <z>|传送', '/summon <生物>|生成 pig cow sheep chicken zombie ...', '/kill|自杀', '/spawnpoint|设置重生点为当前位置', '/seed|显示世界种子', '/clear|清空物品栏', '/xp <数量>|获得经验', '/dimension nether|end|overworld|切换维度'] },
  { title: '下界与末地', lines: ['下界传送门|用黑曜石搭4×5框架，内部用打火石右键点燃', '进入下界|站在传送门内等待几秒即可传送', '下界特色|下界岩、灵魂沙、萤石、岩浆海、远古残骸', '末地传送门|在要塞中找到末地传送门框架，放入末影之眼', '末影龙|击败末影龙即可通关，龙蛋为纪念物', '返回主世界|击败龙后跳入返回传送门，或 /dimension overworld', '注意|跨维度时物品与经验保留，坐标会重新计算'] },
  { title: '结构生成', lines: ['村庄|平原/沙漠/针叶林生物群系会生成村庄，含房屋、农田、村民', '古城|深暗之域（Y<-40）会生成远古城市，有幽匿感测体', '废弃遗迹|海洋/河流底部会生成沉船与水下遗迹', '地牢|地下会生成僵尸/骷髅/蜘蛛刷怪笼', '要塞|地下深处生成，含末地传送门房间', '沙漠神殿|沙漠生物群系生成，内含宝箱与陷阱', '结构随世界种子固定，同一种子生成相同结构'] },
];

class ChatScreen extends MenuScreen {
  constructor(game, prefill = '') { super(game, null); this.bgDim = 0; this.isChat = true; this.prefill = prefill; this.hist = game.chatHistory || (game.chatHistory = []); this.hi = this.hist.length; }
  layout() {
    const u = this.game.ui;
    u.showInput(2, u.h - 14, u.w - 4, 12, this.prefill, (v) => { u.close(); if (v.trim()) { this.hist.push(v); runCommand(this.game, v.trim()); } }, { onEsc: () => u.close(), max: 256 });
    const el = u.input, prev = el.onkeydown;
    el.onkeydown = (e) => {
      if (e.key === 'ArrowUp' && this.hi > 0) { this.hi--; el.value = this.hist[this.hi]; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.hi = Math.min(this.hist.length, this.hi + 1); el.value = this.hist[this.hi] || ''; e.preventDefault(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.complete(el); }
      prev(e);
    };
  }
  complete(el) {
    const v = el.value, parts = v.split(' ');
    if (parts[0] === '/give' && parts.length === 2) { const m = Object.keys(ITEM_KEY).filter(k => k.startsWith(parts[1])); if (m.length) el.value = '/give ' + m[0]; }
    else if (parts[0] === '/summon' && parts.length === 2) { const m = Object.keys(MOB_TYPES).filter(k => k.startsWith(parts[1])); if (m.length) el.value = '/summon ' + m[0]; }
    else if (parts.length === 1) { const m = ['/gamemode', '/time', '/weather', '/give', '/tp', '/summon', '/kill', '/spawnpoint', '/seed', '/clear', '/xp', '/help'].filter(k => k.startsWith(v)); if (m.length) el.value = m[0] + ' '; }
  }
  draw(ui) { const c = ui.ctx; c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(2, ui.h - 14, ui.w - 4, 12); }
}

// ---------------------------------------------------------------------------
// 附魔台界面（从 Bingo 的附魔系统精简合并）
// ---------------------------------------------------------------------------
class EnchantScreen extends MenuScreen {
  constructor(game, parent, x, y, z) {
    super(game, '附魔台');
    this.bgDirt = true;
    this.pauses = true;
    this.parent = parent;
    this.pos = [x, y, z];
    this.offers = null;
  }
  held() { return this.game.player.inv.held; }
  applicable(key) {
    const h = this.held();
    if (!h) return false;
    const d = ITEMS[h.id];
    if (!d || !d.durability) return false;
    const kind = ENCHANTMENTS[key].kind;
    if (kind === 'any') return true;
    if (kind === 'weapon') return !!(d.tool && (d.tool.type === 'sword' || d.tool.type === 'axe')) || d.key === 'bow';
    if (kind === 'tool') return !!(d.tool && ['pickaxe', 'axe', 'shovel', 'hoe'].includes(d.tool.type));
    if (kind === 'armor') return !!d.armor;
    return false;
  }
  roll() {
    const keys = Object.keys(ENCHANTMENTS).filter(k => this.applicable(k));
    const out = [];
    for (let i = 0; i < 3 && keys.length; i++) {
      const idx = (Math.random() * keys.length) | 0;
      const key = keys.splice(idx, 1)[0];
      const max = Math.min(3, ENCHANTMENTS[key].max);
      const lvl = 1 + ((Math.random() * max) | 0);
      out.push({ key, lvl, lapis: lvl, xp: lvl });
    }
    return out;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    if (!this.offers) this.offers = this.roll();
    this.widgets = this.offers.map((o, i) => ({
      x: cx - 154, y: 66 + i * 30, w: 308, h: 24,
      label: () => '✦ ' + ENCHANTMENTS[o.key].cn + ' ' + ['', 'I', 'II', 'III', 'IV', 'V'][o.lvl] + '   ' + o.lapis + ' 青金石 / ' + o.xp + ' 级',
      onClick: () => this.apply(o),
    }));
    this.widgets.push({ x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.close() });
  }
  apply(o) {
    const g = this.game, p = g.player, h = this.held();
    if (!h) { g.ui.message('请先手持可附魔的物品', '#FF5555'); return; }
    const lv = g.xpLevel();
    const lapis = p.inv.count(item('lapis_lazuli'));
    if (lapis < o.lapis) { g.ui.message('需要 ' + o.lapis + ' 个青金石', '#FF5555'); return; }
    if (lv < o.xp) { g.ui.message('需要 ' + o.xp + ' 级经验', '#FF5555'); return; }
    p.inv.remove(item('lapis_lazuli'), o.lapis);
    p.xp = Math.max(0, g.xpTotalFor(Math.max(0, lv - o.xp)));
    if (!h.ench) h.ench = {};
    h.ench[o.key] = Math.max(h.ench[o.key] || 0, o.lvl);
    Sound.levelup();
    g.ui.message('附魔成功：' + ENCHANTMENTS[o.key].cn + ' ' + ['', 'I', 'II', 'III', 'IV', 'V'][o.lvl], '#C080FF');
    this.close();
  }
  close() {
    if (this.parent) this.game.ui.open(this.parent);
    else this.game.ui.close();
  }
  drawExtra(ui) {
    const c = ui.ctx, h = this.held();
    Font.center(c, h ? ('手持：' + ITEMS[h.id].cn) : '请先手持工具/武器/护甲', ui.w / 2, 40, h ? '#FFFF55' : '#FF5555');
    Font.center(c, '消耗青金石与经验等级；附魔会叠加到物品上', ui.w / 2, 52, '#AAAAAA');
    if (!this.offers || !this.offers.length) Font.center(c, '这件物品没有可用的附魔', ui.w / 2, 110, '#FFAA00');
    Font.center(c, '青金石：' + this.game.player.inv.count(item('lapis_lazuli')) + '   经验等级：' + this.game.xpLevel(), ui.w / 2, ui.h - 46, '#55FFFF');
  }
  onEsc() { this.close(); }
}

function runCommand(g, text) {
  const p = g.player, ui = g.ui;
  if (!text.startsWith('/')) {
    if (g.mods) {
      const ev = { text: text, cancel: false };
      if (!g.mods.fireCancelable('chat', ev)) return;
      text = ev.text;
    }
    if (g.net) g.net.say(text); else ui.message('<玩家> ' + text);
    return;
  }
  const [cmd, ...a] = text.slice(1).split(/\s+/);
  const modCmd = g.mods && g.mods.commands.get(cmd);
  const guest = !!(g.net && g.net.inGame && g.net.inGame() && g.net.role === 'guest');
  // 原版指令需要作弊；模组指令在单机/房主端不强制要求作弊，游客端只允许 permission:'all'
  if (!modCmd) {
    if (!g.commandsAllowed()) {
      ui.message(guest ? '游客没有使用原版指令的权限（只有房主可以使用）' : '此世界未开启作弊，请在创建世界时勾选“允许作弊”', '#FF5555');
      return;
    }
  } else if (guest && modCmd.permission !== 'all') {
    errGuest();
    return;
  }
  function errGuest() { ui.message('这个模组指令只允许房主/管理员使用', '#FF5555'); }
  const err = (m) => ui.message(m, '#FF5555');
  if (g.mods) {
    const ev = { command: cmd, args: a, text: text, cancel: false };
    if (!g.mods.fireCancelable('command', ev)) return;
  }
  if (modCmd) {
    if (modCmd.permission === 'op' && !g.isOp()) { err('该命令只有房主/管理员可以使用'); return; }
    try {
      const api = g.mods.apiFor(modCmd.owner);
      const ret = modCmd.run(api, a, { player: p, world: g.world, game: g, name: g.playerName || '玩家', raw: text });
      if (typeof ret === 'string' && ret) ui.message(ret, '#AAAAAA');
    } catch (e) { err('命令 /' + cmd + ' 出错：' + e.message); }
    return;
  }
  try {
    switch (cmd) {
      case 'help': {
        const extra = g.mods ? [...g.mods.commands.keys()].map(k => '/' + k).join(' ') : '';
        ui.message('可用命令: /gamemode /time /weather /give /tp /summon /kill /spawnpoint /seed /clear /xp /locate' + (extra ? '  ' + extra : ''), '#FFFF55');
        break;
      }
      case 'gamemode': case 'gm': {
        const m = { creative: 'creative', c: 'creative', 1: 'creative', survival: 'survival', s: 'survival', 0: 'survival' }[a[0]];
        if (!m) return err('用法: /gamemode creative|survival');
        g.setMode(m); break;
      }
      case 'time': {
        if (a[0] === 'set' || a[0] === 'add') {
          const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
          let v = named[a[1]] ?? parseInt(a[1]);
          if (isNaN(v)) return err('用法: /time set day|night|noon|midnight|<数值>');
          if (a[0] === 'set') g.worldTime = Math.floor(g.worldTime / 24000) * 24000 + v; else g.worldTime += v;
          ui.message('时间已设置为 ' + v, '#AAAAAA');
        } else ui.message('当前时间: ' + g.dayTime(), '#AAAAAA');
        break;
      }
      case 'weather': {
        if (a[0] === 'clear') { g.rainTarget = 0; g.weather = 0; g.weatherTimer = 24000; }
        else if (a[0] === 'rain' || a[0] === 'thunder') { g.rainTarget = 1; g.weather = 1; g.weatherTimer = 12000; }
        else return err('用法: /weather clear|rain');
        ui.message('天气已更改', '#AAAAAA'); break;
      }
      case 'give': {
        const key = (a[0] || '').replace('minecraft:', '');
        const id = ITEM_KEY[key];
        if (id === undefined) return err('未知物品: ' + key);
        const n = Math.max(1, Math.min(64 * 36, parseInt(a[1]) || 1));
        let left = n;
        while (left > 0) { const k = Math.min(left, maxStack(id)); const r = p.inv.add({ id, count: k, dmg: 0 }); if (r) { g.dropFromPlayer({ id, count: r, dmg: 0 }); } left -= k; }
        ui.message(`已将 ${n} 个 [${ITEMS[id].cn}] 给予玩家`, '#AAAAAA'); break;
      }
      case 'tp': {
        const v = a.map((s, i) => s.startsWith('~') ? p.pos[i] + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
        if (v.length < 3 || v.some(isNaN)) return err('用法: /tp <x> <y> <z>');
        p.pos = [v[0], v[1], v[2]]; p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
        ui.message(`已传送至 ${v.map(x => x.toFixed(1)).join(', ')}`, '#AAAAAA'); break;
      }
      case 'summon': {
        const t = (a[0] || '').replace('minecraft:', '');
        if (t === 'tnt') { g.addEntity(new PrimedTNT(g, Math.floor(p.pos[0]), p.pos[1], Math.floor(p.pos[2]))); break; }
        if (!MOB_TYPES[t]) return err('未知生物: ' + t + '（可用: ' + Object.keys(MOB_TYPES).join(' ') + '）');
        const d = g.lookDir();
        const m = new Mob(g, t, p.pos[0] + d[0] * 3, p.pos[1] + 0.5, p.pos[2] + d[2] * 3);
        m.persistent = true;
        g.addEntity(m);
        ui.message('已生成 ' + MOB_TYPES[t].cn, '#AAAAAA'); break;
      }
      case 'kill': if (g.mode === 'creative') { p.health = 0; p.die({ type: 'void' }); } else p.hurt(1000, { type: 'void' }); break;
      case 'spawnpoint': p.spawn = [Math.floor(p.pos[0]), Math.floor(p.pos[1]), Math.floor(p.pos[2])]; ui.message('已设置重生点', '#AAAAAA'); break;
      case 'seed': ui.message('种子: [' + g.world.seed + ']', '#FFFFFF'); break;
      case 'locate': {
        const type = (a[0] || '').toLowerCase();
        if (!['village', 'desert_pyramid', 'mineshaft'].includes(type)) return err('用法: /locate village|desert_pyramid|mineshaft');
        if (typeof Structures === 'undefined') return err('结构系统未加载');
        const pos = Structures.findNearest(g.world, type, p.pos[0], p.pos[2]);
        if (!pos) return err('附近没有找到 ' + type);
        ui.message('最近的 ' + type + ' 在 ' + pos.map(v => Math.round(v)).join(', ') + '（可用 /tp 传送）', '#55FFFF');
        break;
      }
      case 'clear': p.inv.slots.fill(null); ui.message('已清空物品栏', '#AAAAAA'); break;
      case 'xp': g.addXp(parseInt(a[0]) || 0); break;
      case 'dimension': case 'dim': {
        const d = (a[0] || '').toLowerCase();
        if (d !== 'overworld' && d !== 'nether' && d !== 'end') return err('用法: /dimension overworld|nether|end');
        g.changeDimension(d); break;
      }
      default: err('未知命令。输入 /help 查看帮助');
    }
  } catch (e) { err('命令出错: ' + e.message); }
}

Game.prototype.setMode = function (m) {
  this.mode = m;
  const p = this.player;
  if (m === 'survival') { p.flying = false; }
  this.ui.message('游戏模式已更新为' + (m === 'creative' ? '创造模式' : '生存模式'), '#AAAAAA');
  if (this.net && this.net.role === 'host' && this.net.status !== 'off') this.net.broadcast({ type: 'mode', mode: m });
};

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().then(() => { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']).catch(() => { }); }).catch(() => { });
  } else document.exitFullscreen();
}
