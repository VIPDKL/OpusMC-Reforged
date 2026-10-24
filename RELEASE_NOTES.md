# OpusMC Reforged v4.1.0

## 这个版本是什么

PHP + WebGL2 的浏览器 Minecraft 复刻，包含：

- 单人/联机（WebRTC）
- Mod API 4.0
- 公开模组库 + 极验行为验证 4.0
- 从 BingoBST/Webgame 合并的资源、方块、结构、附魔与樱花内容

## 下载

- `MC-fixed-v4.zip`：完整部署包（不含真实极验 key）
- GitHub 自动生成的 `Source code (zip)`：仓库源码快照

部署包内 `config.local.php.example` 是配置模板；真实 key 请自行填写，不要提交到公开仓库。

## v4.1.0 更新

### 修复

- 修复 80 个扩展方块缺少贴图、显示成石头/空白的问题
- 修复 168 号灰色混凝土与深层红石矿 ID 冲突
- 修复苔石、裂纹石砖、海晶灯、骨块、干草块、煤炭块、陶瓦重复注册
- 修复 `help.php` 脚本加载顺序导致的白屏
- 方块 ID 扩展到 16 位，旧 v1 存档自动重映射
- 图标图集改为紧凑索引，模组加载后重建
- 修复模组禁用不持久化、强制重载重复注册、旧存档物品栏兼容

### 性能

- 地形列缓存
- 只重建受影响区块
- 天空矩阵缓存
- 图标图集紧凑索引
- 手机端默认降低渲染距离/分辨率/粒子/阴影
- 树叶腐烂 BFS 限深

### Mod API 4.0

- 方块/物品/实体/配方/标签/熔炼/战利品/世界生成
- 可取消事件、命令、按键、网络通道
- 世界存档数据、本地存储、配置、HUD
- 自定义贴图/图标
- 官方示例 `mods/sample-content.js`、`mods/sample-mob.js`

### 公开模组库

- 搜索、排序、分页、详情、安装
- 上传：名称、作者、版本、简介、说明、标签、类型、可安装、图标、代码
- 极验行为验证 4.0（HMAC-SHA256 二次校验）
- 极验不可达时回退内置滑块
- 文件存储、索引锁、限流、字段/大小/UTF-8/图标校验、重复代码拒绝
- `admin_key` 管理员删除

### BingoBST/Webgame 合并

- 71 张方块/物品贴图、36 张 GUI/实体贴图
- 红石装饰、雕纹/切制砂岩、蓝陶瓦、蜘蛛网、铁轨、土径、刷怪笼、钟
- 附魔台、铁砧、漏斗、酿造台
- 樱花树苗/花瓣/门
- 沙漠神殿、废弃矿井
- `/locate village|desert_pyramid|mineshaft`
- 附魔台 6 种附魔（锋利/亡灵杀手/效率/时运/保护/耐久）

### v4.1.0 追加

- 模组分类（冒险/建筑/科技/魔法/工具/生存/世界生成/装饰/优化/其他）
- 模组名/作者名系统保留名校验（admin/developer/system/管理员等，客户端+服务端）
- 更多 Mod API：`api.settings`、性能预设 `api.client.optimize`、更多事件/钩子、
  批量 `world.fill`/`setBlockBatch`、玩家物品栏操作、自定义方块模型
- 模组自定义指令不再强制要求世界开启作弊
- 联机页面重做：房间号输入、复制房间码、默认地址、分阶段进度条
- 游客空物品栏（不再自动发放创造初始物品）
- F3+Esc 暂停、F3+F4 切换模式、F3+T 重载数据包；F3 关闭后区块边界仍保留
- 存档导出/导入（`.opusmc.json`），兼容 v1/v2 存档与模组世界

未合并：完整红石网络、村民交易、完整酿造、Web Worker、19 种附魔与铁砧惩罚。
详见 `docs/MERGE-NOTES.md`。

## 部署

1. 上传解压到 PHP 站点，例如 `/MC2/`
2. `chmod 755 data data/mods`
3. `cp config.local.php.example config.local.php`
4. 在 `config.local.php` 填 `geetest_key`（可选）
5. 访问 `_check.php` 自检
6. 访问 `index.php`

极验需要域名白名单，并允许服务器访问 `https://gcaptcha4.geetest.com`。

## 安全

- 公开仓库和公开 zip 不含真实极验 key
- 模组会执行 JavaScript，只安装信任的模组
- 素材版权归 Mojang/Microsoft 与原素材作者，仅用于学习/演示

## 许可

源代码 MIT；素材不适用 MIT。合并自 BingoBST/Webgame 的内容遵循其 MIT 许可。
