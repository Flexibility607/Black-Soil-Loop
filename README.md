# Black-Soil-Loop：B01 网页端

本 fork 现作为黑土循环网页仓库：维护 E01 管理台、E02 产销协同大屏、Cloudflare 构建与前端测试。生产构建固定连接 `https://api.flexibility607.cn/api/v1`，不会打包 Mock；显式执行 `npm run build:demo` 才会生成本地演示构建。

新的 B01/B02 FastAPI 与 PostgreSQL 实现位于独立仓库 `Flexibility607/Black-Soil-Loop-server`。本仓库原有 `app/`、Alembic 和后端测试暂时只作迁移来源留存，待新服务器通过 PostgreSQL、线上部署与恢复验收后再删除，不能继续作为生产后端发布。

## 当前网页结构

- `frontdesign-v1/`：E01 管理台与 E02 公开大屏，接入新服务器 OpenAPI、SSE 和受控智能助手。
- `dist/`：由构建脚本生成的 Cloudflare/阿里云共用静态制品。
- `build-cloudflare.mjs`、`cloudflare-worker.js`：生产构建与 Cloudflare Worker。
- `pages-forwarder/`：Cloudflare Pages 服务绑定入口。
- `design.md`、`.hallmark/`：界面设计约束和视觉审核记录。

## 网页开发与验证

```powershell
npm ci
npm run test:frontend
```

本地联调时在 `runtime-config.js` 中显式指定本地 B01 地址；提交或发布前必须重新执行 `npm run build`，确认 `dist/runtime-config.js` 指向生产 API 且 `dist/mock/` 不存在。

## 迁移前旧结构（只读参考）

- `app/`、`alembic/`、`tests/`：FastAPI 后端、数据库迁移和回归测试。
- `frontdesign-v1/`：E01 管理台与 E02 16:9 大屏，包含本地 ECharts、字体、东北三省地图和冰雪农业背景的构建入口。
- `frontend-mocks-v0.1/`：前端 Mock 数据，含丰富的 E02 演示数据，并明确标记为模拟数据。
- `start-dev.ps1`：Windows 一键启动后端和静态前端。
- `verify-local.ps1`：使用真实 PostgreSQL、独立端口和 Cloudflare dry-run 验收本地全功能。
- `verify-cloudflare.mjs`：对已部署域名检查前端资源、全部 Mock JSON 和 404 行为。
- `pages-forwarder/`：只通过 Service Binding 转发现有 Worker 的 Cloudflare Pages 备用入口。
- `manage-accounts.ps1`：仅供本机可信运维人员使用的 E01 账户维护入口。

## 本机启动

在本仓库根目录执行：

```powershell
Copy-Item .env.example .env
# 编辑 .env，填写非 superuser 的 DATABASE_URL 和长度不少于 32 字节的随机 JWT_SECRET

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

.\.venv\Scripts\alembic.exe -c alembic.ini upgrade head
.\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
```

如果 PostgreSQL 中还没有 `challenge_cup` 数据库，需要先用 PostgreSQL 自带工具创建数据库；本项目不会自动创建或删除数据库。

### 一键启动演示

完成 `.env`、虚拟环境和数据库迁移后，在仓库根目录执行：

```powershell
.\start-dev.ps1
```

脚本会启动后端 `http://127.0.0.1:8000/healthz` 和前端 `http://localhost:8080/frontdesign-v1/`，并自动打开浏览器。使用 `-NoBrowser` 可跳过自动打开；按 `Ctrl+C` 会停止两个服务。E02 默认请求真实后端，首次连接失败时才使用带明显标记的本地演示快照。

接口文档：`http://127.0.0.1:8000/docs`

健康检查：`http://127.0.0.1:8000/healthz`

`DATABASE_URL` 是必填配置；代码没有数据库连接回退值，缺少 `.env` 时会直接启动失败。建议使用 `b01_app` 等非 superuser 账号，不要让后端使用 `postgres`。密码如果包含 `#`、`@`、`:` 等 URL 特殊字符，必须进行 percent-encoding；也可以使用 PostgreSQL 用户密码文件把密码从项目配置中移出。

## E01 账户创建与维护

E01 网页账号存放在业务数据库的 `users` 表中，与 PostgreSQL 连接账号是两套独立身份：

- `b01_app` 一类账号只供后端连接 PostgreSQL，不能登录 E01。
- `park_admin` 是园区管理员，可使用园区范围的 E01 功能。
- `enterprise_admin` 是企业管理员，只能访问其 `enterprise_ids` 范围内的数据。
- 仓库不内置默认网页账号或默认密码；克隆仓库、运行迁移都不会自动创建管理员。

账户维护只开放为本机命令，不提供公开 HTTP 创建账号接口。密码通过终端隐藏输入，后端仅保存 `argon2id` 哈希；命令不会打印密码或密码哈希。

### 创建首个园区管理员

先确认 `.env` 已连接到目标数据库，并迁移到最新版本：

```powershell
.\.venv\Scripts\alembic.exe -c alembic.ini upgrade head
```

然后在仓库根目录执行以下命令。`PARK-001` 是演示园区 ID；接入真实数据时应替换为实际 `park_id`。

```powershell
.\manage-accounts.ps1 create --username park_admin --role park_admin --park-id PARK-001
```

终端会依次提示输入和确认密码，输入过程不会回显。密码要求：

- 12～256 位；推荐使用长口令。
- 不能与用户名完全相同。
- 不要把密码写入 `.env`、README、脚本参数、聊天记录或 Git。

创建完成后检查账号列表：

```powershell
.\manage-accounts.ps1 list
```

启动项目后，在 E01 页面关闭右上角“Mock 数据”，点击“E01 登录”，输入刚创建的网页账号和密码。若 Mock 开关仍开启，页面使用的是示例会话，不会验证真实数据库账号。

如果 PowerShell 执行策略阻止脚本，可直接调用相同的 Python 命令：

```powershell
.\.venv\Scripts\python.exe -m app.cli.accounts create --username park_admin --role park_admin --park-id PARK-001
```

### 创建其他管理员

允许创建多个园区管理员；每个账号分别维护，且每个账号同一时间只保留最后一次登录会话。

```powershell
.\manage-accounts.ps1 create --username park_reviewer --role park_admin --park-id PARK-001
```

创建企业管理员时至少指定一个企业 ID；重复 `--enterprise-id` 可配置多个企业范围：

```powershell
.\manage-accounts.ps1 create --username ent001_admin --role enterprise_admin --park-id PARK-001 --enterprise-id ENT-001
.\manage-accounts.ps1 create --username joint_admin --role enterprise_admin --park-id PARK-001 --enterprise-id ENT-001 --enterprise-id ENT-002
```

### 日常维护命令

所有命令都在仓库根目录执行：

```powershell
# 查看用户名、角色、启停状态、园区、企业范围和最后登录时间
.\manage-accounts.ps1 list

# 重置密码；新密码仍通过隐藏提示输入，既有登录立即失效
.\manage-accounts.ps1 reset-password park_admin

# 停用或重新启用账号；停用会立即注销既有登录
.\manage-accounts.ps1 deactivate park_admin
.\manage-accounts.ps1 activate park_admin

# 完整替换角色和数据范围；修改后既有登录立即失效
.\manage-accounts.ps1 set-scope ent001_admin --role enterprise_admin --park-id PARK-001 --enterprise-id ENT-003
```

演示版不提供物理删除账号的命令。离职、交接或疑似泄露时应先 `deactivate`，确认无误后保留记录；需要恢复时再 `activate`。如果误停用了唯一园区管理员，仍可在服务器本机运行 `activate` 恢复，不需要 PostgreSQL superuser。

### 会话与安全规则

- Access Token 有效期 120 分钟，Refresh Token 有效期 7 天；连续 30 分钟无操作后必须重新登录。
- 同一账号只允许一个登录会话：再次登录会使此前设备的 Access Token 和 Refresh Token 同时失效。
- 重置密码、停用账号或修改角色/数据范围都会立即使既有令牌失效。
- 可以创建多个管理员账号，但不要多人共用同一用户名；应为每位维护人员单独建号。
- `list` 不显示用户 ID、密码或哈希。正式部署前应备份数据库，并轮换 `.env` 中的数据库密码和 `JWT_SECRET`。
- 当前账户维护没有网页管理界面，也没有完整的维护操作审计表；演示阶段由可信运维人员在服务器本机执行命令。

## Cloudflare 前端与 Mock 自动部署

GitHub 仓库继续完整保留后端、前端、Mock、迁移、脚本和公开文档。Cloudflare 构建把 E01/E02、本地地图、字体、背景、ECharts 和 JSON 演示快照放入静态产物；Worker 把同源 `/api/v1/*` 转发给 FastAPI。生产默认请求真实后端，首次不可用时 E02 才加载带醒目标识的本地演示快照。

首次本地验证：

```powershell
npm ci
npm run build
npm run cf:check
```

`npm run build` 会先逐个解析 Mock 响应，再生成被 Git 忽略的 `dist/`。任一 JSON 损坏或缺少 `data` 字段都会让构建失败；生产产物检查禁止 localhost、在线地图、Google Fonts 和 CDN。`npm run cf:dev` 可启动本地 Cloudflare 预览；仓库合并至 `main` 后由既有 Cloudflare Git 流程自动部署。

Cloudflare 生产环境需要配置：

- `BACKEND_API_BASE_URL`：FastAPI 的 HTTPS 源站地址，不含 `/api/v1`。
- `DASHBOARD_SERVICE_TOKEN`：与后端一致的强随机助手服务令牌，作为 Worker Secret 保存。

本地开发可复制 `.dev.vars.example` 为 `.dev.vars`。OpenAI 密钥只保存在 FastAPI 的环境变量中。

在 Cloudflare Workers 的“导入 Git 仓库”页面填写：

| 配置项 | 值 |
|---|---|
| 项目名称 | `black-soil-loop` |
| 生产分支 | `main` |
| 构建命令 | `npm run build` |
| 部署命令 | `npx wrangler deploy` |
| 非生产分支部署命令 | `npx wrangler versions upload` |
| 路径 | `/` |
| 构建变量 | 留空 |

项目名称必须与 `wrangler.jsonc` 的 `name` 完全一致。Cloudflare 的 GitHub 集成连接成功后，每次推送 `main` 都会自动构建并更新生产部署；其他分支只有在启用“非生产分支构建”后才生成预览版本。

首次部署成功后，用 Cloudflare 显示的正式域名执行线上 Mock 冒烟测试：

```powershell
npm run verify:cloud -- https://你的域名.workers.dev
```

该命令会检查首页默认勾选 Mock、CSS/JavaScript、仓库内全部 18 个 JSON，以及缺失 Mock 必须返回 404。不要用本地 Wrangler 预览结果代替正式域名测试。

### Pages 备用转发入口

`pages-forwarder/` 不复制前端、Mock 或后端，也不做 302 跳转。其 `_worker.js` 通过 `UPSTREAM` Service Binding 把访问路径转发给 `black-soil-loop` Worker，因此浏览器保持在 Pages 域名，Worker 后续自动部署也会立即反映到该入口。

当前备用入口：<https://black-soil-loop-f607.pages.dev/>。

首次创建与部署：

```powershell
npm run verify:pages
npx wrangler pages project create black-soil-loop-f607 --production-branch main
npm run pages:deploy
```

必须明确：该 Pages 地址只是额外入口，不能保证中国大陆稳定访问。Cloudflare 官方说明 `pages.dev` 证书不位于中国大陆，Pages 不属于其中国大陆直接可用服务；若答辩或正式运行要求稳定的大陆访问，需要完成 ICP 备案的自有域名及适用的中国网络方案。

截图里 API 令牌缺少的 SSL、Connectivity Directory 和 AI Search 权限不属于本静态站点。不要为了消除提示盲目扩大权限；只需确认所选构建令牌拥有 `Workers Scripts: Edit`。如果首次部署明确报权限错误，再在 Cloudflare 的 Builds 设置中创建或选择具备该权限的构建令牌。

## 测试与质量检查

完整本机验收推荐直接执行：

```powershell
.\verify-local.ps1
```

脚本依次运行 Ruff、全部后端与前端测试、真实 PostgreSQL 迁移头与快照查询、CORS、Pages 转发校验和 Cloudflare 构建/dry-run，并在 `18000/18080` 独立端口启动真实后端和静态前端进行 HTTP 探测。它只读取本机业务数据库，不创建、修改或删除业务记录；测试结束会关闭自己启动的进程。

分项检查仍可执行：

```powershell
.\.venv\Scripts\ruff.exe check app tests scripts
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe scripts\verify_runtime.py
```

pytest 使用 SQLite 隔离库；`verify_runtime.py` 只读连接 `.env` 指向的 PostgreSQL，检查迁移 head、`SELECT 1`、公开接口、认证边界和 CORS。GitHub 的 `.github/workflows/verify.yml` 会在每次 push 到 `main` 及 Pull Request 时使用临时 PostgreSQL 重跑同一套后端和 Cloudflare 构建检查。

## 当前接口

- `GET /healthz`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/meta/dictionaries`
- `GET/POST /api/v1/parks`、`GET/PATCH /api/v1/parks/{park_id}`
- `GET/POST /api/v1/enterprises`、`GET/PATCH /api/v1/enterprises/{enterprise_id}`
- `GET/POST /api/v1/enterprise-tags`、`GET/PATCH /api/v1/enterprise-tags/{enterprise_id}/{tag}`
- `GET/POST /api/v1/partners`、`GET/PATCH /api/v1/partners/{partner_id}`
- `GET/POST /api/v1/stores`、`GET/PATCH /api/v1/stores/{store_id}`
- `GET/POST /api/v1/production-plans`、`GET/PATCH /api/v1/production-plans/{plan_id}`
- `GET/POST /api/v1/production-orders`、`GET/PATCH /api/v1/production-orders/{production_order_id}`
- `GET/POST /api/v1/boms`、`GET/PATCH /api/v1/boms/{bom_id}/{product_id}/{material_id}`
- `GET/POST /api/v1/inventories`、`GET/PATCH /api/v1/inventories/{inventory_record_id}`
- `GET/POST /api/v1/sales-order-lines`、`GET/PATCH /api/v1/sales-order-lines/{sales_order_id}/{line_no}`
- `GET/POST /api/v1/returns`、`GET/PATCH /api/v1/returns/{return_id}`
- `GET/POST /api/v1/transport-task-summaries`、`GET/PATCH /api/v1/transport-task-summaries/{task_id}`
- `GET/POST /api/v1/transport-resources`、`GET/PATCH /api/v1/transport-resources/{driver_id}/{vehicle_id}`
- `GET/POST /api/v1/freezer-records`、`GET/PATCH /api/v1/freezer-records/{freezer_id}/{recorded_at}`
- `GET/POST /api/v1/preorders`、`GET/PATCH /api/v1/preorders/{preorder_id}`
- `GET/POST /api/v1/procurement-demands`、`GET/PATCH /api/v1/procurement-demands/{demand_id}`
- `GET/POST /api/v1/supplier-quotes`、`GET/PATCH /api/v1/supplier-quotes/{supplier_id}/{material_id}/{tier_id}`
- `GET/POST /api/v1/policies`、`GET/PATCH /api/v1/policies/{policy_id}`
- `GET /api/v1/imports/template`、`POST /api/v1/imports/precheck`、`GET /api/v1/imports/{batch_id}`、`GET /api/v1/imports/{batch_id}/errors`、`POST /api/v1/imports/{batch_id}/confirm`
- `GET /api/v1/dashboard/overview`、`/capacity`、`/inventory`、`/sales`、`/preorders`、`/transport`、`/freezers`、`/production-progress`
- `GET /api/v1/analytics/material-demand`、`/freezers/summary`、`/production/progress`
- `POST /api/v1/procurements/aggregate-preview`、`/transport-matches/preview`、`/routes/estimate`、`/policies/match`
- 领导反馈业务：`GET/POST/PATCH /api/v1/enterprise-capacities`、`/inventory-threshold-requests`、`/inventory-alerts`、`/procurement-history`；安全库存另有 `/approve`、`/reject`、`/acknowledge`；运输遥测为 `GET/POST /api/v1/transport-telemetry`；计算历史为 `GET /api/v1/calculation-runs`；预计订单转换为 `POST /api/v1/preorders/{preorder_id}/convert`
- E02 快照：`GET /api/v1/public/dashboard/snapshot?period=7d|30d|month`；E01 鉴权快照：`GET /api/v1/dashboard/snapshot`
- B02 事件：`POST /api/v1/internal/b02/events`
- 语音助手：`POST /api/v1/public/assistant/transcriptions`、`POST /api/v1/public/assistant/query`
- 旧版 E02 公开接口继续兼容：`GET /api/v1/public/dashboard/overview`、`/capacity`、`/preorders`、`/transport`、`/policies`、`/news`

18 类 B01 业务资源已实现基础 CRUD、企业/园区范围权限、来源事件幂等保护和 `object_version` 乐观锁；本轮新增门店渠道、园区坐标、B02 HMAC/nonce/连续版本事件收件箱、经营日报投影、语音助手限流和单设备会话控制。真实 PostgreSQL 需使用非 superuser 完成 `0001`～`0010` 迁移。

导入接口接收已确认的多工作表 XLSX：先整本预检，再由 E01 以 `{"confirmed": true}` 确认；确认按固定依赖顺序在一个事务中写入。当前模板含 19 个业务工作表，新增“采购历史”，支持 `SKIPPED_STALE`、`DUPLICATE` 和 `IDEMPOTENCY_CONFLICT` 规则。集中采购默认分析近 90 天有效历史记录，并按供应商计算加权平均单价。

看板和计算接口只使用当前数据库真实记录；缺少输入返回 `DATA_MISSING`，未配置地图服务的路线估算返回 `RULE_MISSING`，不会生成虚假的路线或预测精度。B01 规则计算会保存独立快照和规则版本。E02 公开接口不需要 JWT，只返回脱敏汇总、趋势、政策来源链接和运输路径异常点，不返回司机电话、车牌等敏感字段。会话 30 分钟无操作后需重新登录，刷新令牌不能绕过超时；同一账号再次登录会立即替换旧会话。
