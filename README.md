# SUB - 机场订阅聚合与全协议节点管理系统 (Mihomo Core)

一个现代、高颜值、全功能的一站式机场订阅聚合与节点管理系统。支持全协议节点识别与解析、基于 Mihomo 原生内核的极速并发延迟测速、规则分流整合订阅生成（内置 Loyalsoldier/clash-rules 优质分流规则库）、全量配置导入导出备份恢复、定时自动后台刷新订阅与安全账号管理。

---

## 🌟 核心特性

1. **全协议节点识别与解析**
   - 支持主流全部协议：`VMess`、`VLESS`（包含 Reality 与 Vision flow）、`Shadowsocks (SS)`、`ShadowsocksR (SSR)`、`Trojan`、`Hysteria 1/2 (hy2)`、`TUIC`、`SOCKS5`、`HTTP`。
   - 支持直接解析标准 Base64 订阅文本、Clash / Mihomo YAML 订阅、多行 URI 混合文本。
   - 可以在前端直接粘贴机场链接，或一键导入剪贴板大段原始节点链接。

2. **多机场订阅管理与视图排序**
   - **智能去重与自动编号**：添加或导入订阅时，以订阅地址 IP 作为去重依据，如遇相同 IP 订阅**自动跳过重复添加**；若未填写订阅备注/名称，系统将**自动分配递增序号 `sub-1`, `sub-2`...**。支持一次性粘贴多行订阅批量录入。
   - **多种排序机制**：支持添加时间倒序（最新在前）、添加时间正序（最早在前）、A-Z 名称升序、节点数量从多到少排序。
   - **展示视图随时切换**：支持**网格卡片视图**与**一行一行紧凑表格列表视图**自由切换，且自动记忆选择。
   - 机场订阅增删改查、开启/禁用切换、单项即时刷新、一键更新全部机场订阅。
   - **整合订阅状态独立标识**：节点列表直观显示「处于整合订阅中」状态，支持单节点点击切换与批量标记。

3. **原生 Mihomo 内核极速并发测速**
   - 深度集成 **Mihomo (Clash.Meta)** 原生内核，支持真并发测试节点可用性与延迟（ms）。
   - **导入即测速**：添加订阅或手动导入节点后，系统自动在后台执行可用性与延迟测速；成功的节点自动纳入整合订阅，失败/超时的不纳入。
   - **失败 3 次自动重试机制**：手动测速时若节点超时或失败，系统将自动进行额外 3 次重试；若依然失败则移出整合订阅。
   - **轻量右下角动态悬浮卡片**：测试进行时在屏幕右下角平滑展现动态进度条与实时节点结果，支持一键最小化与展开，不遮挡日常操作。

4. **整合订阅生成（基于 Loyalsoldier 规则）**
   - 汇聚多个机场节点，一键生成单一整合订阅。
   - 深度集成 [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules) 优质分流规则库（包含广告拦截 Reject、Apple、Google、Telegram、国内外分流等精细规则集）。
   - 自动生成 `PROXY`、`自动选择 (url-test)`、`故障转移 (fallback)`、`负载均衡 (load-balance)` 策略组。
   - 支持导出两种格式：
     - **Clash / Mihomo YAML**（适用于 Clash Verge、Clash Meta、Flclash 等）
     - **Base64 纯节点池**（适用于 v2rayN、Shadowrocket、Quantumult X 等）

5. **全量系统配置备份与恢复**
   - 支持一键将当前系统的所有机场订阅、节点池数据、整合订阅策略及系统参数导出为标准的 JSON 备份文件。
   - 支持一键导入备份文件，提供**智能合并**与**完全覆盖**两种恢复模式，无缝完成迁移与重装恢复。

6. **定时自动刷新 & 可编排测速**
   - 内置定时任务调度器，可设定 Crontab 表达式（默认每 6 小时自动更新）。
   - 订阅刷新后可自动触发重新测速与状态同步，确保客户端获取的始终是最鲜活的节点。
   - **延迟 + 网速捆绑定时**：一条 Cron 先跑延迟、再只对本轮「存活」的节点跑带宽，避免失败节点白耗流量；支持 `combined / alive / all / custom` 四种范围与自定义节点勾选。
   - **单节点测速与结果清理**：节点行内可直接测延迟 / 测网速 / 清该节点结果；工具栏支持「清延迟 / 清网速 / 清两者 / 清理全部（含未筛选）」。

7. **精致现代 UI & 账号安全登录**
   - **默认清爽明亮主题（Light Theme）**，同时支持一键无缝切换为暗色科技模式（Dark Theme）。
   - 适配全部页面组件（仪表盘卡片、协议标签、节点列表、整合订阅卡片、模态弹窗、输入框等），色彩搭配优雅精致。
   - JWT 令牌认证 + 加密密码存储（Bcrypt），支持在线修改管理员密码。

8. **节点卡片 + 历史色块 + 详情弹层**
   - **卡片 / 列表双视图**：卡片视图每条节点显示最近 10 次延迟、10 次网速的色块条（延迟 绿<200 / 黄 200–500 / 橙 500–1000 / 红 ≥1000 / 深红 超时；网速 绿≥300M / 黄 150–300 / 橙 50–150 / 红 <50 / 深红 失败），悬浮显示「第 N 次 · 时间 — 数值」，下方给平均值、峰值与成功率。
   - **流量与到期**：自动解析订阅响应头 `subscription-userinfo`，卡片显示「已用 / 总量（百分比）· 到期日（剩 N 天）」；也支持在订阅编辑里手填配额，`manual://` 自建容器不显示来源行与配额入口。
   - **详情弹层**：2h / 4h / 8h / 12h / 24h / 7d / 15d / 30d 范围切换，色块 + SVG 折线图（超时点单独标深红、断线不连），自动 / 按小时 / 按天三种聚合粒度，300ms 与 800ms 阈值参考线。
   - **对比与诊断**：可选另一个节点叠加橙色虚线对比（Y 轴取并集），折叠展示异常明细（超时 / >1000ms / 失败 / <50Mbps），底部给记录区间、连续失败次数、最后测速时间。
   - **CSV 导出**：`类型,时间,ISO时间,值,单位`，带 UTF-8 BOM + CRLF，Excel 双击不乱码。

---

## 🚀 部署方式

### 方式 1：Windows 本地运行

1. 确保安装了 [Node.js](https://nodejs.org/)（v18 或更高版本）。
2. 项目目录已内置 Windows 版 `mihomo.exe`。
3. 双击运行 `start.bat` 脚本（或在终端执行）：
   ```powershell
   npm install
   npm run build
   node backend/server.js
   ```
4. 浏览器访问：`http://127.0.0.1:3580`。

---

### 方式 2：Linux 服务器部署

1. 确保安装了 Node.js 与 Git：
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
2. 脚本会自动检查并在缺少时下载 Linux amd64 版本的 `mihomo` 内核。
3. 可使用 `systemd` 或 `pm2` 将其设为后台持久服务：
   ```bash
   npm install -g pm2
   pm2 start backend/server.js --name "sub-aggregator"
   ```

---

### 方式 3：Docker / Docker Compose 部署

1. 在项目目录下直接执行：
   ```bash
   docker compose up -d --build
   ```
2. 容器内置了 Linux amd64 的 Mihomo 内核与 Node 运行环境，数据通过 `./data` 目录持久化。
3. 浏览器访问：`http://服务器IP:3580`。

---

## 🔑 默认登录凭据

- **管理后台网址**：`http://127.0.0.1:3580`
- **默认管理员账号**：`admin`
- **默认管理员密码**：`admin123456`
*(登录系统后可在「系统配置」页面随时修改管理员密码；首次部署后请立即修改)*

---

## 🔒 本地私有覆盖（不随仓库分发）

部分只与个人节点相关的配置放在 `data/` 下（该目录已被 `.gitignore` 排除，不会提交到仓库）：

| 文件 | 作用 |
|---|---|
| `data/auto-select-exclude.json` | 字符串数组，列出**不参与 url-test 自动选择**的节点名。生成订阅时会把这些名字注入到分组的 `filter` 负向断言里，因此公开的规则仓库无需出现任何机场/节点名称。 |
| `data/generator-override.js` | 可选的本地规则/策略组覆盖模块，优先级低于 `backend/custom-generator.js`。 |

示例（`data/auto-select-exclude.json`）：

```json
["某个不想被自动选择的节点名"]
```

文件改动后无需重启，下次生成订阅即生效。

---

## ⚡ 网速测速（真实下载带宽）

延迟只代表"握手快不快"，不代表"下载快不快"。网速测速会让每个节点**真实下载一段数据**，算出实际 Mbps：

| 项 | 说明 |
|---|---|
| 原理 | 以 `mode: global` 启动临时 Mihomo 内核 + 随机 `mixed-port`，逐个 `PUT /proxies/GLOBAL` 切换出口，再用 CONNECT 隧道下载并统计字节 |
| 指标 | 丢弃前 600ms 的 TCP 慢启动窗口，取稳态区间算 `Mbps`；同时记录首字节耗时、下载字节数与耗时 |
| 测速目标 | 默认 `https://speed.cloudflare.com/__down?bytes=31457280`（Cloudflare Anycast，全球可达），失败自动回退 cachefly |
| 触发方式 | ① 节点页「测网速（当前筛选）」或单节点「测网速」 ② 定时测速（延迟 + 网速捆绑，系统配置可改 Cron / 模式 / 范围） ③ `POST /api/nodes/speed-test`、`POST /api/nodes/test-bundle` |
| 数据落地 | 节点字段 `speed / speedStatus / speedTime / speedBytes / speedDurationMs / speedUrl`，节点表「网速」列可排序 |

**为什么不直接测 YouTube**：视频是自适应码率流（1080p 一般只给 5~8Mbps），测出来的是"YouTube 分配了多少码率"而不是节点上限，还要处理会话与 DRM。Cloudflare 测速端点走的是同一条节点出口，测的是真实吞吐上限。

**流量成本**：每轮测速会真实消耗节点流量（默认约 30MB/节点）。8 个节点每天跑一次 ≈ 240MB/天，介意就把 Cron 调稀，或把测速范围收窄到「仅整合订阅内」。

---

## 📈 历史记录与节点详情

每次延迟 / 网速测速都会往节点上追加一条历史（延迟含 `-1` 超时，网速含 `-1` 失败），默认保留 **30 天 / 最多 3000 条**，落在 `data/database.json` 的 `delayHistory` / `speedHistory` 里。

**卡片上的色块条**：最近 10 次，时间从左到右正序，悬浮看「第 N 次 · 时间 — 数值」，块宽按该桶内样本数加权。

**点卡片进详情弹层**：

| 能力 | 说明 |
|---|---|
| 时间范围 | 2h / 4h / 8h / 12h / 24h（默认）/ 7d / 15d / 30d |
| 聚合粒度 | `自动`（≤200 点画原始值，≤600 按小时，更多按天，桶内取均值，全失败记 -1）/ 按小时 / 按天 |
| 折线图 | 纯 SVG，x 轴真实时间、y 轴自适应；超时 / 失败点单独画深红方块且断开连线 |
| 阈值线 | 延迟图固定 300ms 与 800ms 两条红色虚线，y 轴刻度同步标出 |
| 对比 | 选另一个节点叠加橙色虚线（网速图同理），y 轴取两节点并集，图例注明「色块与统计仅统计本节点」 |
| 异常明细 | 折叠列表：延迟超时或 >1000ms、网速失败或 <50Mbps，倒序带时间戳 |
| 健康度 | 头部 `⚠ 连续失败 N 次`（≥3 显示），底部记录区间 / 连续失败 / 最后测速时间 |
| 导出 | CSV（`类型,时间,ISO时间,值,单位`，UTF-8 BOM + CRLF，Excel 直接打开） |

---

## 🧭 页面地址（可直接分享）

前端使用 History 路由，地址栏就是真实路径，刷新 / 收藏 / 发链接都不会掉回首页：

| 地址 | 页面 |
|---|---|
| `/` | 仪表盘概览 |
| `/subscriptions` | 机场订阅管理 |
| `/nodes` | 节点池与测速 |
| `/nodes?sub=<订阅ID>` | 节点池，且按该订阅筛选 |
| `/profiles` | 整合订阅 (分流) |
| `/settings` | 系统配置 |
| `/fofa` | FOFA 订阅发现 |

后端对非 `/api`、非 `/sub`、无扩展名的 GET 请求回退 `index.html`（SPA fallback）；静态资源缺失仍返回真正的 404。旧版 hash 链接（`/#nodes`）会自动迁移到 `/nodes`。

---

## 📁 目录结构说明

```
SUB/
├── backend/                  # 服务端代码
│   ├── server.js             # Express API 与 WebSocket 主服务
│   ├── parser.js             # VMess/VLESS/SS/SSR/Trojan/Hy2/TUIC 等全协议解析器
│   ├── tester.js             # Mihomo 内核动态调用与并发延迟测速
│   ├── speedtest.js          # 节点真实下载带宽测速（CONNECT 隧道 + 稳态吞吐）
│   ├── speedRunner.js        # 网速测速任务编排（手动 / 定时共用）
│   ├── testBundle.js         # 延迟 + 网速捆绑任务（一条 Cron 串两阶段，带单任务锁）
│   ├── generator.js          # Loyalsoldier 分流规则生成与订阅配置构建
│   ├── fetcher.js            # 机场订阅远程抓取与容错更新（含 subscription-userinfo 解析）
│   ├── scheduler.js          # 定时后台刷新与定时测速任务
│   └── db.js                 # JSON 扁平化数据持久化引擎（含延迟/网速历史与配额）
├── src/                      # Vue 3 前端代码
│   ├── components/           # 弹窗与通用组件 (LoginModal, NodeDetailModal)
│   ├── views/                # 视图页面 (Dashboard, Subscriptions, Nodes, Profiles, Settings, Fofa)
│   ├── api.js                # Axios 请求封装与拦截
│   └── assets/style.css      # 毛玻璃现代样式 (明亮 / 暗色双主题)
├── data/                     # 数据持久化目录 (database.json)
├── dist/                     # 前端编译产物 (直接由 Node 托管)
├── Dockerfile                # Docker 容器构建定义
├── docker-compose.yml        # Docker Compose 编排文件
├── start.bat                 # Windows 一键启动脚本
├── start.sh                  # Linux 一键启动脚本
└── package.json              # 项目依赖与构建指令
```
