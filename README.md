# B01 网页后端

当前实现覆盖 B01 网页后端 v0.1：FastAPI 应用、统一响应、JWT 认证、18 类业务资源、XLSX 两阶段导入、E01 看板与计算接口、E02 公开只读接口，以及完整 Alembic 迁移链。

## 本机启动

在项目根目录执行：

```powershell
Copy-Item backend/.env.example backend/.env
# 编辑 backend/.env，填写非 superuser 的 DATABASE_URL 和长度不少于 32 字节的随机 JWT_SECRET

.\backend\.venv\Scripts\alembic.exe -c backend\alembic.ini upgrade head
.\backend\.venv\Scripts\uvicorn.exe app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

如果 PostgreSQL 中还没有 `challenge_cup` 数据库，需要先用 PostgreSQL 自带工具创建数据库；本项目不会自动创建或删除数据库。

接口文档：`http://127.0.0.1:8000/docs`

健康检查：`http://127.0.0.1:8000/healthz`

`DATABASE_URL` 是必填配置；代码没有数据库连接回退值，缺少 `backend/.env` 时会直接启动失败。建议使用 `b01_app` 等非 superuser 账号，不要让后端使用 `postgres`。密码如果包含 `#`、`@`、`:` 等 URL 特殊字符，必须进行 percent-encoding；也可以使用 PostgreSQL 用户密码文件把密码从项目配置中移出。

## 测试与质量检查

```powershell
.\backend\.venv\Scripts\ruff.exe check backend\app backend\tests
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -q
```

测试使用 SQLite 隔离库，不会修改本机 PostgreSQL。

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
- E02 公开只读：`GET /api/v1/public/dashboard/overview`、`/capacity`、`/preorders`、`/transport`

18 类 B01 业务资源已实现基础 CRUD、企业/园区范围权限、来源事件幂等保护和 `object_version` 乐观锁；批量导入、看板、计算和 E02 公开接口也已接通。真实 PostgreSQL 已使用非 superuser 完成 `0001`～`0007` 迁移并通过连接冒烟。

导入接口接收已确认的多工作表 XLSX：先整本预检，再由 E01 以 `{"confirmed": true}` 确认；确认按固定依赖顺序在一个事务中写入。批次会保存规范化行，支持 `SKIPPED_STALE`、`DUPLICATE` 和 `IDEMPOTENCY_CONFLICT` 规则。

看板和计算接口只使用当前数据库真实记录；缺少输入返回 `DATA_MISSING`，未配置地图服务的路线估算返回 `RULE_MISSING`，不会生成虚假的路线或预测精度。E02 公开接口不需要 JWT，只返回脱敏汇总；由于预订单当前没有园区归属字段，公开预订单列表暂返回空集，避免跨园区混合暴露。
