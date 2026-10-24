<?php
// 信令接口的根目录别名：部分主机会拦截 /api/ 目录，net.js 会自动回退到这里
require __DIR__ . '/api/signal.php';
