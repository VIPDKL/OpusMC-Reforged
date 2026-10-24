/*OPUSMOD
{"id":"chain-mining","name":"连锁挖矿","author":"OpusMC","version":"2.0.0","side":"both","official":true}
*/
// 连锁挖矿 v2：可在模组配置里调范围/最大数量/石头3×3/矿脉连锁
// 快捷键 U 开关
(function () {
  let enabled = true;
  let cfg = { radius: 4, maxBlocks: 64, stone3x3: true, oreVein: true, showMsg: true };

  function loadCfg(api) {
    cfg.radius = api.config.get('radius', 4);
    cfg.maxBlocks = api.config.get('maxBlocks', 64);
    cfg.stone3x3 = api.config.get('stone3x3', true);
    cfg.oreVein = api.config.get('oreVein', true);
    cfg.showMsg = api.config.get('showMsg', true);
  }

  function isOre(id) {
    const b = BLOCKS[id];
    if (!b) return false;
    return /(ore|coal|diamond|emerald|redstone|lapis|gold_ore|iron_ore|copper_ore|nether_quartz|ancient_debris)/i.test(b.key);
  }
  function isStoneLike(id) {
    const b = BLOCKS[id];
    if (!b) return false;
    return /^(stone|cobblestone|andesite|diorite|granite|deepslate|tuff|netherrack|basalt|blackstone|dirt|sand|gravel)$/i.test(b.key);
  }

  OpusMods.config.schema([
    { key: 'radius', type: 'slider', label: '连锁范围', default: 4, min: 1, max: 16, step: 1, desc: '单次连锁最大搜索半径（格）' },
    { key: 'maxBlocks', type: 'slider', label: '最大方块数', default: 64, min: 1, max: 256, step: 1, desc: '单次连锁最多破坏的方块数' },
    { key: 'stone3x3', type: 'toggle', label: '石头3×3', default: true, desc: '挖石头类方块时连锁周围3×3' },
    { key: 'oreVein', type: 'toggle', label: '矿脉连锁', default: true, desc: '挖矿石时沿矿脉连锁整簇' },
    { key: 'showMsg', type: 'toggle', label: '开关提示', default: true, desc: '按 U 时显示状态消息' },
  ]);

  OpusMods.register({
    onLoad(api) { loadCfg(api); },
    onConfigChange(api, key, val) { loadCfg(api); },
    onKey(api, code) {
      if (code === 'KeyU') {
        enabled = !enabled;
        if (cfg.showMsg) api.ui.message(enabled ? '连锁挖矿：开' : '连锁挖矿：关', enabled ? '#55FF55' : '#FF5555');
      }
    },
    onBlockBreak(api, ctx) {
      if (!enabled) return;
      const g = api.game;
      if (!g || g.mode === 'creative') return;
      const { x, y, z, id } = ctx;
      const world = g.world;
      const broken = new Set();
      const queue = [[x, y, z]];
      let count = 0;
      const r = cfg.radius;
      const max = cfg.maxBlocks;

      if (cfg.oreVein && isOre(id)) {
        while (queue.length && count < max) {
          const [cx, cy, cz] = queue.shift();
          const key = cx + ',' + cy + ',' + cz;
          if (broken.has(key)) continue;
          if (Math.abs(cx - x) > r || Math.abs(cy - y) > r || Math.abs(cz - z) > r) continue;
          const cid = world.getBlock(cx, cy, cz);
          if (cid !== id && !isOre(cid)) continue;
          broken.add(key);
          count++;
          try { g.breakBlock(cx, cy, cz, false, true); } catch (e) { }
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            queue.push([cx + dx, cy + dy, cz + dz]);
          }
        }
      } else if (cfg.stone3x3 && isStoneLike(id)) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (count >= max) break;
          const cx = x + dx, cy = y + dy, cz = z + dz;
          const cid = world.getBlock(cx, cy, cz);
          if (isStoneLike(cid)) {
            try { g.breakBlock(cx, cy, cz, false, true); count++; } catch (e) { }
          }
        }
      }
      if (count > 1 && cfg.showMsg) api.ui.actionBar('连锁破坏 ' + count + ' 个方块', '#55FFFF');
    },
  });
})();
