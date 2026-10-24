/*OPUSMOD
{"id":"sample-content","name":"示例：自定义方块与物品","author":"OpusMC","version":"1.0.0","side":"both","official":true}
*/
// 这个模组演示 Mod API 4.0 的内容注册：方块、物品、配方、矿石生成、
// 指令、按键、事件与配置。你可以直接照抄改成自己的模组。
OpusMods.config.schema([
  { key: 'oreCount', type: 'slider', label: '每区块红宝石矿脉数', default: 2, min: 0, max: 8, step: 1 },
]);

OpusMods.register({
  onLoad(api) {
    // “重新加载”时方块/物品仍在注册表里，只跳过内容注册，命令与事件照常重建
    if (!api.blocks.exists('example:ruby_block')) {
      // 方块：贴图直接复用原版 redstone_block 的贴图名
      api.blocks.register({
        key: 'example:ruby_block', name: '红宝石块', texture: 'redstone_block',
        hardness: 2.5, tool: 'pickaxe', level: 2, needsTool: true, light: 0,
      });
      // 物品：使用原版钻石贴图；也可以传 data:image/png;base64,... 自定义 16×16 图标
      api.items.register({ key: 'example:ruby', name: '红宝石', tile: 'i_diamond', stack: 64 });
      api.recipes.shaped('example:ruby_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'example:ruby' });
      api.recipes.shapeless('example:ruby', 9, ['example:ruby_block']);
      api.recipes.smelting('example:ruby', 'diamond', 0.5);
      api.tags.add('gems', ['example:ruby', 'diamond', 'emerald']);
    }

    // 世界生成：地下 1~32 层生成小红宝石矿脉
    api.worldgen.addOre({ block: 'example:ruby_block', size: 4, count: api.config.get('oreCount', 2), minY: 1, maxY: 32 });

    // 指令：/ruby [数量]
    api.commands.register('ruby', {
      usage: '/ruby [数量]', description: '获得红宝石', permission: 'op',
      run(api, args) {
        const n = Math.max(1, Math.min(64, parseInt(args[0], 10) || 1));
        api.player.give('example:ruby', n);
        api.ui.message('已给予 ' + n + ' 个红宝石', '#55FFFF');
        return 'ruby x' + n;
      },
    });

    // 按键：J 给自己一个红宝石（可在模组列表里看到说明）
    api.keybinds.register({
      key: 'KeyJ', name: '示例：获得红宝石',
      run(api) { api.player.give('example:ruby', 1); api.ui.actionBar('+1 红宝石', '#FF5555'); },
    });

    // 事件：破坏红宝石块时提示
    api.events.on('blockBreak', (api, ev) => {
      if (ev && ev.id === api.blocks.id('example:ruby_block')) api.ui.message('你挖掉了红宝石块！', '#FF5555');
    });
  },
});
