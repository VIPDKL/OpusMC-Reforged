<?php
/**
 * OpusMC 公开模组库 API v1
 * ------------------------------------------------------------------
 * 纯 PHP + 文件存储，不需要数据库。
 *
 *   GET  api/mods.php?action=config     公开配置（极验 captcha_id 等）
 *   GET  api/mods.php?action=captcha    获取内置滑块验证挑战
 *   GET  api/mods.php?action=list&q=&sort=&page=1&limit=20
 *   GET  api/mods.php?action=get&id=xxx 获取元数据 + 代码
 *   GET  api/mods.php?action=raw&id=xxx 直接下载 .js
 *   POST api/mods.php?action=upload     上传（JSON，需人机验证）
 *
 * 安全约定：
 *   - 上传内容只作为字符串存进 data/mods/*.json，绝不落成 .php/.js 可执行文件
 *   - data/mods 目录由 .htaccess 禁止直接访问
 *   - 所有文本字段做长度/UTF-8/控制字符校验，前端只用 canvas 绘制文本
 *   - 上传必须通过极验 4.0 二次校验；极验不可达时可用内置滑块验证兜底
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

$OPUS_CONFIG = @include dirname(__DIR__) . '/config.php';
if (!is_array($OPUS_CONFIG)) $OPUS_CONFIG = array();

function cfg($key, $def = null)
{
    global $OPUS_CONFIG;
    return isset($OPUS_CONFIG[$key]) ? $OPUS_CONFIG[$key] : $def;
}
function out_json($data, $code = 200)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail($msg, $code = 400, $extra = array())
{
    $d = array_merge(array('ok' => false, 'error' => $msg), $extra);
    out_json($d, $code);
}
function storage_dir()
{
    static $dir = null;
    if ($dir !== null) return $dir;
    $base = dirname(__DIR__) . '/data';
    $d = $base . '/mods';
    if (!is_dir($d)) @mkdir($d, 0777, true);
    if (!is_dir($d) || !is_writable($d)) fail('服务器 data/mods 目录不可写，请把 data 目录权限设为 755/777', 500);
    $dir = $d;
    return $dir;
}
function index_path() { return storage_dir() . '/index.json'; }
function mod_path($id) { return storage_dir() . '/m-' . $id . '.json'; }
function rate_dir()
{
    $d = storage_dir() . '/.rate';
    if (!is_dir($d)) @mkdir($d, 0777, true);
    return $d;
}
function now_ms() { return (int)round(microtime(true) * 1000); }

function read_index()
{
    $raw = @file_get_contents(index_path());
    if ($raw === false || $raw === '') return array();
    $d = json_decode($raw, true);
    return is_array($d) ? $d : array();
}
function write_index($idx)
{
    $p = index_path();
    $tmp = $p . '.tmp.' . getmypid();
    $json = json_encode(array_values($idx), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) return false;
    @chmod($tmp, 0644);
    if (!@rename($tmp, $p)) { @unlink($tmp); return false; }
    return true;
}
/** 在独占锁内读改写索引；$fn 接收索引副本，返回 array($newIndex, $result) */
function with_index($write, $fn)
{
    $lp = storage_dir() . '/.index.lock';
    $fp = @fopen($lp, 'c+');
    if (!$fp) fail('服务器无法创建索引锁', 500);
    if (!flock($fp, LOCK_EX)) { fclose($fp); fail('服务器繁忙，请重试', 503); }
    $idx = read_index();
    $res = $fn($idx);
    if (!is_array($res) || count($res) < 2) $res = array($idx, null);
    if ($write) {
        if (!write_index($res[0])) { flock($fp, LOCK_UN); fclose($fp); fail('写入模组索引失败，请检查 data 目录权限', 500); }
    }
    flock($fp, LOCK_UN); fclose($fp);
    return $res[1];
}

function client_ip()
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
    return substr($ip, 0, 64);
}
function rate_limit($bucket, $max, $window)
{
    $key = sha1($bucket . '|' . client_ip());
    $file = rate_dir() . '/' . $key . '.json';
    $fp = @fopen($file, 'c+');
    if (!$fp) return;
    if (!flock($fp, LOCK_EX)) { fclose($fp); return; }
    $raw = stream_get_contents($fp);
    $arr = $raw ? json_decode($raw, true) : array();
    if (!is_array($arr)) $arr = array();
    $now = time();
    $keep = array();
    foreach ($arr as $t) if (is_numeric($t) && $t > $now - $window) $keep[] = (int)$t;
    if (count($keep) >= $max) {
        flock($fp, LOCK_UN); fclose($fp);
        fail('操作太频繁，请稍后再试', 429);
    }
    $keep[] = $now;
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($keep)); fflush($fp);
    flock($fp, LOCK_UN); fclose($fp);
    if (mt_rand(1, 200) === 1) {
        foreach ((array)glob(rate_dir() . '/*.json') as $f) {
            if (is_file($f) && filemtime($f) < $now - 7200) @unlink($f);
        }
    }
}

function body_json($maxBytes)
{
    $len = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
    if ($len > $maxBytes + 131072) fail('请求体过大', 413);
    $raw = file_get_contents('php://input');
    if ($raw === false) fail('无法读取请求体');
    if (strlen($raw) > $maxBytes + 131072) fail('请求体过大', 413);
    $d = json_decode($raw, true);
    if (!is_array($d)) fail('请求格式必须是 JSON');
    return $d;
}

function clean_text($v, $label, $min, $max, $multiline = false)
{
    if (!is_string($v)) fail('缺少' . $label);
    if (!preg_match('//u', $v)) fail($label . ' 不是合法的 UTF-8');
    $v = str_replace(array("\r\n", "\r"), "\n", $v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v);
    $v = trim($v);
    $len = function_exists('mb_strlen') ? mb_strlen($v, 'UTF-8') : strlen($v);
    if ($len < $min || $len > $max) fail($label . '长度需为 ' . $min . '~' . $max . ' 个字符');
    if (!$multiline) $v = preg_replace('/\s+/u', ' ', $v);
    return $v;
}
function valid_id($id)
{
    return is_string($id) && preg_match('/^[a-z0-9][a-z0-9-]{2,63}$/', $id);
}
function slug($s)
{
    $s = strtolower($s);
    if (function_exists('iconv')) { $t = @iconv('UTF-8', 'ASCII//TRANSLIT', $s); if ($t !== false) $s = $t; }
    $s = preg_replace('/[^a-z0-9]+/', '-', $s);
    $s = trim($s, '-');
    if ($s === '') $s = 'mod';
    return substr($s, 0, 40);
}
function random_hex($n)
{
    if (function_exists('random_bytes')) return substr(bin2hex(random_bytes($n)), 0, $n * 2);
    if (function_exists('openssl_random_pseudo_bytes')) return substr(bin2hex(openssl_random_pseudo_bytes($n)), 0, $n * 2);
    $s = '';
    for ($i = 0; $i < $n * 2; $i++) $s .= dechex(mt_rand(0, 15));
    return $s;
}
function b64url($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function unb64url($s)
{
    $s = strtr($s, '-_', '+/');
    $pad = strlen($s) % 4;
    if ($pad) $s .= str_repeat('=', 4 - $pad);
    return base64_decode($s, true);
}
function local_secret()
{
    $k = (string)cfg('geetest_key', '');
    if ($k === '') $k = 'opusmc-local-captcha';
    return hash('sha256', $k . '|' . (isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '') . '|local-v1');
}
function local_sign($payload) { return hash_hmac('sha256', $payload, local_secret()); }

function issue_local_captcha()
{
    $target = mt_rand(12, 88);
    $payload = json_encode(array(
        'n' => random_hex(12),
        't' => time(),
        'target' => $target,
        'ip' => substr(sha1(client_ip() . '|' . local_secret()), 0, 16),
    ));
    $body = b64url($payload);
    $token = $body . '.' . local_sign($body);
    return array(
        'ok' => true,
        'token' => $token,
        'target' => $target,
        'tolerance' => 5,
        'prompt' => '把滑块拖到 ' . $target . ' 附近（±5）',
        'expires' => 300,
    );
}
function verify_local_captcha($token, $value)
{
    if (!cfg('allow_local_fallback', true)) fail('当前站点只接受极验验证', 403);
    if (!is_string($token) || strpos($token, '.') === false) fail('验证令牌无效');
    $parts = explode('.', $token);
    $body = $parts[0];
    $sig = isset($parts[1]) ? $parts[1] : '';
    if (!hash_equals_compat(local_sign($body), $sig)) fail('验证令牌签名无效');
    $p = json_decode(unb64url($body), true);
    if (!is_array($p)) fail('验证令牌内容无效');
    if (!isset($p['t'], $p['target'], $p['n'], $p['ip'])) fail('验证令牌字段缺失');
    if (time() - (int)$p['t'] > 300) fail('验证已过期，请重新验证');
    if (time() - (int)$p['t'] < 1) fail('验证太快了，请重新拖动滑块');
    if (substr(sha1(client_ip() . '|' . local_secret()), 0, 16) !== $p['ip']) fail('验证与当前网络不一致');
    if (!is_numeric($value)) fail('缺少滑块位置');
    $v = (float)$value;
    if (abs($v - (float)$p['target']) > 5.5) fail('滑块位置不正确，请重试');
    // 一次性令牌：记录 nonce，防止重放
    $used = storage_dir() . '/.used-captcha.json';
    $fp = @fopen($used, 'c+');
    if (!$fp) fail('服务器无法记录验证状态', 500);
    if (!flock($fp, LOCK_EX)) { fclose($fp); fail('服务器忙，请重试', 503); }
    $raw = stream_get_contents($fp);
    $arr = $raw ? json_decode($raw, true) : array();
    if (!is_array($arr)) $arr = array();
    $now = time();
    foreach ($arr as $k => $t) if (!is_numeric($t) || $t < $now - 900) unset($arr[$k]);
    if (isset($arr[$p['n']])) { flock($fp, LOCK_UN); fclose($fp); fail('验证令牌已使用，请重新验证'); }
    $arr[$p['n']] = $now;
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($arr)); fflush($fp);
    flock($fp, LOCK_UN); fclose($fp);
    return true;
}
function hash_equals_compat($a, $b)
{
    if (function_exists('hash_equals')) return hash_equals($a, $b);
    if (strlen($a) !== strlen($b)) return false;
    $r = 0;
    for ($i = 0; $i < strlen($a); $i++) $r |= ord($a[$i]) ^ ord($b[$i]);
    return $r === 0;
}

function http_post_form($url, $fields, $timeout)
{
    $body = http_build_query($fields, '', '&');
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(4, $timeout));
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/x-www-form-urlencoded'));
        $res = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        return array($code, $res === false ? '' : $res, $err);
    }
    if (!ini_get('allow_url_fopen')) return array(0, '', 'allow_url_fopen disabled');
    $ctx = stream_context_create(array('http' => array(
        'method' => 'POST',
        'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => $body,
        'timeout' => $timeout,
        'ignore_errors' => true,
    )));
    $res = @file_get_contents($url, false, $ctx);
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $code = (int)$m[1];
    return array($code, $res === false ? '' : $res, $res === false ? 'request failed' : '');
}

function geetest_verify($lot, $output, $pass, $gen)
{
    $id = (string)cfg('geetest_id', '');
    $key = (string)cfg('geetest_key', '');
    if (!cfg('geetest_enabled', true) || $id === '' || $key === '') {
        return array('ok' => false, 'offline' => true, 'error' => '极验未配置');
    }
    $lot = substr((string)$lot, 0, 128);
    $output = substr((string)$output, 0, 4096);
    $pass = substr((string)$pass, 0, 4096);
    $gen = substr((string)$gen, 0, 64);
    if ($lot === '' || $output === '' || $pass === '' || $gen === '') {
        return array('ok' => false, 'error' => '极验参数不完整');
    }
    $sign = hash_hmac('sha256', $lot, $key);
    $url = rtrim((string)cfg('geetest_api', 'https://gcaptcha4.geetest.com'), '/') . '/validate?captcha_id=' . urlencode($id);
    $fields = array(
        'lot_number' => $lot,
        'captcha_output' => $output,
        'pass_token' => $pass,
        'gen_time' => $gen,
        'sign_token' => $sign,
    );
    list($code, $res, $err) = http_post_form($url, $fields, (int)cfg('geetest_timeout', 6));
    if ($code !== 200 || $res === '') {
        return array('ok' => false, 'offline' => true, 'error' => '极验服务暂时不可用' . ($err ? '（' . $err . '）' : ''));
    }
    $j = json_decode($res, true);
    if (!is_array($j)) return array('ok' => false, 'offline' => true, 'error' => '极验返回格式异常');
    if (isset($j['result']) && $j['result'] === 'success') return array('ok' => true);
    $reason = isset($j['reason']) ? (string)$j['reason'] : '验证未通过';
    return array('ok' => false, 'error' => '极验校验失败：' . $reason);
}

function check_captcha($captcha)
{
    if (!is_array($captcha)) fail('请完成人机验证', 403);
    $type = isset($captcha['type']) ? $captcha['type'] : '';
    if ($type === 'geetest') {
        $r = geetest_verify(
            isset($captcha['lot_number']) ? $captcha['lot_number'] : '',
            isset($captcha['captcha_output']) ? $captcha['captcha_output'] : '',
            isset($captcha['pass_token']) ? $captcha['pass_token'] : '',
            isset($captcha['gen_time']) ? $captcha['gen_time'] : ''
        );
        if ($r['ok']) return;
        if (!empty($r['offline']) && cfg('allow_local_fallback', true)) {
            fail('极验服务暂时不可用，请改用内置滑块验证', 503, array('offline' => true));
        }
        fail($r['error'], 403);
    }
    if ($type === 'local') {
        verify_local_captcha(isset($captcha['token']) ? $captcha['token'] : '', isset($captcha['value']) ? $captcha['value'] : null);
        return;
    }
    fail('请完成人机验证', 403);
}

function reserved_mod_name($s)
{
    $s = strtolower(trim((string)$s));
    $reserved = array('admin', 'administrator', 'developer', 'dev', 'system', 'sys', 'root', 'owner', 'staff', 'moderator', 'mod', 'operator', 'op', 'server', 'official', 'mojang', 'microsoft', '管理员', '开发者', '系统', '服主', '腐竹', '官方', '客服', '管理', '超级管理员');
    return in_array($s, $reserved, true);
}
function valid_category($c)
{
    return in_array($c, array('adventure', 'building', 'technology', 'magic', 'tools', 'survival', 'worldgen', 'decoration', 'optimization', 'other'), true) ? $c : 'other';
}

function public_meta($m)
{
    $d = array(
        'id' => '', 'name' => '', 'author' => '', 'version' => '', 'summary' => '',
        'description' => '', 'side' => 'both', 'tags' => array(), 'size' => 0,
        'downloads' => 0, 'createdAt' => 0, 'updatedAt' => 0, 'installable' => true,
        'icon' => '', 'homepage' => '', 'license' => '', 'mcVersion' => '', 'sha256' => '', 'category' => 'other',
    );
    $m = array_merge($d, is_array($m) ? $m : array());
    return array(
        'id' => $m['id'], 'name' => $m['name'], 'author' => $m['author'],
        'version' => $m['version'], 'summary' => $m['summary'],
        'description' => $m['description'], 'side' => $m['side'], 'tags' => $m['tags'],
        'size' => $m['size'], 'downloads' => $m['downloads'], 'createdAt' => $m['createdAt'],
        'updatedAt' => $m['updatedAt'], 'installable' => $m['installable'],
        'icon' => $m['icon'], 'homepage' => $m['homepage'], 'license' => $m['license'],
        'mcVersion' => $m['mcVersion'], 'sha256' => $m['sha256'], 'category' => $m['category'],
    );
}
function validate_icon($icon)
{
    if ($icon === null || $icon === '') return '';
    if (!is_string($icon) || strlen($icon) > (int)cfg('max_icon_bytes', 65536)) fail('图标过大或格式错误（最大 64KB）');
    if (!preg_match('#^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$#', $icon, $m)) fail('图标必须是 png/jpeg/webp 的 dataURL');
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > (int)cfg('max_icon_bytes', 65536)) fail('图标内容无效');
    if (function_exists('getimagesizefromstring')) {
        $info = @getimagesizefromstring($bin);
        if (!$info || $info[0] < 8 || $info[1] < 8 || $info[0] > 256 || $info[1] > 256) fail('图标尺寸需在 8×8 ~ 256×256 之间');
    }
    return $icon;
}

function find_index($idx, $id)
{
    foreach ($idx as $i => $m) if (isset($m['id']) && $m['id'] === $id) return $i;
    return -1;
}

/* ------------------------------------------------------------------------- */
$action = isset($_GET['action']) ? (string)$_GET['action'] : '';

// 跨站请求防护（只检查浏览器带 Origin 的请求）
if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== '') {
    $oh = parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
    $hh = isset($_SERVER['HTTP_HOST']) ? preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST']) : '';
    if ($oh && $hh && strcasecmp($oh, $hh) !== 0) fail('跨站请求被拒绝', 403);
}

switch ($action) {
    case 'config':
        out_json(array(
            'ok' => true,
            'siteName' => (string)cfg('site_name', 'OpusMC 模组库'),
            'geetestEnabled' => (bool)cfg('geetest_enabled', true),
            'geetestId' => (string)cfg('geetest_id', ''),
            'localFallback' => (bool)cfg('allow_local_fallback', true),
            'maxUploadBytes' => (int)cfg('max_upload_bytes', 262144),
            'maxCodeBytes' => (int)cfg('max_code_bytes', 262144),
            'gameVersion' => '26.2',
        ));
        break;

    case 'captcha':
        rate_limit('captcha', 40, 60);
        out_json(issue_local_captcha());
        break;

    case 'health':
        $idx = read_index();
        out_json(array('ok' => true, 'count' => count($idx), 'writable' => is_writable(storage_dir()), 'geetest' => (bool)cfg('geetest_enabled', true), 'localFallback' => (bool)cfg('allow_local_fallback', true)));
        break;

    case 'list': {
        rate_limit('list', (int)cfg('list_per_minute', 180), 60);
        $q = isset($_GET['q']) ? clean_text((string)$_GET['q'], '搜索词', 0, 64) : '';
        $sort = isset($_GET['sort']) ? (string)$_GET['sort'] : 'new';
        $category = isset($_GET['category']) ? (string)$_GET['category'] : '';
        $page = max(1, min(10000, isset($_GET['page']) ? (int)$_GET['page'] : 1));
        $limit = max(1, min(50, isset($_GET['limit']) ? (int)$_GET['limit'] : 20));
        $idx = read_index();
        $out = array();
        foreach ($idx as $m) {
            if (!is_array($m) || !isset($m['id'])) continue;
            if ($category !== '' && $category !== 'all' && (!isset($m['category']) || $m['category'] !== $category)) continue;
            if ($q !== '') {
                $hay = strtolower($m['name'] . ' ' . $m['author'] . ' ' . $m['summary'] . ' ' . implode(' ', (array)$m['tags']));
                if (strpos($hay, strtolower($q)) === false) continue;
            }
            $out[] = $m;
        }
        if ($sort === 'downloads') usort($out, function ($a, $b) { return $b['downloads'] - $a['downloads']; });
        elseif ($sort === 'name') usort($out, function ($a, $b) { return strcmp($a['name'], $b['name']); });
        else usort($out, function ($a, $b) { return $b['createdAt'] - $a['createdAt']; });
        $total = count($out);
        $slice = array_slice($out, ($page - 1) * $limit, $limit);
        $mods = array();
        foreach ($slice as $m) $mods[] = public_meta($m);
        out_json(array('ok' => true, 'total' => $total, 'page' => $page, 'limit' => $limit, 'pages' => max(1, (int)ceil($total / $limit)), 'mods' => $mods));
        break;
    }

    case 'get':
    case 'download': {
        rate_limit('get', (int)cfg('get_per_minute', 120), 60);
        $id = isset($_GET['id']) ? (string)$_GET['id'] : '';
        if (!valid_id($id)) fail('模组 ID 不合法');
        $meta = with_index(true, function ($idx) use ($id) {
            $i = find_index($idx, $id);
            if ($i < 0) return array($idx, null);
            $idx[$i]['downloads'] = (int)$idx[$i]['downloads'] + 1;
            return array($idx, $idx[$i]);
        });
        if (!$meta) fail('模组不存在', 404);
        $raw = @file_get_contents(mod_path($id));
        if ($raw === false) fail('模组文件丢失', 404);
        $j = json_decode($raw, true);
        if (!is_array($j) || !isset($j['code'])) fail('模组文件损坏', 500);
        out_json(array('ok' => true, 'mod' => public_meta($meta), 'code' => (string)$j['code']));
        break;
    }

    case 'raw': {
        rate_limit('get', (int)cfg('get_per_minute', 120), 60);
        $id = isset($_GET['id']) ? (string)$_GET['id'] : '';
        if (!valid_id($id)) fail('模组 ID 不合法');
        $meta = with_index(true, function ($idx) use ($id) {
            $i = find_index($idx, $id);
            if ($i < 0) return array($idx, null);
            $idx[$i]['downloads'] = (int)$idx[$i]['downloads'] + 1;
            return array($idx, $idx[$i]);
        });
        if (!$meta) fail('模组不存在', 404);
        $raw = @file_get_contents(mod_path($id));
        if ($raw === false) fail('模组文件丢失', 404);
        $j = json_decode($raw, true);
        if (!is_array($j) || !isset($j['code'])) fail('模组文件损坏', 500);
        header('Content-Type: text/javascript; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $id . '.js"');
        header('Cache-Control: public, max-age=300');
        echo $j['code'];
        exit;
    }

    case 'upload': {
        if (!isset($_SERVER['REQUEST_METHOD']) || strtoupper($_SERVER['REQUEST_METHOD']) !== 'POST') fail('请使用 POST 上传', 405);
        rate_limit('upload', (int)cfg('upload_per_hour', 6), 3600);
        $in = body_json((int)cfg('max_upload_bytes', 262144) + 65536);
        check_captcha(isset($in['captcha']) ? $in['captcha'] : null);

        $name = clean_text(isset($in['name']) ? $in['name'] : '', '模组名称', 1, 40);
        $author = clean_text(isset($in['author']) ? $in['author'] : '', '作者', 1, 32);
        $version = clean_text(isset($in['version']) ? $in['version'] : '1.0.0', '版本号', 1, 20);
        if (reserved_mod_name($name)) fail('“' . $name . '”是系统保留名，不能用作模组名');
        if (reserved_mod_name($author)) fail('“' . $author . '”是系统保留名，不能用作作者名');
        $summary = clean_text(isset($in['summary']) ? $in['summary'] : '', '简介', 1, 200);
        $category = valid_category(isset($in['category']) ? (string)$in['category'] : 'other');
        $description = isset($in['description']) ? clean_text($in['description'], '详细说明', 0, 4000, true) : '';
        $side = isset($in['side']) ? (string)$in['side'] : 'both';
        if (!in_array($side, array('client', 'server', 'both'), true)) $side = 'both';
        $installable = isset($in['installable']) ? (bool)$in['installable'] : true;
        $homepage = isset($in['homepage']) ? trim((string)$in['homepage']) : '';
        if ($homepage !== '') {
            if (!preg_match('#^https?://[^\s]{4,200}$#i', $homepage)) fail('主页地址必须是 http(s) URL');
            $homepage = substr($homepage, 0, 200);
        }
        $license = isset($in['license']) ? clean_text((string)$in['license'], '许可证', 0, 32) : '';
        $mcVersion = isset($in['mcVersion']) ? clean_text((string)$in['mcVersion'], '游戏版本', 0, 16) : '26.2';
        $tags = array();
        if (isset($in['tags']) && is_array($in['tags'])) {
            foreach (array_slice($in['tags'], 0, 8) as $t) {
                if (!is_string($t)) continue;
                $t = clean_text($t, '标签', 1, 16);
                if (!in_array($t, $tags, true)) $tags[] = $t;
            }
        }
        $icon = validate_icon(isset($in['icon']) ? $in['icon'] : '');

        $code = isset($in['code']) ? $in['code'] : null;
        if (!is_string($code) || trim($code) === '') fail('缺少模组代码');
        $codeLen = strlen($code);
        if ($codeLen > (int)cfg('max_code_bytes', 262144)) fail('模组代码过大（最大 256KB）');
        if (strpos($code, "\0") !== false) fail('模组代码包含非法字符');
        if (preg_match('/<\?(php|=)/i', $code)) fail('模组代码不能包含 PHP 标签');
        if (!preg_match('//u', $code)) fail('模组代码必须是 UTF-8');
        $sha = hash('sha256', $code);

        $result = with_index(true, function ($idx) use ($name, $author, $version, $summary, $description, $side, $tags, $installable, $icon, $homepage, $license, $mcVersion, $code, $sha, $codeLen, $category) {
            if (count($idx) >= (int)cfg('max_mods', 500)) fail('模组库已满，请联系管理员', 503);
            $total = 0;
            foreach ($idx as $m) {
                if (isset($m['sha256']) && $m['sha256'] === $sha) {
                    fail('这个模组已经有人上传过了', 409, array('duplicate' => true, 'id' => $m['id']));
                }
                $total += isset($m['size']) ? (int)$m['size'] : 0;
            }
            if ($total + $codeLen > (int)cfg('max_total_bytes', 33554432)) fail('模组库空间已满', 503);

            $id = slug($name) . '-' . random_hex(4);
            $tries = 0;
            while (find_index($idx, $id) >= 0 && $tries++ < 20) $id = slug($name) . '-' . random_hex(4);
            $now = time();
            $meta = array(
                'id' => $id, 'name' => $name, 'author' => $author, 'version' => $version,
                'summary' => $summary, 'description' => $description, 'side' => $side,
                'tags' => $tags, 'size' => $codeLen, 'sha256' => $sha, 'downloads' => 0,
                'createdAt' => $now, 'updatedAt' => $now, 'installable' => $installable,
                'icon' => $icon, 'homepage' => $homepage, 'license' => $license,
                'mcVersion' => $mcVersion, 'source' => 'public', 'category' => $category,
            );
            $file = mod_path($id);
            $tmp = $file . '.tmp.' . getmypid();
            $payload = json_encode(array('code' => $code), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (@file_put_contents($tmp, $payload, LOCK_EX) === false) fail('服务器无法写入模组文件', 500);
            @chmod($tmp, 0644);
            if (!@rename($tmp, $file)) { @unlink($tmp); fail('服务器无法保存模组文件', 500); }
            $idx[] = $meta;
            return array($idx, $meta);
        });
        out_json(array('ok' => true, 'mod' => public_meta($result)));
        break;
    }

    case 'delete': {
        if (!isset($_SERVER['REQUEST_METHOD']) || strtoupper($_SERVER['REQUEST_METHOD']) !== 'POST') fail('请使用 POST', 405);
        $admin = (string)cfg('admin_key', '');
        if ($admin === '') fail('未配置管理员密钥，删除功能已禁用', 403);
        $in = body_json(65536);
        $key = isset($in['key']) ? (string)$in['key'] : '';
        if (!hash_equals_compat($admin, $key)) fail('管理员密钥错误', 403);
        $id = isset($in['id']) ? (string)$in['id'] : '';
        if (!valid_id($id)) fail('模组 ID 不合法');
        $removed = with_index(true, function ($idx) use ($id) {
            $i = find_index($idx, $id);
            if ($i < 0) return array($idx, false);
            array_splice($idx, $i, 1);
            return array($idx, true);
        });
        if (!$removed) fail('模组不存在', 404);
        @unlink(mod_path($id));
        out_json(array('ok' => true));
        break;
    }

    default:
        fail('未知操作', 404);
}
