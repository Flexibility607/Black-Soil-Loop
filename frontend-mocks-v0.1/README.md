# E01 / E02 前端 Mock v0.1

这些 JSON 用于后端实现前的页面开发和状态展示。统一响应外壳、字段类型和接口路径以 `../openapi-v0.1.json` 为准，批量导入字段以 `../web-import-template-v0.1.xlsx` 为准。

## 文件对应关系

| 文件 | 对应场景 |
|---|---|
| `auth-login-success.json` | E01 登录成功 |
| `e01-enterprises-list.json` | E01 企业资源分页列表 |
| `import-precheck-success.json` | XLSX 预检通过，等待确认 |
| `import-precheck-error.json` | XLSX 预检失败及行级错误 |
| `e01-dashboard-overview.json` | E01 总览看板 |
| `e01-calculation-material-demand.json` | E01 原料需求计算 |
| `e02-public-overview.json` | E02 公开总览 |
| `e02-public-capacity.json` | E02 公开产能 |
| `e02-public-preorders.json` | E02 公开预订单 |
| `e02-public-transport.json` | E02 公开运输安排 |

## 前端使用约束

1. 开发基础地址暂定 `http://localhost:8000/api/v1`，建议通过前端环境变量覆盖。
2. E01 请求除登录、刷新外携带 `Authorization: Bearer <access_token>`。
3. E02 只访问 `/public/dashboard/*`；不要调用 E01 详情接口拼接大屏。
4. `PATCH` 必须把当前 `object_version` 放在事件外壳中，`payload` 只放发生变化的字段。
5. 导入页面按 `UPLOADED → PRECHECKING → READY_TO_CONFIRM → IMPORTING → COMPLETED` 展示正常流程，并处理失败和过期终态。
6. Mock 中的姓名、电话和地址只用于 E01 授权页面；四个 E02 Mock 不含敏感字段。

