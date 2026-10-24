<?php
// MC2 帮助页面：直接加载并可游玩
// 访问 https://users.66ghz.com/MC2/help.php 即可直接进入游戏
$deploy_path = '/MC2';
?><!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>MC2 · 帮助与快速游戏</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; font-family: monospace; }
  #game_canvas { display: block; width: 100vw; height: 100vh; image-rendering: pixelated; cursor: crosshair; }
  #loading { position: fixed; inset: 0; background: #1a1a2e; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; z-index: 100; }
  #loading h1 { font-size: 24px; margin-bottom: 16px; color: #55FF55; }
  #loading p { color: #aaa; margin: 4px 0; font-size: 13px; }
  .bar { width: 240px; height: 4px; background: #333; margin-top: 16px; border-radius: 2px; overflow: hidden; }
  .bar > div { height: 100%; background: #55FF55; width: 0%; transition: width 0.3s; }
  #help-btn { position: fixed; top: 8px; right: 8px; z-index: 50; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid #555; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: monospace; }
  #help-btn:hover { background: rgba(0,0,0,0.85); border-color: #55FF55; }
</style>
</head>
<body>
<div id="loading">
  <h1>MC2 正在加载…</h1>
  <p>初始化 WebGL 渲染器</p>
  <p>加载材质与资源</p>
  <p>生成世界中…</p>
  <div class="bar"><div id="loadbar"></div></div>
</div>
<button id="help-btn" onclick="showHelpOverlay()">帮助 (H)</button>
<canvas id="gl"></canvas>
<canvas id="ui"></canvas>
<input id="textinput" type="text" autocomplete="off" spellcheck="false">
<div id="boot" style="display:none"></div>
<div id="err"></div>

<div id="help-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:60;overflow-y:auto;padding:20px;color:#fff;font-size:13px;line-height:1.7;">
  <div style="max-width:700px;margin:0 auto;">
    <h2 style="color:#FFFF55;margin-bottom:12px;">MC2 操作说明</h2>
    <p><b style="color:#55FFFF;">移动：</b>W A S D | 空格跳跃 | Shift潜行 | Ctrl疾跑</p>
    <p><b style="color:#55FFFF;">视角：</b>鼠标移动 | 鼠标左键挖掘/攻击 | 右键放置/使用</p>
    <p><b style="color:#55FFFF;">物品：</b>滚轮/1-9切换 | E物品栏 | Q丢弃</p>
    <p><b style="color:#55FFFF;">界面：</b>Esc菜单 | F1隐藏UI | F3调试 | F5视角 | T聊天/命令</p>
    <p><b style="color:#55FFFF;">模组：</b>U连锁挖矿 | M模组列表 | H帮助</p>
    <hr style="border-color:#333;margin:12px 0;">
    <h3 style="color:#FFAA00;">生存入门</h3>
    <p>1. 撸树 → 合成木板 → 工作台 → 木镐</p>
    <p>2. 挖石头 → 石镐 → 熔炉 → 火把</p>
    <p>3. 挖矿 → 铁锭 → 铁装 → 钻石（Y&lt;16）</p>
    <p>4. 下界：黑曜石4×5框架 + 打火石点燃</p>
    <p>5. 末地：要塞末地传送门 + 末影之眼</p>
    <hr style="border-color:#333;margin:12px 0;">
    <h3 style="color:#FFAA00;">常用命令（需开启作弊）</h3>
    <p>/gamemode creative|survival | /time set day|night</p>
    <p>/give diamond 64 | /tp x y z | /summon zombie</p>
    <p>/dimension nether|end|overworld | /weather clear</p>
    <hr style="border-color:#333;margin:12px 0;">
    <h3 style="color:#FFAA00;">联机</h3>
    <p>房主：多人游戏 → 创建房间 → 显示加入IP</p>
    <p>游客：多人游戏 → 输入IP（格式 users.66ghz.com.MC2.房间号）</p>
    <p style="color:#888;margin-top:16px;">按 H 或点击右上角按钮关闭此帮助</p>
  </div>
</div>

<script>
window.QUICKPLAY = true;
window.HELP_PAGE = true;
let loadProgress = 0;
const loadTimer = setInterval(() => {
  loadProgress = Math.min(95, loadProgress + 8);
  document.getElementById('loadbar').style.width = loadProgress + '%';
}, 200);
function showHelpOverlay() {
  const o = document.getElementById('help-overlay');
  o.style.display = o.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyH') { e.preventDefault(); showHelpOverlay(); }
});
</script>
<script>window.OPUSMC_CONFIG = <?php $c = @include __DIR__ . '/config.php'; if (!is_array($c)) $c = array(); echo json_encode(array('geetestId' => isset($c['geetest_id']) ? $c['geetest_id'] : '', 'geetestEnabled' => !empty($c['geetest_enabled']), 'localFallback' => !empty($c['allow_local_fallback']), 'api' => 'api/mods.php', 'gameVersion' => '26.2'), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?></script>
<script src="js/assets.js"></script>
<script src="js/util.js"></script>
<script src="js/blocks.js"></script>
<script src="js/world.js"></script>
<script src="js/structures.js"></script>
<script src="js/mesher.js"></script>
<script src="js/render.js"></script>
<script src="js/audio.js"></script>
<script src="js/entity.js"></script>
<script src="js/ui.js"></script>
<script src="js/save.js"></script>
<script src="js/game.js"></script>
<script src="js/screens.js"></script>
<script src="js/net.js"></script>
<script src="js/official-mods.js"></script>
<script src="js/mods.js"></script>
<script src="js/main.js"></script>
<script>
// 等待游戏初始化完成后自动创建世界并进入
let quickStarted = false;
(function waitGame() {
  if (window.game && window.game.state === 'title' && window.game.ui && !quickStarted) {
    quickStarted = true;
    const seed = Math.floor(Math.random() * 2147483647);
    window.game.createWorld({
      name: '快速游戏',
      seed: String(seed),
      mode: 'creative',
      type: 'default',
      cheats: true,
      difficulty: 'normal'
    }).then(() => {
      document.getElementById('loading').style.display = 'none';
      clearInterval(loadTimer);
    }).catch(() => {
      document.getElementById('loading').style.display = 'none';
      clearInterval(loadTimer);
    });
    return;
  }
  setTimeout(waitGame, 150);
})();
</script>
</body>
</html>
