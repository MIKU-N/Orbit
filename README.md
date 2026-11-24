# Orbit · 星轨

极轻量自托管个人轨道与桌面工作台：**微内核 + 双层插件架构 + 三网自动路由书签 + 实时跨端剪贴板 + 局域网 WebRTC P2P 快传 + 外网限额暂存箱**。  
后端采用 **Go + 纯 Go SQLite (`modernc.org/sqlite`)**，前端基于 **React + TypeScript + Vite** 并内嵌于单一可执行文件中，运行内存约 10–25 MB。

## 核心特性

- **微内核 + 双层插件架构**：
  - **第一层 · 7 个官方内置标准插件**（数字时钟 `orbit.clock`、聚合搜索 `orbit.search`、实况天气 `orbit.weather`、三网智能书签 `orbit.bookmarks`、系统监控 `orbit.monitor`、云剪贴板 `orbit.clipboard`、文件快传与暂存 `orbit.transfer`），支持在设置「插件中心」独立启用/禁用，禁用后界面入口与对应服务端路由同步生效（`403 plugin disabled`）。
  - **第二层 · 外部轻量扩展机制**：支持上传 `.zip` 插件包或通过 `manifest.json` 声明 `iframe` / `esm` 沙箱微件、用户隔离 KV 存储与直连内网的 `httpProxy` 代理（绕过系统代理直连 LAN / Tailscale，并支持敏感配置字段对非管理员脱敏）。
- **高级毛玻璃质感与全局样式定制**：
  - 支持暗色/浅色毛玻璃主题、百分比模糊强度与透明度调节、背景暗化、全局圆角（点击数值可直接编辑 `px`/`%` 精确值）、3D 光标追光、以及底部自定义页脚。
  - **全局统一字体**：内置 **思源黑体 / Ubuntu Mono / OPPO Sans 4 / Mi Sans** 4 款精选字体，支持上传 `.woff2`/`.woff`/`.ttf`/`.otf` 本地字体或导入外链 CSS/字体 URL。
  - **多模壁纸管理**：Bing 每日壁纸自动缓存、5 款内置渐风景渐变预设、自定义外链与本地壁纸库自动定时轮换。
- **自由 2D 桌面与自适应访客模式**：
  - 桌面端支持任意组件拖拽摆放、边缘宽度缩放、中心/同伴对齐磁吸；移动端自动适配底部悬浮三胶囊。
  - 支持开启访客浏览模式：仅展示公开基础插件（时钟、聚合搜索、天气与登录入口），自适应居空白区域排版，对需鉴权的功能提示登录并仍保留匿名取件码提取入口。
- **多账号与选择性信息共享**：支持管理员新建子账号，默认严格隔离，并可根据插件权限声明按需勾选共享「外观 / 书签 / 剪贴板 / 文件 / 监控」。
- **三网智能路由书签 & 独立搜索引擎设置**：
  - 书签支持配置 `LAN / Tailscale / WAN` 三套地址按来源网络自动路由；支持 Chrome / Edge / Firefox / Safari 导出的浏览器 `.html` 书签一键单分组导入，以及 Sun-Panel JSON 导入。
  - 搜索与书签设置解耦，支持自定义搜索引擎、前缀快捷键、图标上传/网址自动抓取，以及设置中心顶部全局设置项实时检索。
- **实时剪贴板与双模文件快传**：
  - WebSocket 多端毫秒级同步文本与 `Ctrl+V` 截图，支持 API Token 推送；
  - 同局域网浏览器 WebRTC P2P 点对点直传，以及按网络环境自动限流的 HTTP 暂存箱与 6 位阅后即焚取件码（`/s/XXXXXX`）。

## 快速启动

### 方式 1：本地编译运行

```bash
make build
./bin/orbit
```

默认监听 `:8080`，数据持久化在 `./data/` 目录（含 `orbit.db`、插件目录与上传文件）。  
首次访问网页将引导初始化管理员账号。

### 方式 2：Docker Compose

```bash
docker compose up -d --build
```

### 环境变量

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `ORBIT_ADDR` | `:8080` | 监听地址与端口（也支持 `ORBIT_PORT`） |
| `ORBIT_DATA_DIR` | `./data` | SQLite 数据库、外部插件与文件存储目录 |
| `ORBIT_LAN_MAX_MB` | `10240` | 局域网单文件上限 (MB) |
| `ORBIT_TS_MAX_MB` | `2048` | Tailscale 单文件上限 (MB) |
| `ORBIT_WAN_MAX_MB` | `100` | 公网单文件上限 (MB) |
| `ORBIT_MAX_STORAGE_MB` | `20480` | 暂存区总容量上限 (MB) |
| `ORBIT_TRUST_PROXY` | `true` | 是否信任内网/Tailscale 反代的 `X-Forwarded-For` |
| `ORBIT_WAN_HOSTS` | 空 | 逗号分隔的公网域名列表，匹配时强制按外网策略限额 |
| `ORBIT_ADMIN_USER` / `ORBIT_ADMIN_PASS` | 空 | 可选：无界面自动初始化首个管理员账号 |

## Tailscale + 公网 VPS 反代部署

推荐将 Orbit 部署在家里内网服务器 / NAS 上，公网 VPS 通过 Tailscale 内网 IP 反代过去（参考 `deploy/Caddyfile.example` 与 `deploy/nginx.conf.example`）。  
当从公网域名访问时，VPS 携带真实公网客户 IP 传入 `X-Forwarded-For`，Orbit 会自动判定为 `wan` 并执行外网单文件大小限制；通过家里局域网或 Tailscale 直连访问时则自动放开限额。

## 快捷指令 / 终端一键推剪贴板

在「账号管理」复制你的个人 `API Token`：

```bash
curl -X POST https://orbit.example.com/api/clips \
  -H "Authorization: Bearer orb_你的Token" \
  -H "Content-Type: application/json" \
  -d '{"content":"来自终端的一段文本"}'
```

## 开源协议 / License

本项目采用 **[Apache License 2.0](./LICENSE)** 开源。
