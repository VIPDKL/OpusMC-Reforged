<?php
/**
 * OpusMC 服务端配置（公开默认值）
 *
 * 私密配置请放在 config.local.php（已被 .gitignore 忽略，不要提交到 GitHub）：
 *
 *   <?php
 *   return array(
 *       'geetest_key' => '你的极验验证 key',
 *       'admin_key'   => '你的模组库管理员密钥',
 *   );
 *
 * config.php 会把 config.local.php 合并进来；不创建该文件也能运行，
 * 但极验上传会回退到内置滑块验证。
 */
$opus_defaults = array(
    // 极验行为验证 4.0（captcha_id 可以公开，key 只放在 config.local.php）
    'geetest_enabled'   => true,
    'geetest_id'        => '3db03e7648f506644305d25391012c29',
    'geetest_key'       => '',
    'geetest_api'       => 'https://gcaptcha4.geetest.com',
    'geetest_timeout'   => 6,

    // 极验不可达/未配置时，是否允许使用内置滑块验证
    'allow_local_fallback' => true,

    // 公开模组库限制
    'max_upload_bytes'  => 262144,
    'max_code_bytes'    => 262144,
    'max_icon_bytes'    => 65536,
    'max_mods'          => 500,
    'max_total_bytes'   => 33554432,
    'upload_per_hour'   => 6,
    'get_per_minute'    => 120,
    'list_per_minute'   => 180,

    // 管理员密钥：填写后可用 POST action=delete 删除违规模组；留空则禁用删除
    'admin_key'         => '',

    // 站点信息
    'site_name'         => 'OpusMC 模组库',
    'site_url'          => '',
);

$opus_local = __DIR__ . '/config.local.php';
if (is_file($opus_local)) {
    $opus_override = @include $opus_local;
    if (is_array($opus_override)) $opus_defaults = array_merge($opus_defaults, $opus_override);
}
return $opus_defaults;
