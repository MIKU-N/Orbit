<div align="center">
  <img src="./assets/logo.png" alt="Orbit · 星轨 Logo" width="128" height="128" />
  <h1>Orbit · 星轨</h1>
  <p><strong>极轻量自托管个人轨道与桌面工作台</strong></p>
  <p>微内核 · 双层插件架构 · 三网自动路由书签 · 实时跨端剪贴板 · 局域网 WebRTC P2P 快传 · 外网限额暂存箱</p>

  <p>
    <a href="https://github.com/MIKU-N/Orbit/actions/workflows/docker.yml">
      <img src="https://github.com/MIKU-N/Orbit/actions/workflows/docker.yml/badge.svg" alt="Build and Push Docker Image" />
    </a>
    <a href="https://github.com/MIKU-N/Orbit/pkgs/container/orbit">
      <img src="https://img.shields.io/badge/GHCR-amd64%20%7C%20arm64-6366f1?logo=docker&logoColor=white" alt="GHCR Multi-Arch" />
    </a>
    <img src="https://img.shields.io/badge/Go-1.27+-00ADD8?logo=go&logoColor=white" alt="Go 1.27+" />
    <img src="https://img.shields.io/badge/Node.js-24+-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24+" />
    <a href="./LICENSE">
      <img src="https://img.shields.io/badge/License-Apache--2.0-34d399" alt="Apache-2.0 License" />
    </a>
  </p>
</div>

---

后端采用 **Go + 纯 Go SQLite (`modernc.org/sqlite`)**，前端基于 **React + TypeScript + Vite** 并内嵌于单一静态可执行文件中，无 CGO 依赖、无外部数据库依赖，日常运行内存仅约 **10–25 MB**。

## 核心特性

- **微内核 + 双层插件架构**：
  - **第一层 · 7 个官方内置标准插件**：支持在设置「插件中心」独立启用/禁用，禁用后界面入口与对应服务端 API 路由同步生效（返回 `403 plugin disabled`）。
  - **第二层 · 外部轻量扩展机制**：支持上传 `.zip` 插件包或通过 `manifest.json` 声明 `iframe` / `esm` 沙箱微件、用户隔离 KV 存储，以及直连内网的 `httpProxy` 代理（绕过系统代理直连 LAN / Tailscale，并支持对非管理员自动脱敏敏感字段）。
- **高级毛玻璃质感与全局样式定制**：
  - 支持暗色/浅色毛玻璃主题、百分比模糊强度与透明度调节、背景暗化、全局圆角精确编辑、3D 光标追光微倾效果及自定义页脚。
  - **全局统一字体**：内置思源黑体 / Ubuntu Mono / OPPO Sans 4 / Mi Sans，支持上传本地字体（`.woff2`/`.woff`/`.ttf`/`.otf`）或导入外链 CSS/字体 URL。
  - **多模壁纸管理**：Bing 每日壁纸自动缓存、5 款内置极光/风景渐变预设、自定义外链与本地壁纸库定时轮换。
- **自由 2D 桌面与自适应访客模式**：
  - 桌面端支持任意组件拖拽摆放、边缘宽度缩放与中心/同伴磁吸对齐；移动端自动切换底部悬浮三胶囊。
  - 可开启访客浏览模式：仅展示公开基础模块与登录入口，并保留匿名 6 位取件码提取入口。
- **多账号与细粒度信息共享**：管理员可创建子账号，默认严格数据隔离，并按需勾选共享「外观 / 书签 / 剪贴板 / 文件 / 监控」。
- **三网智能路由书签 & 聚合搜索**：
  - 书签支持同时配置 `LAN / Tailscale / WAN` 三套地址，根据请求来源网络自动路由；支持 Chrome / Edge / Firefox / Safari 导出的 `.html` 书签及 Sun-Panel JSON 一键导入。
  - 搜索与书签解耦，支持自定义搜索引擎、前缀快捷键、图标上传/自动抓取，以及设置中心全局实时检索。
- **实时云剪贴板与双模文件快传**：
  - 基于 WebSocket 多端毫秒级同步文本与 `Ctrl+V` 截图，支持个人 API Token 终端推送。
  - 同局域网浏览器支持 WebRTC P2P 点对点直传，同时提供按网络区域自动限额的 HTTP 暂存箱与 6 位阅后即焚取件码（`/s/XXXXXX`）。

### 内置插件一览

| 插件 ID | 名称 | 功能简介 | 访客模式 |
| :--- | :--- | :--- | :--- |
| `orbit.clock` | 数字时钟 | 居中极简数字时钟，支持秒数显示开关 | 完整可用 |
| `orbit.search` | 统一搜索 | 多引擎快捷切换、仅图标模式、站内书签/剪贴板/文件统一检索 | 只读可用 |
| `orbit.weather` | 实时天气 | 区/县级定位，体感/风速/降水/气压多字段自定义 | 只读展示 |
| `orbit.bookmarks` | 极简导航 | 三网自适应路由书签分组、拖拽排序、浏览器 HTML 与 Sun-Panel 导入 | 隐藏 |
| `orbit.monitor` | 节点监控 | 宿主机 CPU、内存、Swap、多盘挂载点、温度与网络吞吐实时遥测 | 隐藏 |
| `orbit.clipboard` | 跨端剪贴板 | WebSocket 多端实时同步，支持 `Ctrl+V` 截图上传、置顶与取件码分享 | 登录提示 |
| `orbit.transfer` | 极速快传 | 局域网 WebRTC P2P 直传、三网限额文件暂存箱与 6 位阅后即焚取件码 | 登录提示 |

---

## Docker 部署指南

GitHub Actions 每次推送到 `main` 或发布 `v*` 标签时会自动构建并推送多架构镜像（支持 **`linux/amd64`** 与 **`linux/arm64`**）：

```text
ghcr.io/miku-n/orbit:latest
```

### 方式 1：Docker Compose 正式部署（推荐，适合内网服务器 / NAS）

仓库提供的 [`docker-compose.prod.yml`](./docker-compose.prod.yml) 针对生产环境做了完整优化：

- **`network_mode: host`**：直接获取真实客户端 IP，避免 Docker Bridge NAT 将局域网或 Tailscale 流量改写为 `172.x.0.1` 导致三网路由误判；同时让「节点监控」准确采集宿主机真实网卡吞吐、LAN/Tailscale IP 与主机名，并允许外部插件 `httpProxy` 直通宿主机及内网其他服务。
- **`pid: host` + `/etc/os-release:ro`**：让节点监控显示宿主机真实进程数与操作系统名称（而非容器内的 `1` 进程与 `Alpine`）。
- **内置健康检查与日志轮转**：自动探测 `/api/auth/status`，限制单日志文件最大 `10MB`（最多保留 3 份）。

#### 快速启动

```bash
mkdir -p /opt/orbit/data && cd /opt/orbit

# 下载正式部署编排文件
curl -fsSLO https://raw.githubusercontent.com/MIKU-N/Orbit/main/docker-compose.prod.yml

# 拉取镜像并后台启动
docker compose -f docker-compose.prod.yml up -d

# 查看启动日志
docker compose -f docker-compose.prod.yml logs -f orbit
```

默认监听宿主机 `:8080`，首次打开 `http://<服务器IP>:8080` 按网页引导创建管理员账号即可。

#### 自定义配置（`.env`）

无需修改 `docker-compose.prod.yml`，在同目录下新建 `.env` 即可按需覆盖参数：

```dotenv
# host 模式下直接通过 ORBIT_ADDR 更改监听端口（无需配置 ports:）
ORBIT_ADDR=:18080

# 数据持久化目录（宿主机路径）
ORBIT_DATA_PATH=/opt/orbit/data

# 纯内网直连建议 false（防止客户端伪造 X-Forwarded-For）；
# 若前面有 Nginx / Caddy 反代请设为 true
ORBIT_TRUST_PROXY=false

# 若同时通过公网域名反代访问，填写公网域名（逗号分隔），强制执行 WAN 限额策略
ORBIT_WAN_HOSTS=orbit.example.com

# 按需调整文件大小与暂存总容量上限（单位：MB）
ORBIT_LAN_MAX_MB=10240
ORBIT_TS_MAX_MB=2048
ORBIT_WAN_MAX_MB=100
ORBIT_MAX_STORAGE_MB=20480
```

> 如需在「节点监控」中查看宿主机额外挂载的数据盘或 NAS 存储卷，可在 `docker-compose.prod.yml` 的 `volumes` 中按需追加只读挂载，例如 `- /mnt/storage:/mnt/storage:ro`。

#### 更新与数据备份

```bash
# 拉取最新镜像并平滑更新（数据卷不受影响，数据库自动迁移）
cd /opt/orbit
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 安全备份（因 SQLite 启用 WAL 模式，建议停机打包整个 data 目录）
docker compose -f docker-compose.prod.yml stop
tar -czf orbit-backup-$(date +%Y%m%d).tar.gz data/
docker compose -f docker-compose.prod.yml start
```

---

### 方式 2：`docker run` 单命令快速启动

```bash
docker run -d \
  --name orbit \
  --restart unless-stopped \
  --network host \
  --pid host \
  -v /opt/orbit/data:/app/data \
  -v /etc/os-release:/etc/os-release:ro \
  -e TZ=Asia/Shanghai \
  -e ORBIT_ADDR=:8080 \
  -e ORBIT_TRUST_PROXY=false \
  ghcr.io/miku-n/orbit:latest
```

> 若在 macOS / Windows Docker Desktop（不支持 Linux `network_mode: host` 行为）体验，可将 `--network host` 替换为 `-p 8080:8080` 并去掉 `--pid host` 与 `/etc/os-release` 挂载。

---

### 方式 3：从源码自行构建镜像

克隆仓库后使用 [`docker-compose.yml`](./docker-compose.yml) 本地构建（默认 Bridge 模式映射 `8080:8080`）：

```bash
git clone https://github.com/MIKU-N/Orbit.git
cd Orbit
docker compose up -d --build
```

---

### 方式 4：本地源码编译运行

环境要求：**Go 1.27+**、**Node.js 24+**。

```bash
make build
./bin/orbit
```

默认监听 `:8080`，数据持久化在 `./data/` 目录（含 `orbit.db`、`.jwt_secret`、外部插件与上传文件）。

---

## 环境变量说明

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `ORBIT_ADDR` | `:8080` | 监听地址与端口（也兼容 `ORBIT_PORT`） |
| `ORBIT_DATA_DIR` | `./data`（容器内 `/app/data`） | SQLite 数据库、`.jwt_secret`、外部插件与文件存储目录 |
| `ORBIT_JWT_SECRET` | 自动生成 | 可选：自定义 JWT 签名密钥（留空时自动生成并持久化到 `ORBIT_DATA_DIR/.jwt_secret`） |
| `ORBIT_LAN_MAX_MB` | `10240` | 局域网单文件上限 (MB) |
| `ORBIT_TS_MAX_MB` | `2048` | Tailscale 单文件上限 (MB) |
| `ORBIT_WAN_MAX_MB` | `100` | 公网单文件上限 (MB) |
| `ORBIT_MAX_STORAGE_MB` | `20480` | 暂存区总容量上限 (MB) |
| `ORBIT_TRUST_PROXY` | `true`（`prod` 编排默认 `false`） | 是否信任内网/Tailscale 反代传入的 `X-Forwarded-For` / `X-Real-IP` |
| `ORBIT_WAN_HOSTS` | 空 | 逗号分隔的公网域名列表，匹配时强制按外网 (`wan`) 策略限额 |
| `ORBIT_ADMIN_USER` / `ORBIT_ADMIN_PASS` | 空 | 可选：仅在数据库尚无任何用户时自动初始化首个管理员账号（正式环境推荐通过网页向导创建） |
| `TZ` | `Asia/Shanghai` | 容器时区 |

---

## 内网 HTTPS 与 Tailscale + 公网 VPS 反代

- **纯 HTTP 内网访问说明**：登录 Cookie 与 WebSocket 均已自动适配 HTTP/HTTPS；但现代浏览器仅在安全上下文（`https://` 或 `localhost`）中开放 `navigator.clipboard` 一键写入。若局域网内高频使用云剪贴板「一键复制」，建议配合内网域名与 Nginx / Caddy 启用 HTTPS（或在 Chrome 中将内网地址加入 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`）。
- **公网反代部署**：推荐将 Orbit 部署在家里内网服务器 / NAS 上，公网 VPS 通过 Tailscale 内网 IP 反代过去（参考 [`deploy/Caddyfile.example`](./deploy/Caddyfile.example) 与 [`deploy/nginx.conf.example`](./deploy/nginx.conf.example)）。反代时务必转发 `X-Forwarded-For`、`X-Forwarded-Proto` 与 WebSocket `Upgrade/Connection` 请求头，并在 Orbit 侧开启 `ORBIT_TRUST_PROXY=true`、配置 `ORBIT_WAN_HOSTS`。

---

## 快捷指令 / 终端一键推剪贴板

在网页右上角「账号管理」中复制个人 `API Token`：

```bash
curl -X POST https://orbit.example.com/api/clips \
  -H "Authorization: Bearer orb_你的Token" \
  -H "Content-Type: application/json" \
  -d '{"content":"来自终端的一段文本"}'
```

---

## 开源协议 / License

本项目采用 **[Apache License 2.0](./LICENSE)** 开源。
