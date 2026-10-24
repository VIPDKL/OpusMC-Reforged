# OpusMC · 浏览器 Minecraft 复刻（PHP 联机 + 模组公开库）

纯浏览器端 Minecraft 复刻：WebGL2 + 原生 JavaScript 渲染/世界/实体，PHP 只负责联机信令与模组库。
不需要数据库、Node、Composer 或构建步骤，上传解压即可运行。

> 这是 **MC-fixed v4**：在原有 PHP 版基础上修复图标/方块表/存档问题，扩展 Mod API 4.0，
> 新增公开模组库与极验行为验证 4.0，并合并了 [BingoBST/Webgame](https://github.com/BingoBST/Webgame)
> 的部分资源、方块、结构与附魔内容（见 [`docs/MERGE-NOTES.md`](docs/MERGE-NOTES.md)）。

## 下载

- GitHub Releases：<https://github.com/VIPDKL/OpusMC-Reforged/releases/tag/v4.0.0>
- `MC-fixed-v4.zip`：完整部署包（不含真实极验 key）
- 仓库根目录即完整源代码（`js/`、`api/`、`mods/`、`data/`、`docs/`）

## 快速开始

```bash
# 1. 上传整个目录到 PHP 站点，例如 /MC2/
# 2. 确保 data/ 与 data/mods/ 可写
chmod 755 data data/mods

# 3. 配置极验私钥（不要提交到 Git）
cp config.local.php.example config.local.php
# 编辑 config.local.php，填写 geetest_key

# 4. 访问
https://你的域名/MC2/
https://你的域名/MC2/_check.php
```

也可以直接用 PHP 内置服务器本地运行：

```bash
php -S 127.0.0.1:8080
# 打开 http://127.0.0.1:8080/
```

## 目录

```text
index.php              游戏入口
help.php               帮助页 / 快速游戏
_check.php             环境自检
config.php             公开默认配置
config.local.php       私密配置（Git 忽略；填极验 key / 管理员密钥）
api/signal.php         WebRTC 联机信令
api/mods.php           公开模组库 API
mods-api.php           /api/ 被拦截时的备用入口
data/mods/             模组库数据（.htaccess 禁止直接访问）
mods/                  官方模组与示例
js/                    游戏源码
docs/                  合并说明与上游架构文档
game/                  旧单机版（保留对照，见下）
tools/                 旧单机版工具
启动游戏*.bat          旧单机版启动脚本
```

> **旧单机版**：仓库里的 `game/`、`tools/`、`启动游戏*.bat` 来自早期的 X1aoZhe/OpusMC 单机版，
> 保留用于对照与素材/脚本参考。新的 PHP 联机 + 模组库版本在仓库根目录，入口是 `index.php`。
> 旧版说明见 `game/README-legacy.md`。

## v4 主要变化

### 修复

- 修复 **80 个扩展方块没有贴图**、显示成石头/空白的问题（铜、紫水晶、深板岩、幽匿、下界、末地、红树、樱花等）。
- 修复灰色混凝土被深层红石矿占用的 ID 冲突，深层红石矿移到 217。
- 修复苔石、裂纹石砖、海晶灯、骨块、干草块、煤炭块、陶瓦等重复注册。
- 修复 `help.php` 脚本顺序错误导致的白屏。
- 方块 ID 扩展到 **16 位**；旧 v1 存档自动重映射，新 v2 存档不会误伤 217+ 方块。
- 图标图集改用紧凑索引并在模组加载后重建，模组图标不会再画到图集外。
- 修复模组禁用不持久化、强制重载重复注册、旧存档物品栏兼容等问题。

### 性能

- 地形列缓存、只重建受影响区块、天空矩阵缓存、图标图集紧凑索引。
- 手机端默认降低渲染距离/分辨率/粒子/阴影；桌面端保持原默认。
- 树叶腐烂 BFS 限深，避免大森林随机刻卡顿。

### Mod API 4.0

方块、物品、实体、配方、标签、熔炼、战利品、世界生成、可取消事件、命令、按键、联机网络通道、
世界存档数据、本地存储、配置、HUD、自定义贴图/图标。详见 [`模组开发说明.md`](模组开发说明.md)。

官方示例：

- `mods/sample-content.js`：红宝石方块/物品/配方/矿石/命令/按键/事件/配置
- `mods/sample-mob.js`：自定义生物与掉落

### 公开模组库

- 游戏内「模组 → 公开模组库」：搜索、排序、分页、详情、安装。
- 上传填写：名称、作者、版本、一句话简介、详细说明、标签、类型、可安装、图标、代码。
- 上传必须完成 **极验行为验证 4.0**；服务端做 HMAC-SHA256 二次校验。
- 极验不可达时可回退内置滑块（`config.php` 的 `allow_local_fallback`）。
- 文件存储、索引锁、限流、字段/大小/UTF-8/图标校验、重复代码拒绝、`admin_key` 删除。

### 合并自 BingoBST/Webgame

- 追加 71 张方块/物品贴图、36 张 GUI/实体贴图。
- 新增红石装饰、雕纹/切制砂岩、蓝色陶瓦、蜘蛛网、铁轨、土径、刷怪笼、钟、附魔台、铁砧、漏斗、酿造台、樱花等方块/物品。
- **沙漠神殿**、**废弃矿井**、`/locate` 命令。
- **附魔台**：锋利、亡灵杀手、效率、时运、保护、耐久，效果已接入攻击/挖掘/减伤/耐久。
- 樱花树苗可长成樱花树。

详细清单与未合并项见 [`docs/MERGE-NOTES.md`](docs/MERGE-NOTES.md)。

## 操作

| 按键 | 功能 |
|---|---|
| W A S D | 移动 |
| 空格 | 跳跃 / 飞行上升 |
| Shift | 潜行 / 飞行下降 |
| Ctrl / 双击 W | 疾跑 |
| 鼠标左键 | 挖掘 / 攻击 |
| 鼠标右键 | 放置 / 使用 / 附魔台等 |
| E | 物品栏 / 创造物品栏 |
| Q | 丢弃 |
| T 或 / | 聊天 / 命令 |
| H | 帮助 |
| M | 模组列表 |
| U | 连锁挖矿开关 |
| J | 示例模组：获得红宝石 |
| F1 / F3 / F5 | 隐藏 HUD / 调试 / 视角 |

常用命令：

```text
/gamemode creative|survival
/time set day|night|noon
/weather clear|rain
/give <物品> [数量]
/tp <x> <y> <z>
/summon <生物>
/dimension overworld|nether|end
/locate village|desert_pyramid|mineshaft
/ruby [数量]        # 示例模组
/guardian [数量]    # 示例模组
```

## 极验 4.0

- `captcha_id`：`3db03e7648f506644305d25391012c29`
- `key`：只放在 `config.local.php`（本仓库不提交真实 key）
- 需要把站点域名加入极验后台白名单，并允许服务器访问 `https://gcaptcha4.geetest.com`
- 未配置 key 或极验不可达时，上传会回退到内置滑块验证
- 管理员删除：配置 `admin_key` 后调用 `POST api/mods.php?action=delete`

## 联机

- 房主：多人游戏 → 创建房间，显示 `users.66ghz.com.MC2.<房间号>`
- 游客：多人游戏 → 输入完整 IP 或房间号
- 需要 HTTPS / WebRTC；`/api/` 被拦截时信令自动回退 `signal.php`

## 开发与验证

```bash
# JS 语法
for f in js/*.js mods/*.js; do node --check "$f"; done
# PHP 语法
for f in *.php api/*.php; do php -l "$f"; done
# 自检页
curl http://127.0.0.1:8080/_check.php
```

## 许可与声明

- 源代码（`js/` 中除 `assets.js`、`game/` 旧单机版、`tools/` 以外）以 MIT 许可开源，见 [`LICENSE`](LICENSE)。
- `js/assets.js` 中的贴图/GUI/字体素材版权归 **Mojang Studios / Microsoft** 及原素材作者所有，不适用 MIT，仅用于学习/演示。
- 合并自 BingoBST/Webgame 的代码/文档遵循其 MIT 许可；素材版权同上。
- 本作品为非官方项目，与 Mojang / Microsoft 无关，未获其认可。
- 模组会执行 JavaScript，只安装你信任的模组。

## 致谢

- [BingoBST/Webgame](https://github.com/BingoBST/Webgame)（结构、附魔、资源与文档参考）
- [X1aoZhe/OpusMC](https://github.com/X1aoZhe/OpusMC)（原始单机版）
