/*OPUSMOD
{"id":"sample-mob","name":"示例：自定义生物","author":"OpusMC","version":"1.0.0","side":"both","official":true}
*/
// 演示实体注册。模型可复用原版：zombie / skeleton / creeper / spider /
// pig / cow / sheep / chicken / steve。自定义掉落物引用 sample-content 的红宝石。
OpusMods.register({
  onLoad(api) {
    if (!api.entities.types()['example:guardian']) {
      api.entities.registerType('example:guardian', {
        name: '守卫者', health: 30, width: 0.8, height: 1.95, speed: 0.24,
        model: 'zombie', hostile: true, attack: 4, tint: [0.35, 0.9, 1.0],
        drops: [['example:ruby', 1, 3]],
      });
    }
    api.commands.register('guardian', {
      usage: '/guardian [数量]', description: '在面前生成守卫者', permission: 'op',
      run(api, args) {
        const n = Math.max(1, Math.min(10, parseInt(args[0], 10) || 1));
        const p = api.player.pos, d = api.lookDir();
        for (let i = 0; i < n; i++) {
          api.entities.spawn('example:guardian', p[0] + d[0] * (3 + i), p[1] + 0.5, p[2] + d[2] * (3 + i));
        }
        api.ui.message('已生成 ' + n + ' 只守卫者', '#55FFFF');
        return true;
      },
    });
  },
});
