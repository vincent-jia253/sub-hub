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

6. **定时自动刷新**
   - 内置定时任务调度器，可设定 Crontab 表达式（默认每 6 小时自动更新）。
   - 订阅刷新后可自动触发重新测速与状态同步，确保客户端获取的始终是最鲜活的节点。

7. **精致现代 UI & 账号安全登录**
   - **默认清爽明亮主题（Light Theme）**，同时支持一键无缝切换为暗色科技模式（Dark Theme）。
   - 适配全部页面组件（仪表盘卡片、协议标签、节点列表、整合订阅卡片、模态弹窗、输入框等），色彩搭配优雅精致。
   - JWT 令牌认证 + 加密密码存储（Bcrypt），支持在线修改管理员密码。

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

## 📁 目录结构说明

```
SUB/
├── backend/                  # 服务端代码
│   ├── server.js             # Express API 与 WebSocket 主服务
│   ├── parser.js             # VMess/VLESS/SS/SSR/Trojan/Hy2/TUIC 等全协议解析器
│   ├── tester.js             # Mihomo 内核动态调用与并发延迟测速
│   ├── generator.js          # Loyalsoldier 分流规则生成与订阅配置构建
│   ├── fetcher.js            # 机场订阅远程抓取与容错更新
│   ├── scheduler.js          # 定时后台自动刷新任务
│   └── db.js                 # JSON 扁平化数据持久化引擎
├── src/                      # Vue 3 前端代码
│   ├── components/           # 弹窗与通用组件 (LoginModal 等)
│   ├── views/                # 视图页面 (Dashboard, Subscriptions, Nodes, Profiles, Settings)
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
