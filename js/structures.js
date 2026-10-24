'use strict';
// ---------------------------------------------------------------------------
// 结构生成：沙漠神殿 + 废弃矿井（从 BingoBST/Webgame 的结构思路合并并适配本项目的方块表）
// 每个区域只生成一个结构；同一结构跨区块时由各区块分别构建自己那一部分。
// ---------------------------------------------------------------------------
const Structures = {
  _pyr: new Map(),
  _mine: new Map(),

  _rng(seed, a, b) { return RNG(hashStr(seed + ':' + a + ':' + b)); },

  pyramidOrigin(world, rx, rz) {
    const key = world.seed + ':' + rx + ':' + rz;
    if (this._pyr.has(key)) return this._pyr.get(key);
    const r = this._rng('pyramid_region', world.seed, rx + ',' + rz);
    const REG = 8;
    let found = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cx = rx * REG + 1 + r.int(REG - 2);
      const cz = rz * REG + 1 + r.int(REG - 2);
      const wx = cx * 16 + 8, wz = cz * 16 + 8;
      const c = world.column(wx, wz);
      if (world.biomeOf(c) !== BI.DESERT || c.h < SEA + 1 || c.h > 92) continue;
      let minH = c.h, ok = true;
      for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
        const cn = world.column(wx + dx, wz + dz), bi = world.biomeOf(cn);
        if (cn.h <= SEA || (bi !== BI.DESERT && bi !== BI.BEACH && bi !== BI.PLAINS)) { ok = false; break; }
        if (cn.h < minH) minH = cn.h;
      }
      if (!ok) continue;
      found = { x: wx, y: Math.max(SEA + 2, minH), z: wz, cx: cx, cz: cz };
      break;
    }
    if (this._pyr.size > 1500) this._pyr.clear();
    this._pyr.set(key, found);
    return found;
  },

  buildPyramid(world, ch, p) {
    const x0 = ch.cx * 16, z0 = ch.cz * 16;
    if (x0 + 15 < p.x - 13 || x0 > p.x + 13 || z0 + 15 < p.z - 13 || z0 > p.z + 13) return;
    const B = ch.blocks, M = ch.meta;
    const set = (wx, wy, wz, id, meta = 0) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy >= HEIGHT) return;
      const i = (wy << 8) | (lz << 4) | lx;
      if (B[i] === 6) return;
      B[i] = id; M[i] = meta;
    };
    const fillDown = (wx, wy, wz, id) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return;
      for (let y = Math.min(wy, HEIGHT - 1); y >= 1; y--) {
        const i = (y << 8) | (lz << 4) | lx;
        if (B[i] === 6) break;
        if (y < wy && B[i] !== 0) break;
        B[i] = id; M[i] = 0;
      }
    };
    const S = BID.sandstone, CUT = BID.cut_sandstone, CHISEL = BID.chiseled_sandstone;
    const BLUE = BID.blue_terracotta, ORANGE = BID.orange_terracotta, SMOOTH = BID.smooth_sandstone;
    // 地基与清空
    for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
      const X = p.x + dx, Z = p.z + dz;
      fillDown(X, p.y - 1, Z, S);
      for (let dy = 0; dy <= 15; dy++) set(X, p.y + dy, Z, 0);
      set(X, p.y, Z, S);
    }
    // 阶梯金字塔外壳
    for (let l = 0; l < 5; l++) {
      const half = 10 - 2 * l, id = l === 0 ? CUT : l % 2 ? CHISEL : S;
      for (let dz = -half; dz <= half; dz++) for (let dx = -half; dx <= half; dx++) {
        if (Math.abs(dx) !== half && Math.abs(dz) !== half) continue;
        set(p.x + dx, p.y + l, p.z + dz, id);
      }
    }
    set(p.x, p.y + 5, p.z, CHISEL);
    // 地底密室
    const cy = p.y - 7;
    if (cy > 4) {
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        for (let dy = 0; dy <= 4; dy++) set(p.x + dx, cy + dy, p.z + dz, 0);
        set(p.x + dx, cy - 1, p.z + dz, S);
        if (Math.abs(dx) === 4 || Math.abs(dz) === 4) for (let dy = 0; dy <= 4; dy++) set(p.x + dx, cy + dy, p.z + dz, CHISEL);
      }
      // 地面风玫瑰图案
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const ax = Math.abs(dx), az = Math.abs(dz);
        if (ax === 0 && az === 0) set(p.x, cy, p.z, BLUE);
        else if ((ax === 1 && az === 0) || (ax === 0 && az === 1) || (ax === 2 && az === 2)) set(p.x + dx, cy, p.z + dz, ORANGE);
        else if (ax <= 3 && az <= 3) set(p.x + dx, cy, p.z + dz, SMOOTH);
      }
      // 4 个宝箱 + 中心 TNT
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) set(p.x + dx, cy, p.z + dz, BID.chest, 8);
      set(p.x, cy, p.z, BID.tnt);
      // 北侧阶梯入口
      for (let k = 0; k < 8; k++) {
        const y = p.y - 1 - k;
        set(p.x, y, p.z - 10 + k, 0);
        set(p.x + 1, y, p.z - 10 + k, 0);
        set(p.x, y - 1, p.z - 10 + k, S);
        set(p.x + 1, y - 1, p.z - 10 + k, S);
      }
    }
    ch.dirty = 0xFFFF;
  },

  mineshaftOrigin(world, rx, rz) {
    const key = world.seed + ':' + rx + ':' + rz;
    if (this._mine.has(key)) return this._mine.get(key);
    const r = this._rng('mineshaft_region', world.seed, rx + ',' + rz);
    const REG = 6;
    const cx = rx * REG + 1 + r.int(REG - 2), cz = rz * REG + 1 + r.int(REG - 2);
    const wx = cx * 16 + 8, wz = cz * 16 + 8;
    const c = world.column(wx, wz);
    const found = (c.h > 24) ? { x: wx, y: 18 + r.int(16), z: wz, cx: cx, cz: cz } : null;
    if (this._mine.size > 1500) this._mine.clear();
    this._mine.set(key, found);
    return found;
  },

  buildMineshaft(world, ch, p) {
    const x0 = ch.cx * 16, z0 = ch.cz * 16;
    if (x0 + 15 < p.x - 30 || x0 > p.x + 30 || z0 + 15 < p.z - 30 || z0 > p.z + 30) return;
    const B = ch.blocks, M = ch.meta;
    const air = (wx, wy, wz) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 2 || wy >= HEIGHT) return;
      const i = (wy << 8) | (lz << 4) | lx;
      if (B[i] === 6 || IS_FLUID[B[i]]) return;
      B[i] = 0; M[i] = 0;
    };
    const set = (wx, wy, wz, id, meta = 0) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 1 || wy >= HEIGHT) return;
      const i = (wy << 8) | (lz << 4) | lx;
      if (B[i] === 6) return;
      B[i] = id; M[i] = meta;
    };
    const carve = (wx, wy, wz) => { air(wx, wy, wz); air(wx, wy + 1, wz); air(wx, wy + 2, wz); };
    const PLANK = BID.oak_planks, LOG = BID.oak_log, RAIL = BID.rail, WEB = BID.cobweb;
    // 主巷道（沿 x）
    for (let dx = -26; dx <= 26; dx++) for (let dz = -1; dz <= 1; dz++) {
      carve(p.x + dx, p.y, p.z + dz);
      if (Math.abs(dx) % 2 === 0) set(p.x + dx, p.y - 1, p.z, RAIL);
      else set(p.x + dx, p.y - 1, p.z, PLANK);
      if (Math.abs(dx) % 8 === 0) {
        set(p.x + dx, p.y, p.z - 1, LOG); set(p.x + dx, p.y + 1, p.z - 1, LOG);
        set(p.x + dx, p.y, p.z + 1, LOG); set(p.x + dx, p.y + 1, p.z + 1, LOG);
        set(p.x + dx, p.y + 2, p.z - 1, PLANK); set(p.x + dx, p.y + 2, p.z, PLANK); set(p.x + dx, p.y + 2, p.z + 1, PLANK);
      }
    }
    // 三条支巷（沿 z）
    for (const bx of [-18, 0, 18]) for (let dz = -24; dz <= 24; dz++) for (let dx = -1; dx <= 1; dx++) {
      carve(p.x + bx + dx, p.y, p.z + dz);
      if (Math.abs(dz) % 2 === 0) set(p.x + bx, p.y - 1, p.z + dz, PLANK);
      if (Math.abs(dz) % 8 === 0) {
        set(p.x + bx + dx, p.y, p.z + dz, LOG); set(p.x + bx + dx, p.y + 1, p.z + dz, LOG);
      }
    }
    // 宝箱、刷怪笼、蛛网、火把
    const rr = this._rng('mineshaft_deco', world.seed, p.cx + ',' + p.cz);
    for (const [bx, bz] of [[-18, -24], [-18, 24], [18, -24], [18, 24], [0, 24]]) set(p.x + bx, p.y, p.z + bz, BID.chest, 8);
    set(p.x, p.y, p.z, BID.spawner);
    for (let i = 0; i < 80; i++) {
      const x = p.x - 20 + rr.int(40), z = p.z - 20 + rr.int(40), y = p.y + rr.int(3);
      if (Math.abs(x - p.x) > 3 || Math.abs(z - p.z) > 3) set(x, y, z, WEB);
    }
    for (let i = 0; i < 10; i++) {
      const x = p.x - 20 + rr.int(40), z = p.z - 20 + rr.int(40);
      if (Math.abs(z - p.z) <= 1) set(x, p.y + 2, z, BID.torch);
    }
    ch.dirty = 0xFFFF;
  },

  generateChunk(world, ch) {
    const rx = Math.floor(ch.cx / 8), rz = Math.floor(ch.cz / 8);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const p = this.pyramidOrigin(world, rx + a, rz + b);
      if (p) this.buildPyramid(world, ch, p);
    }
    const mx = Math.floor(ch.cx / 6), mz = Math.floor(ch.cz / 6);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const p = this.mineshaftOrigin(world, mx + a, mz + b);
      if (p) this.buildMineshaft(world, ch, p);
    }
  },

  findNearest(world, type, x, z) {
    let best = null, bd = 1e18;
    const dist = (p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (type === 'village') {
      for (const ch of world.chunks.values()) {
        if (!ch.village) continue;
        const p = { x: ch.cx * 16 + 8, y: 0, z: ch.cz * 16 + 8 };
        const d = dist(p); if (d < bd) { bd = d; best = p; }
      }
      return best ? [best.x, world.surfaceY(best.x, best.z) + 1, best.z] : null;
    }
    const region = type === 'desert_pyramid' ? 8 : 6;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const rx = Math.floor(cx / region), rz = Math.floor(cz / region);
    for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) {
      const p = type === 'desert_pyramid' ? this.pyramidOrigin(world, rx + a, rz + b) : type === 'mineshaft' ? this.mineshaftOrigin(world, rx + a, rz + b) : null;
      if (!p) continue;
      const d = dist(p); if (d < bd) { bd = d; best = p; }
    }
    return best ? [best.x, best.y, best.z] : null;
  },
};
