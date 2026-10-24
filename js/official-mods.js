// 由 mods/ 自动生成：官方模组内嵌代码，避免服务器 403 导致加载失败
window.OFFICIAL_MODS = [
  {
    "id": "chain-mining",
    "name": "连锁挖矿",
    "author": "OpusMC",
    "version": "2.0.0",
    "side": "both",
    "official": true,
    "file": "chain-mining.js",
    "description": "按 U 开关；可在模组配置里调范围、最大数量、石头3×3、矿脉连锁。",
    "code": "/*OPUSMOD\n{\"id\":\"chain-mining\",\"name\":\"连锁挖矿\",\"author\":\"OpusMC\",\"version\":\"2.0.0\",\"side\":\"both\",\"official\":true}\n*/\n// 连锁挖矿 v2：可在模组配置里调范围/最大数量/石头3×3/矿脉连锁\n// 快捷键 U 开关\n(function () {\n  let enabled = true;\n  let cfg = { radius: 4, maxBlocks: 64, stone3x3: true, oreVein: true, showMsg: true };\n\n  function loadCfg(api) {\n    cfg.radius = api.config.get('radius', 4);\n    cfg.maxBlocks = api.config.get('maxBlocks', 64);\n    cfg.stone3x3 = api.config.get('stone3x3', true);\n    cfg.oreVein = api.config.get('oreVein', true);\n    cfg.showMsg = api.config.get('showMsg', true);\n  }\n\n  function isOre(id) {\n    const b = BLOCKS[id];\n    if (!b) return false;\n    return /(ore|coal|diamond|emerald|redstone|lapis|gold_ore|iron_ore|copper_ore|nether_quartz|ancient_debris)/i.test(b.key);\n  }\n  function isStoneLike(id) {\n    const b = BLOCKS[id];\n    if (!b) return false;\n    return /^(stone|cobblestone|andesite|diorite|granite|deepslate|tuff|netherrack|basalt|blackstone|dirt|sand|gravel)$/i.test(b.key);\n  }\n\n  OpusMods.config.schema([\n    { key: 'radius', type: 'slider', label: '连锁范围', default: 4, min: 1, max: 16, step: 1, desc: '单次连锁最大搜索半径（格）' },\n    { key: 'maxBlocks', type: 'slider', label: '最大方块数', default: 64, min: 1, max: 256, step: 1, desc: '单次连锁最多破坏的方块数' },\n    { key: 'stone3x3', type: 'toggle', label: '石头3×3', default: true, desc: '挖石头类方块时连锁周围3×3' },\n    { key: 'oreVein', type: 'toggle', label: '矿脉连锁', default: true, desc: '挖矿石时沿矿脉连锁整簇' },\n    { key: 'showMsg', type: 'toggle', label: '开关提示', default: true, desc: '按 U 时显示状态消息' },\n  ]);\n\n  OpusMods.register({\n    onLoad(api) { loadCfg(api); },\n    onConfigChange(api, key, val) { loadCfg(api); },\n    onKey(api, code) {\n      if (code === 'KeyU') {\n        enabled = !enabled;\n        if (cfg.showMsg) api.ui.message(enabled ? '连锁挖矿：开' : '连锁挖矿：关', enabled ? '#55FF55' : '#FF5555');\n      }\n    },\n    onBlockBreak(api, ctx) {\n      if (!enabled) return;\n      const g = api.game;\n      if (!g || g.mode === 'creative') return;\n      const { x, y, z, id } = ctx;\n      const world = g.world;\n      const broken = new Set();\n      const queue = [[x, y, z]];\n      let count = 0;\n      const r = cfg.radius;\n      const max = cfg.maxBlocks;\n\n      if (cfg.oreVein && isOre(id)) {\n        while (queue.length && count < max) {\n          const [cx, cy, cz] = queue.shift();\n          const key = cx + ',' + cy + ',' + cz;\n          if (broken.has(key)) continue;\n          if (Math.abs(cx - x) > r || Math.abs(cy - y) > r || Math.abs(cz - z) > r) continue;\n          const cid = world.getBlock(cx, cy, cz);\n          if (cid !== id && !isOre(cid)) continue;\n          broken.add(key);\n          count++;\n          try { g.breakBlock(cx, cy, cz, false, true); } catch (e) { }\n          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {\n            if (dx === 0 && dy === 0 && dz === 0) continue;\n            queue.push([cx + dx, cy + dy, cz + dz]);\n          }\n        }\n      } else if (cfg.stone3x3 && isStoneLike(id)) {\n        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {\n          if (dx === 0 && dy === 0 && dz === 0) continue;\n          if (count >= max) break;\n          const cx = x + dx, cy = y + dy, cz = z + dz;\n          const cid = world.getBlock(cx, cy, cz);\n          if (isStoneLike(cid)) {\n            try { g.breakBlock(cx, cy, cz, false, true); count++; } catch (e) { }\n          }\n        }\n      }\n      if (count > 1 && cfg.showMsg) api.ui.actionBar('连锁破坏 ' + count + ' 个方块', '#55FFFF');\n    },\n  });\n})();\n"
  },
  {
    "id": "mod-info",
    "name": "显示所有模组",
    "author": "OpusMC",
    "version": "2.0.0",
    "side": "client",
    "official": true,
    "file": "mod-info.js",
    "description": "按 M 打开模组列表，显示名称/作者/版本/类型/配置。",
    "code": "/*OPUSMOD\n{\"id\":\"mod-info\",\"name\":\"显示所有模组\",\"author\":\"OpusMC\",\"version\":\"2.0.0\",\"side\":\"client\",\"official\":true}\n*/\nOpusMods.register({\n  id: 'mod-info',\n  onKey(api, code) {\n    if (code !== 'KeyM' || api.state !== 'play') return;\n    OpusMods.showModList();\n  }\n});\n"
  },
  {
    "id": "sample-content",
    "name": "示例：自定义方块与物品",
    "author": "OpusMC",
    "version": "1.0.0",
    "side": "both",
    "official": true,
    "file": "sample-content.js",
    "description": "演示方块/物品/配方/矿石生成/指令/按键/事件/配置的完整写法。",
    "code": "/*OPUSMOD\n{\"id\":\"sample-content\",\"name\":\"示例：自定义方块与物品\",\"author\":\"OpusMC\",\"version\":\"1.0.0\",\"side\":\"both\",\"official\":true}\n*/\n// 这个模组演示 Mod API 4.0 的内容注册：方块、物品、配方、矿石生成、\n// 指令、按键、事件与配置。你可以直接照抄改成自己的模组。\nOpusMods.config.schema([\n  { key: 'oreCount', type: 'slider', label: '每区块红宝石矿脉数', default: 2, min: 0, max: 8, step: 1 },\n]);\n\nOpusMods.register({\n  onLoad(api) {\n    // “重新加载”时方块/物品仍在注册表里，只跳过内容注册，命令与事件照常重建\n    if (!api.blocks.exists('example:ruby_block')) {\n      // 方块：贴图直接复用原版 redstone_block 的贴图名\n      api.blocks.register({\n        key: 'example:ruby_block', name: '红宝石块', texture: 'redstone_block',\n        hardness: 2.5, tool: 'pickaxe', level: 2, needsTool: true, light: 0,\n      });\n      // 物品：使用原版钻石贴图；也可以传 data:image/png;base64,... 自定义 16×16 图标\n      api.items.register({ key: 'example:ruby', name: '红宝石', tile: 'i_diamond', stack: 64 });\n      api.recipes.shaped('example:ruby_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'example:ruby' });\n      api.recipes.shapeless('example:ruby', 9, ['example:ruby_block']);\n      api.recipes.smelting('example:ruby', 'diamond', 0.5);\n      api.tags.add('gems', ['example:ruby', 'diamond', 'emerald']);\n    }\n\n    // 世界生成：地下 1~32 层生成小红宝石矿脉\n    api.worldgen.addOre({ block: 'example:ruby_block', size: 4, count: api.config.get('oreCount', 2), minY: 1, maxY: 32 });\n\n    // 指令：/ruby [数量]\n    api.commands.register('ruby', {\n      usage: '/ruby [数量]', description: '获得红宝石', permission: 'op',\n      run(api, args) {\n        const n = Math.max(1, Math.min(64, parseInt(args[0], 10) || 1));\n        api.player.give('example:ruby', n);\n        api.ui.message('已给予 ' + n + ' 个红宝石', '#55FFFF');\n        return 'ruby x' + n;\n      },\n    });\n\n    // 按键：J 给自己一个红宝石（可在模组列表里看到说明）\n    api.keybinds.register({\n      key: 'KeyJ', name: '示例：获得红宝石',\n      run(api) { api.player.give('example:ruby', 1); api.ui.actionBar('+1 红宝石', '#FF5555'); },\n    });\n\n    // 事件：破坏红宝石块时提示\n    api.events.on('blockBreak', (api, ev) => {\n      if (ev && ev.id === api.blocks.id('example:ruby_block')) api.ui.message('你挖掉了红宝石块！', '#FF5555');\n    });\n  },\n});\n"
  },
  {
    "id": "sample-mob",
    "name": "示例：自定义生物",
    "author": "OpusMC",
    "version": "1.0.0",
    "side": "both",
    "official": true,
    "file": "sample-mob.js",
    "description": "演示实体类型、掉落物与生成指令；模型可复用原版。",
    "code": "/*OPUSMOD\n{\"id\":\"sample-mob\",\"name\":\"示例：自定义生物\",\"author\":\"OpusMC\",\"version\":\"1.0.0\",\"side\":\"both\",\"official\":true}\n*/\n// 演示实体注册。模型可复用原版：zombie / skeleton / creeper / spider /\n// pig / cow / sheep / chicken / steve。自定义掉落物引用 sample-content 的红宝石。\nOpusMods.register({\n  onLoad(api) {\n    if (!api.entities.types()['example:guardian']) {\n      api.entities.registerType('example:guardian', {\n        name: '守卫者', health: 30, width: 0.8, height: 1.95, speed: 0.24,\n        model: 'zombie', hostile: true, attack: 4, tint: [0.35, 0.9, 1.0],\n        drops: [['example:ruby', 1, 3]],\n      });\n    }\n    api.commands.register('guardian', {\n      usage: '/guardian [数量]', description: '在面前生成守卫者', permission: 'op',\n      run(api, args) {\n        const n = Math.max(1, Math.min(10, parseInt(args[0], 10) || 1));\n        const p = api.player.pos, d = api.lookDir();\n        for (let i = 0; i < n; i++) {\n          api.entities.spawn('example:guardian', p[0] + d[0] * (3 + i), p[1] + 0.5, p[2] + d[2] * (3 + i));\n        }\n        api.ui.message('已生成 ' + n + ' 只守卫者', '#55FFFF');\n        return true;\n      },\n    });\n  },\n});\n"
  }
];
