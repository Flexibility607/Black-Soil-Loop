# B01 网页后端 E01 / E02 接口清单 v0.1

> 用途：供 E01 信息共享网页和 E02 数字化大屏前端并行开发、Mock 和联调。
>
> 范围：仅 B01 网页后端；不包含 E03～E05、B02、小程序库存、签收、位置、温湿度或运输执行接口。

配套的机器可读契约为 [`openapi-v0.1.json`](openapi-v0.1.json)，前端示例响应位于 [`frontend-mocks-v0.1/`](frontend-mocks-v0.1/)。字段结构以 OpenAPI 为准，XLSX 负责约束批量导入格式。

## 1. 已冻结的通用契约

| 项目 | 约定 |
|---|---|
| 基础路径 | `/api/v1` |
| 数据格式 | REST / JSON；文件上传使用 `multipart/form-data` |
| E01 认证 | JWT；`park_admin`、`enterprise_admin` |
| E02 认证 | 公开只读，无写接口 |
| JWT 时效 | access token 2 小时；refresh token 7 天 |
| 时间 | ISO 8601 且必须带时区，例如 `2026-07-23T09:30:00+08:00` |
| 日期 | `YYYY-MM-DD` |
| 分页 | `page=1`、`page_size=20`；`page_size` 最大 100 |
| 更新 | 使用 `PATCH`；请求必须携带 `object_version` |
| 删除 | 不提供硬删除；通过 `status=INACTIVE` 或 `CANCELLED` 保留历史 |
| E02 缓存 | 允许缓存 30 秒；响应保留 `data_cutoff` |
| E02 脱敏 | 不返回姓名、电话、详细地址、司机资料、实时位置等敏感字段 |

### 1.1 开发期技术栈和运行方式

- 当前后端：Python 3.13.5、FastAPI、Pydantic、SQLAlchemy 2、Alembic、PostgreSQL、pytest；依赖版本范围见 `backend/requirements.txt`。
- 前端只依赖 HTTP/JSON 契约，不依赖后端框架；可直接从 OpenAPI 生成 TypeScript 类型和请求客户端。
- 开发期使用本机 Python 虚拟环境启动 API，连接本机或团队提供的 PostgreSQL；基础地址暂定 `http://localhost:8000/api/v1`。
- 暂不考虑容器化：本阶段不创建 Dockerfile、Docker Compose 或容器部署配置。技术栈在后端开工前仍需义人最终确认。

业务资源的 `POST` / `PATCH` 写接口统一使用事件外壳；认证接口和文件上传/批次确认接口按各自专用请求体，不套事件外壳：

```json
{
  "schema_version": "1.0",
  "event_id": "EV-POLICY-001-001",
  "object_type": "policy",
  "object_id": "POLICY-001",
  "object_version": 1,
  "occurred_at": "2026-07-23T09:30:00+08:00",
  "payload": {}
}
```

`event_id` 用于 API 请求幂等；文件导入仍使用 `source_system + source_record_id` 去重，并由 `source_updated_at` 控制新旧覆盖。

`object_version` 是 API 乐观锁字段：后端创建记录时生成，详情和列表响应必须返回；`PATCH` 在事件外壳中携带当前版本。它不是 XLSX 导入列，Excel 导入的并发和覆盖只按 `source_updated_at` 与整本事务规则处理。网页表单写接口也不要求填写 `source_*`，这些字段是文件导入元数据。

金额字段使用 JSON number，并同时返回/提交 `currency`；v0.1 固定使用 ISO 4217 代码 `CNY`。

统一响应：

```json
{
  "status": "PROCESSED",
  "code": "OK",
  "data": {},
  "errors": [],
  "trace_id": "TRACE-001",
  "data_cutoff": "2026-07-23T09:30:00+08:00"
}
```

列表接口的 `data`：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 20
}
```

## 2. 认证和前端初始化

| 编号 | 方法 | 路径 | 调用端 | 用途 |
|---|---|---|---|---|
| API-AUTH-001 | `POST` | `/api/v1/auth/login` | E01 | 用户名、密码登录，返回 access token、refresh token 和角色范围 |
| API-AUTH-002 | `POST` | `/api/v1/auth/refresh` | E01 | 使用 refresh token 换取新的 access token |
| API-AUTH-003 | `GET` | `/api/v1/auth/me` | E01 | 返回当前用户、角色、`park_id`、允许的 `enterprise_ids` |
| API-AUTH-004 | `POST` | `/api/v1/auth/logout` | E01 | 使当前 refresh token 失效 |
| API-META-001 | `GET` | `/api/v1/meta/dictionaries` | E01 | 返回状态、单位、来源类型和前端下拉选项 |

## 3. 文件导入

导入采用“预检—确认”两阶段；一个工作簿是一个事务批次，任一错误导致整本不写库。

| 编号 | 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|---|
| API-IMP-001 | `GET` | `/api/v1/imports/template` | E01 | 下载当前 B01 XLSX 模板 |
| API-IMP-002 | `POST` | `/api/v1/imports/precheck` | E01 | 上传 XLSX，完成全表、跨表、权限和幂等预检；不写业务库 |
| API-IMP-003 | `GET` | `/api/v1/imports/{batch_id}` | E01 | 查询预检或正式导入状态、统计和 `data_cutoff` |
| API-IMP-004 | `GET` | `/api/v1/imports/{batch_id}/errors` | E01 | 返回 `sheet_name`、`row_number`、`field_key`、`error_code`、`message` |
| API-IMP-005 | `POST` | `/api/v1/imports/{batch_id}/confirm` | E01 | 确认已通过预检的批次并以整本事务写库 |

`park_admin` 可导入全部 B01 数据；`enterprise_admin` 只能导入 JWT 授权企业的数据。E02 无导入权限。

导入批次状态机：

| 状态 | 含义 | 允许的后续状态 |
|---|---|---|
| `UPLOADED` | 文件已接收 | `PRECHECKING` |
| `PRECHECKING` | 正在整本预检 | `READY_TO_CONFIRM`、`PRECHECK_FAILED` |
| `READY_TO_CONFIRM` | 预检通过，等待用户确认 | `IMPORTING`、`EXPIRED` |
| `PRECHECK_FAILED` | 预检失败，整本未写库 | 终态；修正文件后新建批次 |
| `IMPORTING` | 正在单事务写入 | `COMPLETED`、`FAILED` |
| `COMPLETED` | 整本提交成功 | 终态 |
| `FAILED` | 写入失败且整本回滚 | 终态；重新预检后新建批次 |
| `EXPIRED` | 批次已过期 | 终态 |

来源时间处理：

| 情况 | 结果 |
|---|---|
| `source_updated_at` 更新 | 覆盖同一业务实体 |
| `source_updated_at` 更旧 | `SKIPPED_STALE`，不写库 |
| 同时间、同内容 | `DUPLICATE`，不重复计数 |
| 同时间、不同内容 | HTTP 409 + `IDEMPOTENCY_CONFLICT` |

## 4. E01 业务资源接口

### 4.1 标准资源操作

下表中的“集合路径”统一支持：

- `GET 集合路径`：分页、筛选、排序；
- `POST 集合路径`：新增；
- `GET 单项路径`：详情；
- `PATCH 单项路径`：携带 `object_version` 局部更新。

不提供 `DELETE`。`enterprise_admin` 的企业范围由 JWT 决定；请求中的越权 `enterprise_id` 返回 `FORBIDDEN`。

复合键路径参数必须逐项 URL 编码，尤其是 `tag` 和带时区的 `recorded_at`。

| 编号 | 资源 | 集合路径 | 单项路径 | E01 写权限 |
|---|---|---|---|---|
| API-E01-R01 | 园区档案 | `/api/v1/parks` | `/api/v1/parks/{park_id}` | `park_admin` |
| API-E01-R02 | 企业档案 | `/api/v1/enterprises` | `/api/v1/enterprises/{enterprise_id}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R03 | 企业标签 | `/api/v1/enterprise-tags` | `/api/v1/enterprise-tags/{enterprise_id}/{tag}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R04 | 合作方 | `/api/v1/partners` | `/api/v1/partners/{partner_id}` | `park_admin` |
| API-E01-R05 | 门店 | `/api/v1/stores` | `/api/v1/stores/{store_id}` | `park_admin` |
| API-E01-R06 | 生产计划 | `/api/v1/production-plans` | `/api/v1/production-plans/{plan_id}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R07 | 生产订单 | `/api/v1/production-orders` | `/api/v1/production-orders/{production_order_id}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R08 | 物料清单 | `/api/v1/boms` | `/api/v1/boms/{bom_id}/{product_id}/{material_id}` | 园区管理员；企业管理员仅自身企业或通用 BOM 授权范围 |
| API-E01-R09 | 企业库存 | `/api/v1/inventories` | `/api/v1/inventories/{inventory_record_id}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R10 | 销售订单明细 | `/api/v1/sales-order-lines` | `/api/v1/sales-order-lines/{sales_order_id}/{line_no}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R11 | 退货记录 | `/api/v1/returns` | `/api/v1/returns/{return_id}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R12 | 运输任务摘要 | `/api/v1/transport-task-summaries` | `/api/v1/transport-task-summaries/{task_id}` | 园区管理员；企业管理员仅授权任务 |
| API-E01-R13 | 运输资源 | `/api/v1/transport-resources` | `/api/v1/transport-resources/{driver_id}/{vehicle_id}` | `park_admin` |
| API-E01-R14 | 冻库记录 | `/api/v1/freezer-records` | `/api/v1/freezer-records/{freezer_id}/{recorded_at}` | 园区管理员；企业管理员仅自身企业记录 |
| API-E01-R15 | 预订单 | `/api/v1/preorders` | `/api/v1/preorders/{preorder_id}` | 园区管理员；企业管理员仅授权企业数据 |
| API-E01-R16 | 采购需求 | `/api/v1/procurement-demands` | `/api/v1/procurement-demands/{demand_id}` | 园区管理员；企业管理员仅自身企业 |
| API-E01-R17 | 供应商报价 | `/api/v1/supplier-quotes` | `/api/v1/supplier-quotes/{supplier_id}/{material_id}/{tier_id}` | `park_admin` |
| API-E01-R18 | 政策记录 | `/api/v1/policies` | `/api/v1/policies/{policy_id}` | `park_admin` |

资源字段、必填性、单位、枚举和业务键以 [`web-import-template-v0.1.xlsx`](web-import-template-v0.1.xlsx) 的“字段字典”“枚举字典”“业务键字典”为准。

### 4.2 推荐的通用查询参数

| 参数 | 说明 |
|---|---|
| `page`、`page_size` | 分页 |
| `keyword` | 名称或编号模糊查询；不得用于敏感字段全文搜索 |
| `status` | 状态筛选 |
| `enterprise_id` | 园区管理员可指定；企业管理员只能使用授权值 |
| `start_at`、`end_at` | 带时区的时间范围 |
| `sort_by` | 仅允许接口白名单字段 |
| `sort_order` | `asc` 或 `desc` |

### 4.3 E01 看板和分析

| 编号 | 方法 | 路径 | 用途 | 主要输出 |
|---|---|---|---|---|
| API-E01-D01 | `GET` | `/api/v1/dashboard/overview` | 园区或企业协同总览 | 企业数、生产、库存、预订单、运输任务和冻库摘要 |
| API-E01-D02 | `GET` | `/api/v1/dashboard/capacity` | 查看企业产能余量 | `capacity_remaining`、`over_capacity`、单位、`data_cutoff` |
| API-E01-D03 | `GET` | `/api/v1/dashboard/inventory` | 企业库存汇总 | 当前库存、入库、出库、盘点差异 |
| API-E01-D04 | `GET` | `/api/v1/dashboard/sales` | 销售和退货摘要 | 销售额、数量、订单数、退货额和趋势 |
| API-E01-D05 | `GET` | `/api/v1/dashboard/preorders` | 合作方预订单汇总 | 合作方、品类、数量和要求时间 |
| API-E01-D06 | `GET` | `/api/v1/dashboard/transport` | 网页运输计划摘要 | 任务安排状态和司机/车辆确认结果，不含小程序执行数据 |
| API-E01-D07 | `GET` | `/api/v1/dashboard/freezers` | 冻库使用情况 | 冻货 kg、使用/总/可用 m3、使用率、超量标记 |
| API-E01-D08 | `GET` | `/api/v1/dashboard/production-progress` | 生产进度 | 计划量、合格完成量、进度和异常标记 |

### 4.4 B01 计算和建议

计算接口不伪造缺失数据；缺输入返回 `DATA_MISSING`，缺规则返回 `RULE_MISSING`，非法输入返回 `INVALID`。

| 编号 | 方法 | 路径 | 对应计算 | 用途 |
|---|---|---|---|---|
| API-E01-C01 | `GET` | `/api/v1/analytics/material-demand` | CALC-002 | 查看下一周共性原料需求和计算依据 |
| API-E01-C02 | `POST` | `/api/v1/procurements/aggregate-preview` | CALC-003 | 汇总企业需求、筛选可供货报价并预览企业分配；不自动中标 |
| API-E01-C03 | `POST` | `/api/v1/transport-matches/preview` | CALC-004 | 按起终点、时间、容量、温区、司机在岗状态给出候选 |
| API-E01-C04 | `POST` | `/api/v1/routes/estimate` | CALC-005 | 调用地图服务返回路线、距离、预计时长和更新时间 |
| API-E01-C05 | `GET` | `/api/v1/freezers/summary` | CALC-006 | 计算可用容量、使用率和超量标记；kg 不与 m3 相减 |
| API-E01-C06 | `POST` | `/api/v1/policies/match` | CALC-007 | 按企业条件和标签返回符合、待补充、不符合及理由 |
| API-E01-C07 | `GET` | `/api/v1/production/progress` | CALC-011 | 返回生产计划/订单进度和缺失字段 |

## 5. E02 数字化大屏公开接口

E02 路径均为公开只读 `GET`，允许缓存 30 秒。所有响应必须包含 `data_cutoff`，且不得包含联系人、电话、详细地址、司机资料或实时位置。

| 编号 | 方法 | 路径 | 用途 | 主要输出 |
|---|---|---|---|---|
| API-E02-001 | `GET` | `/api/v1/public/dashboard/overview` | 大屏一次加载的聚合总览 | 产能、预订单和网页运输安排摘要 |
| API-E02-002 | `GET` | `/api/v1/public/dashboard/capacity` | 展示园区企业产能余量 | 企业脱敏名称或展示名、品类、余量、单位、统计时刻 |
| API-E02-003 | `GET` | `/api/v1/public/dashboard/preorders` | 展示合作方预订单量 | 合作方展示名、品类、数量、单位、要求时间区间 |
| API-E02-004 | `GET` | `/api/v1/public/dashboard/transport` | 展示网页运输任务安排摘要 | `task_id`、脱敏状态、计划时间；不含司机、地址、位置或小程序执行状态 |

E02 可使用查询参数 `park_id`、`start_at`、`end_at`；后端必须限制到可公开的园区和时间范围。

E02 精确字段白名单如下；未列出的字段一律不得返回：

| 接口 | `data` 允许字段 |
|---|---|
| `public/dashboard/overview` | `park_id`、`enterprise_count`、`capacity_remaining_total`、`capacity_unit`、`preorder_quantity_total`、`preorder_unit`、`transport_task_counts` |
| `public/dashboard/capacity` | 数组项仅含 `enterprise_display_name`、`category`、`capacity_remaining`、`unit`、`statistic_at` |
| `public/dashboard/preorders` | 数组项仅含 `partner_display_name`、`category`、`quantity`、`unit`、`required_start_at`、`required_end_at` |
| `public/dashboard/transport` | 数组项仅含 `task_id`、`status`、`planned_depart_at`、`planned_arrive_at` |

统一外壳字段 `status`、`code`、`errors`、`trace_id`、`data_cutoff` 不受上述 `data` 白名单限制。E02 schema 在 OpenAPI 中均设置 `additionalProperties: false`。

## 6. HTTP 状态和稳定错误码

| HTTP | `code` | 前端处理建议 |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | 标记字段或查询参数错误 |
| 401 | `UNAUTHENTICATED` | 尝试刷新令牌；仍失败则回登录页 |
| 403 | `FORBIDDEN` | 隐藏操作并提示无权限，不重试 |
| 404 | `NOT_FOUND` | 提示对象不存在或已不在授权范围 |
| 409 | `IDEMPOTENCY_CONFLICT` | 停止重试，展示冲突信息 |
| 409 | `VERSION_CONFLICT` | 重新获取对象，提示用户合并或重试 |
| 422 | `DATA_MISSING` | 展示缺失字段，不显示伪造数值 |
| 422 | `RULE_MISSING` | 展示缺失规则，不使用前端默认值 |
| 422 | `INVALID` | 展示业务约束错误 |
| 502 | `UPSTREAM_ERROR` | 提示地图等上游服务暂不可用，可人工重试 |

错误项结构：

```json
{
  "field_key": "source_updated_at",
  "error_code": "VALIDATION_ERROR",
  "message": "时间必须包含时区",
  "sheet_name": "企业库存",
  "row_number": 12
}
```

`sheet_name` 和 `row_number` 仅在文件导入错误中出现。

## 7. 前端联调顺序

1. 先接入 `auth/me`、`meta/dictionaries` 和统一错误处理。
2. 使用资源列表接口完成 E01 页面 Mock；写操作统一携带事件外壳和 `object_version`。
3. 接入导入预检、错误列表、确认写库三步交互。
4. 接入 E01 看板和七类 B01 计算接口。
5. E02 只调用 `/public/dashboard/*`，不得复用 E01 详情接口获取敏感数据。

前端 Mock 文件覆盖登录、E01 资源列表、导入成功/失败、E01 总览/计算，以及四个 E02 公开接口。Mock 只用于页面开发，真实联调时以 OpenAPI 和后端响应为准。

## 8. 需求来源映射

| 接口组 | 主要需求 |
|---|---|
| E01 数据接入和资源维护 | REQ-001、REQ-003、REQ-015、REQ-028、REQ-034、REQ-042 |
| E01 看板 | REQ-002、REQ-007、REQ-029、REQ-033 |
| 原料需求和集中采购 | REQ-004、REQ-005、REQ-030、REQ-031 |
| 车辆筛选和路线建议 | REQ-006、REQ-008、REQ-032 |
| E02 公开大屏 | REQ-009、REQ-010、REQ-011 |

主要依据：

- `raw/ori_materials/用户补充意见及确认-2026-07-22.md`
- `raw/modeling-lite/01-需求层/各端需求清单.md`
- `raw/modeling-quality/01-数据字典.md`
- `raw/modeling-quality/02-接口字段约定.md`
- `raw/modeling-quality/03-计算规则说明.md`
- `backend/web-import-template-v0.1.xlsx`
