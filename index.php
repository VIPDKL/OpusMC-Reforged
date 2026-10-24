<?php
/**
 * OpusMC · PHP 入口
 * ---------------------------------------------------------------
 * 浏览器端游戏（WebGL2 + 原生 JavaScript），服务器端只需要 PHP：
 *   - 不需要 Python / Node / Composer / 数据库
 *   - 也不需要任何构建步骤：上传解压即可访问
 *
 * 部署位置示例：https://users.66ghz.com/MC/
 * 目录结构：
 *   MC/index.php      ← 本文件（唯一入口）
 *   MC/js/*.js        ← 游戏源码（原样保留，浏览器执行）
 *   MC/.htaccess      ← Apache 配置（非 Apache 主机自动忽略，不影响运行）
 *   MC/_check.php     ← 环境自检页（可选，确认 PHP 正常后建议删除）
 *
 * 兼容 PHP 5.4+，推荐 7.4 / 8.x。
 */

/* ---------- 模组库公开配置（只暴露 captcha_id，不暴露 key） ---------- */
$opus_cfg = @include __DIR__ . '/config.php';
if (!is_array($opus_cfg)) $opus_cfg = array();
$opus_public_cfg = array(
    'geetestId' => isset($opus_cfg['geetest_id']) ? $opus_cfg['geetest_id'] : '',
    'geetestEnabled' => !empty($opus_cfg['geetest_enabled']),
    'localFallback' => !empty($opus_cfg['allow_local_fallback']),
    'api' => 'api/mods.php',
    'gameVersion' => '26.2',
);

/* ---------- 资源清单（顺序必须与游戏加载顺序一致） ---------- */
$opusmc_scripts = array(
    'assets', 'util', 'blocks', 'world', 'structures', 'mesher', 'render',
    'audio', 'entity', 'ui', 'save', 'game', 'screens', 'net', 'official-mods', 'mods', 'main',
);

/**
 * 取 JS 文件的版本号（更新时间），用于给 URL 加 ?v=，
 * 这样更新游戏后浏览器不会继续用旧缓存。
 */
function opusmc_ver($name)
{
    $path = __DIR__ . '/js/' . $name . '.js';
    return is_file($path) ? filemtime($path) : 0;
}

/* ---------- 缺少 js 目录时给出明确提示，而不是白屏 ---------- */
if (!is_dir(__DIR__ . '/js')) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><meta charset="utf-8"><title>OpusMC 部署不完整</title>'
        . '<body style="font:16px/1.6 sans-serif;max-width:640px;margin:8vh auto;padding:0 20px">'
        . '<h2>部署不完整</h2><p>找不到 <code>js/</code> 目录。</p>'
        . '<p>请把压缩包里的整个 <code>MC</code> 文件夹（含 <code>index.php</code> 和 <code>js/</code>）'
        . '一起上传到服务器，而不是只传 <code>index.php</code>。</p>';
    exit;
}

/* ---------- 响应头 ---------- */
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: no-referrer');
/* 入口 HTML 不缓存，保证更新后立即生效；JS 由 .htaccess 做长缓存 + ?v= 控制 */
header('Cache-Control: no-cache, must-revalidate');
?><!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>Minecraft JS 复刻版</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
  canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; image-rendering: pixelated; }
  #ui { pointer-events: none; }
  #textinput { position: absolute; display: none; background: transparent; border: none; outline: none; color: #fff;
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif; padding: 0 2px; text-shadow: 2px 2px 0 #3f3f3f; z-index: 5; }
  #err { position: absolute; left: 10%; top: 30%; width: 80%; color: #fff; font: 18px sans-serif; white-space: pre-wrap; display: none; text-align: center; }
  #boot { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font: 16px "Microsoft YaHei", sans-serif; background: #ef323d; }
</style>
</head>
<body>
<canvas id="gl"></canvas>
<canvas id="ui"></canvas>
<input id="textinput" type="text" autocomplete="off" spellcheck="false">
<div id="boot">Minecraft JS 复刻版 · 正在加载…</div>
<div id="err"></div>
<noscript><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:16px sans-serif;background:#000;text-align:center;padding:20px">需要启用 JavaScript 才能运行本游戏。</div></noscript>
<?php foreach ($opusmc_scripts as $opusmc_name): ?>
<script src="js/<?php echo $opusmc_name; ?>.js?v=<?php echo opusmc_ver($opusmc_name); ?>"></script>
<?php endforeach; ?>
<script>window.OPUSMC_CONFIG = <?php echo json_encode($opus_public_cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;</script>
<script>
  // hide boot splash once the title screen is up
  (function wait() { if (window.game && window.game.state !== 'boot') document.getElementById('boot').style.display = 'none'; else setTimeout(wait, 100); })();
</script>
</body>
</html>
