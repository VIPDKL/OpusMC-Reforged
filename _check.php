<?php
/**
 * OpusMC · 环境自检页
 * 访问 https://你的域名/MC/_check.php 可确认 PHP 与文件是否就绪。
 * 确认无误后建议删除本文件（.htaccess 默认也已禁止访问它）。
 */
header('Content-Type: text/html; charset=utf-8');

$required = array(
    'assets', 'util', 'blocks', 'world', 'structures', 'mesher', 'render',
    'audio', 'entity', 'ui', 'save', 'game', 'screens', 'net', 'official-mods', 'mods', 'main',
);
$missing = array();
$total = 0;
foreach ($required as $name) {
    $file = __DIR__ . '/js/' . $name . '.js';
    if (is_file($file)) {
        $total += filesize($file);
    } else {
        $missing[] = 'js/' . $name . '.js';
    }
}
$php_ok = version_compare(PHP_VERSION, '5.4', '>=');
$api_ok = is_file(__DIR__ . '/api/signal.php');
$mods_api_ok = is_file(__DIR__ . '/api/mods.php') && is_file(__DIR__ . '/mods-api.php');
$mods_ok = is_file(__DIR__ . '/mods/index.json') && is_file(__DIR__ . '/mods/chain-mining.js') && is_file(__DIR__ . '/mods/mod-info.js');
$config_ok = is_file(__DIR__ . '/config.php');
$cfg = $config_ok ? @include __DIR__ . '/config.php' : array();
if (!is_array($cfg)) $cfg = array();
$geetest_ok = !empty($cfg['geetest_enabled']) && !empty($cfg['geetest_id']) && !empty($cfg['geetest_key']);
$data_dir = __DIR__ . '/data';
if (!is_dir($data_dir)) {
    @mkdir($data_dir, 0777, true);
}
$data_ok = is_dir($data_dir) && is_writable($data_dir);
$mods_dir = $data_dir . '/mods';
if (!is_dir($mods_dir)) @mkdir($mods_dir, 0777, true);
$mods_data_ok = is_dir($mods_dir) && is_writable($mods_dir);
$ok = $php_ok && !$missing && $api_ok && $data_ok && $mods_ok && $mods_api_ok && $config_ok && $mods_data_ok;

function h($s)
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}
function size_text($bytes)
{
    if ($bytes >= 1048576) {
        return round($bytes / 1048576, 2) . ' MB';
    }
    if ($bytes >= 1024) {
        return round($bytes / 1024, 1) . ' KB';
    }
    return $bytes . ' B';
}
?><!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpusMC 环境自检</title>
<style>
  body { font: 15px/1.7 -apple-system, "Microsoft YaHei", sans-serif; max-width: 640px; margin: 8vh auto; padding: 0 20px; background: #f6f7f9; color: #222; }
  h1 { font-size: 20px; }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 16px 20px; margin-top: 16px; }
  .ok { color: #128a3a; font-weight: 600; }
  .bad { color: #c0392b; font-weight: 600; }
  code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; }
  ul { margin: 6px 0; padding-left: 22px; }
  .muted { color: #777; font-size: 13px; }
</style>
</head>
<body>
<h1>OpusMC 环境自检</h1>
<div class="card">
  <p>总体结果：
    <?php if ($ok): ?>
      <span class="ok">✓ 一切正常，可以访问 <a href="./">游戏入口</a></span>
    <?php else: ?>
      <span class="bad">✗ 存在问题，见下方</span>
    <?php endif; ?>
  </p>
  <ul>
    <li>PHP 版本：<code><?php echo h(PHP_VERSION); ?></code>
      <?php echo $php_ok ? '<span class="ok">✓</span>' : '<span class="bad">✗ 需要 5.4 及以上（推荐 7.4 / 8.x）</span>'; ?>
    </li>
    <li>游戏文件：<?php echo $missing ? '<span class="bad">✗ 缺少 ' . count($missing) . ' 个文件</span>' : '<span class="ok">✓ ' . count($required) . ' 个 JS 全部就绪（' . h(size_text($total)) . '）</span>'; ?></li>
    <li>联机信令：<?php echo $api_ok ? '<span class="ok">✓ api/signal.php 就绪</span>' : '<span class="bad">✗ 缺少 api/signal.php（联机不可用）</span>'; ?></li>
    <li>联机数据目录：<?php echo $data_ok ? '<span class="ok">✓ data/ 可写</span>' : '<span class="bad">✗ data/ 不可写，请把 data 目录权限设为 755/777</span>'; ?></li>
    <li>公开模组库接口：<?php echo $mods_api_ok ? '<span class="ok">✓ api/mods.php + mods-api.php 就绪</span>' : '<span class="bad">✗ 缺少 api/mods.php 或 mods-api.php</span>'; ?></li>
    <li>模组库数据目录：<?php echo $mods_data_ok ? '<span class="ok">✓ data/mods/ 可写</span>' : '<span class="bad">✗ data/mods/ 不可写，请把 data 目录权限设为 755/777</span>'; ?></li>
    <li>服务端配置：<?php echo $config_ok ? '<span class="ok">✓ config.php 就绪</span>' : '<span class="bad">✗ 缺少 config.php</span>'; ?></li>
    <li>极验行为验证 4.0：<?php echo $geetest_ok ? '<span class="ok">✓ 已填写 captcha_id / key</span>' : '<span class="bad">✗ 未配置，上传将只使用内置滑块验证</span>'; ?></li>
    <li>官方模组：<?php echo $mods_ok ? '<span class="ok">✓ mods/ 就绪（连锁挖矿、显示所有模组、两个 API 示例）</span>' : '<span class="bad">✗ 缺少 mods/ 目录或官方模组文件</span>'; ?></li>
  </ul>
  <?php if ($missing): ?>
  <p class="bad">缺少以下文件：</p>
  <ul><?php foreach ($missing as $m): ?><li><code><?php echo h($m); ?></code></li><?php endforeach; ?></ul>
  <p>请把压缩包里的整个 <code>MC</code> 文件夹（含 <code>js</code> 子目录）重新上传。</p>
  <?php endif; ?>
</div>
<div class="card muted">
  <p>游戏本身运行在浏览器端（WebGL2），不需要数据库、Python 或 Node。本页只用于确认 PHP 与文件是否就绪。</p>
  <p>确认正常后建议删除本文件 <code>_check.php</code>。</p>
</div>
</body>
</html>
