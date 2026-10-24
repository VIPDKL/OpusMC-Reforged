<?php
/**
 * OpusMC 联机信令服务 v2（PHP，纯文件存储，无需数据库）
 * ------------------------------------------------------------------
 * 只交换 WebRTC offer/answer；游戏数据走浏览器之间的 P2P 通道（房主星型中继）。
 * 支持 2~20 人、玩家名字查重、房主/游客身份、房间 12 小时自动过期。
 * 数据目录优先用 data/rooms，不可写时自动回退到系统临时目录。
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

define('DATA_DIR', dirname(__DIR__) . '/data');
define('ROOM_TTL', 12 * 3600);
define('MAX_ROOMS', 300);

function out_json($data, $code = 200)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail($msg, $code = 400) { out_json(array('ok' => false, 'error' => $msg), $code); }

function random_token()
{
    if (function_exists('random_bytes')) return bin2hex(random_bytes(16));
    if (function_exists('openssl_random_pseudo_bytes')) return bin2hex(openssl_random_pseudo_bytes(16));
    $s = '';
    for ($i = 0; $i < 32; $i++) $s .= dechex(mt_rand(0, 15));
    return $s;
}
function new_code()
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $s = '';
    for ($i = 0; $i < 6; $i++) $s .= $alphabet[mt_rand(0, strlen($alphabet) - 1)];
    return $s;
}
function body()
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 300000) fail('请求过大', 413);
    $d = json_decode($raw, true);
    return is_array($d) ? $d : array();
}
function storage_dir()
{
    static $dir = null;
    if ($dir !== null) return $dir;
    $candidates = array(DATA_DIR . '/rooms', rtrim(sys_get_temp_dir(), '/\\') . '/opusmc-rooms');
    foreach ($candidates as $d) {
        if (!is_dir($d)) @mkdir($d, 0777, true);
        if (is_dir($d) && is_writable($d)) { $dir = $d; return $dir; }
    }
    fail('服务器没有可写目录：请把 data/ 权限设为 755/777', 500);
}
function cleanup_rooms($dir)
{
    if (mt_rand(1, 10) !== 1) return;
    $now = time();
    foreach ((array)glob($dir . '/*.json') as $f) {
        if (is_file($f) && $now - filemtime($f) > ROOM_TTL) @unlink($f);
    }
}
/** 房间文件加排它锁读改写 */
function with_room($code, $create, $fn)
{
    $dir = storage_dir();
    cleanup_rooms($dir);
    $path = $dir . '/' . $code . '.json';
    $fp = @fopen($path, 'c+');
    if (!$fp) fail('服务器无法打开房间文件', 500);
    if (!flock($fp, LOCK_EX)) { fclose($fp); fail('服务器忙，请重试', 503); }
    $raw = stream_get_contents($fp);
    $room = $raw ? json_decode($raw, true) : null;
    if (!is_array($room)) {
        if (!$create) { flock($fp, LOCK_UN); fclose($fp); fail('房间不存在或已过期', 404); }
        $room = array('code' => $code, 'created' => time(), 'host' => null, 'hostName' => '',
            'max' => 8, 'guests' => array(), 'status' => 'waiting');
    }
    $room['updated'] = time();
    $result = $fn($room);
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($room)); fflush($fp);
    flock($fp, LOCK_UN); fclose($fp);
    return $result;
}
function check_code($code)
{
    if (!is_string($code) || !preg_match('/^[A-Z0-9]{6}$/', $code)) fail('房间码格式不正确（6 位字母数字）');
    return $code;
}
function clean_name($name, $label)
{
    if (!is_string($name)) fail('缺少' . $label);
    $name = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $name));
    $len = function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name);
    if ($name === '' || $len > 16) fail($label . '需为 1~16 个字符');
    return $name;
}
function name_taken($room, $name)
{
    if ($room['hostName'] === $name) return true;
    foreach ((array)$room['guests'] as $g) if (isset($g['name']) && $g['name'] === $name) return true;
    return false;
}
function guest_by_token($room, $token)
{
    foreach ((array)$room['guests'] as $slot => $g) if ($g['token'] === $token) return array($slot, $g);
    return null;
}
function players_list($room)
{
    $list = array(array('slot' => 0, 'name' => $room['hostName'], 'host' => true, 'ping' => 0));
    foreach ((array)$room['guests'] as $slot => $g) {
        if (!empty($g['joined'])) $list[] = array('slot' => (int)$slot, 'name' => $g['name'], 'host' => false, 'ping' => isset($g['ping']) ? (int)$g['ping'] : 0);
    }
    return $list;
}
function find_free_slot($room)
{
    for ($i = 1; $i < (int)$room['max']; $i++) if (!isset($room['guests'][$i])) return $i;
    return -1;
}

$action = isset($_GET['action']) ? $_GET['action'] : '';
$in = body();

switch ($action) {
    case 'create': {
        $dir = storage_dir();
        $n = count((array)glob($dir . '/*.json'));
        if ($n >= MAX_ROOMS) fail('服务器联机房间已满，请稍后再试', 503);
        $name = clean_name(isset($in['name']) ? $in['name'] : '', '玩家名');
        $max = isset($in['max']) ? (int)$in['max'] : 8;
        if ($max < 2) $max = 2; if ($max > 20) $max = 20;
        $code = new_code();
        for ($i = 0; $i < 12 && is_file($dir . '/' . $code . '.json'); $i++) $code = new_code();
        $token = random_token();
        with_room($code, true, function (&$room) use ($token, $name, $max) {
            $room['host'] = $token; $room['hostName'] = $name; $room['max'] = $max;
            $room['status'] = 'waiting'; $room['guests'] = array();
            return true;
        });
        out_json(array('ok' => true, 'code' => $code, 'token' => $token, 'role' => 'host', 'max' => $max, 'players' => array(array('slot' => 0, 'name' => $name, 'host' => true, 'ping' => 0))));
        break;
    }
    case 'join': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $name = clean_name(isset($in['name']) ? $in['name'] : '', '玩家名');
        $token = random_token();
        $result = with_room($code, false, function (&$room) use ($token, $name) {
            if (name_taken($room, $name)) fail('已有当前玩家在里面（名字重复）', 409);
            if (count((array)$room['guests']) >= (int)$room['max'] - 1) fail('房间人数已满', 409);
            $slot = find_free_slot($room);
            if ($slot < 0) fail('房间人数已满', 409);
            $room['guests'][$slot] = array('name' => $name, 'token' => $token, 'offer' => null,
                'answer' => null, 'joined' => false, 'ping' => 0, 'at' => time());
            if ($room['status'] === 'waiting') $room['status'] = 'joined';
            return array('slot' => $slot, 'players' => players_list($room), 'hostName' => $room['hostName']);
        });
        out_json(array('ok' => true, 'token' => $token, 'role' => 'guest', 'slot' => $result['slot'],
            'players' => $result['players'], 'hostName' => $result['hostName'], 'max' => 8));
        break;
    }
    case 'offer': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $slot = isset($in['slot']) ? (int)$in['slot'] : 0;
        $offer = isset($in['offer']) ? $in['offer'] : null;
        if (!is_array($offer) || !isset($offer['type'], $offer['sdp'])) fail('offer 数据不完整');
        with_room($code, false, function (&$room) use ($token, $slot, $offer) {
            if ($room['host'] !== $token) fail('只有房主可以提交 offer', 403);
            if (!isset($room['guests'][$slot])) fail('该玩家槽位不存在', 404);
            $room['guests'][$slot]['offer'] = $offer;
            return true;
        });
        out_json(array('ok' => true));
        break;
    }
    case 'answer': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $slot = isset($in['slot']) ? (int)$in['slot'] : 0;
        $answer = isset($in['answer']) ? $in['answer'] : null;
        if (!is_array($answer) || !isset($answer['type'], $answer['sdp'])) fail('answer 数据不完整');
        with_room($code, false, function (&$room) use ($token, $slot, $answer) {
            if (!isset($room['guests'][$slot]) || $room['guests'][$slot]['token'] !== $token) fail('身份令牌无效', 403);
            $room['guests'][$slot]['answer'] = $answer;
            return true;
        });
        out_json(array('ok' => true));
        break;
    }
    case 'pollHost': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $result = with_room($code, false, function (&$room) use ($token) {
            if ($room['host'] !== $token) fail('身份令牌无效', 403);
            $guests = array();
            foreach ((array)$room['guests'] as $slot => $g) {
                $guests[] = array('slot' => (int)$slot, 'name' => $g['name'], 'offer' => $g['offer'],
                    'answer' => $g['answer'], 'joined' => !empty($g['joined']));
            }
            return array('ok' => true, 'max' => (int)$room['max'], 'hostName' => $room['hostName'],
                'status' => $room['status'], 'players' => players_list($room), 'guests' => $guests);
        });
        out_json($result);
        break;
    }
    case 'pollGuest': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $result = with_room($code, false, function (&$room) use ($token) {
            $found = guest_by_token($room, $token);
            if (!$found) fail('你已被移出房间（房间可能已关闭）', 410);
            list($slot, $g) = $found;
            return array('ok' => true, 'slot' => (int)$slot, 'hostName' => $room['hostName'],
                'max' => (int)$room['max'], 'status' => $room['status'],
                'players' => players_list($room), 'offer' => $g['offer'], 'answer' => $g['answer']);
        });
        out_json($result);
        break;
    }
    case 'joined': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $slot = isset($in['slot']) ? (int)$in['slot'] : 0;
        with_room($code, false, function (&$room) use ($token, $slot) {
            if (!isset($room['guests'][$slot]) || $room['guests'][$slot]['token'] !== $token) fail('身份令牌无效', 403);
            $room['guests'][$slot]['joined'] = true;
            $room['status'] = 'ready';
            return true;
        });
        out_json(array('ok' => true));
        break;
    }
    case 'pingSlot': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $slot = isset($in['slot']) ? (int)$in['slot'] : 0;
        $ping = isset($in['ping']) ? max(0, min(9999, (int)$in['ping'])) : 0;
        with_room($code, false, function (&$room) use ($token, $slot, $ping) {
            if ($room['host'] !== $token) fail('身份令牌无效', 403);
            if (isset($room['guests'][$slot])) $room['guests'][$slot]['ping'] = $ping;
            return true;
        });
        out_json(array('ok' => true));
        break;
    }
    case 'leave': {
        $code = check_code(isset($in['code']) ? $in['code'] : '');
        $token = isset($in['token']) ? $in['token'] : '';
        $dir = storage_dir();
        $path = $dir . '/' . $code . '.json';
        if (is_file($path)) {
            $room = json_decode(file_get_contents($path), true);
            if (is_array($room) && $room['host'] === $token) {
                @unlink($path);
                out_json(array('ok' => true));
            }
            $found = is_array($room) ? guest_by_token($room, $token) : null;
            if ($found) {
                with_room($code, false, function (&$room) use ($found) {
                    unset($room['guests'][$found[0]]);
                    if (!count((array)$room['guests'])) $room['status'] = 'waiting';
                    return true;
                });
                out_json(array('ok' => true));
            }
        }
        out_json(array('ok' => true));
        break;
    }
    case 'ping':
        out_json(array('ok' => true, 'time' => time(), 'dir' => basename(storage_dir())));
        break;
    default:
        fail('未知操作', 404);
}
