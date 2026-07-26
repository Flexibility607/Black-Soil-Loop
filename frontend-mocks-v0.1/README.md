# E01 / E02 前端 Mock v0.1

这些 JSON 用于后端实现前的页面开发和状态展示。统一响应外壳、字段类型和接口路径以 `../openapi-v0.1.json` 为准，批量导入字段以 `../web-import-template-v0.1.xlsx` 为准。

## 文件对应关系

| 文件 | 对应场景 |
|---|---|
| `auth-login-success.json` | E01 登录成功 |
| `e01-resource-rows.json` | E01/B01 主数据、生产、库存、销售、冻库、运输等资源的丰富演示列表 |
| `e01-enterprises-list.json` | 旧版企业列表兼容样例；当前静态页从 `e01-resource-rows.json` 读取企业列表 |
| `import-precheck-success.json` | XLSX 预检通过，等待确认 |
| `import-precheck-error.json` | XLSX 预检失败及行级错误 |
| `e01-dashboard-overview.json` | E01 总览看板 |
| `e01-calculation-material-demand.json` | E01 原料需求计算 |
| `e02-public-overview-changchun.json` | E02 长春市服务范围公开总览、订单/销售/采购趋势 |
| `e02-public-capacity-changchun.json` | E02 长春市企业产能与占用率 |
| `e02-public-preorders-changchun.json` | E02 长春市及周边预订单 |
| `e02-public-transport-changchun.json` | E02 以长春市为中心的模拟运输路径、车辆与异常状态 |
| `e02-public-policies-changchun.json` | E02 长春市服务场景政策词条（演示来源） |
| `e02-public-news-changchun.json` | E02 长春市服务场景园区动态（演示来源） |

## 前端使用约束

1. 开发基础地址暂定 `http://localhost:8000/api/v1`，建议通过前端环境变量覆盖。
2. E01 请求除登录、刷新外携带 `Authorization: Bearer <access_token>`。
3. E02 只访问 `/public/dashboard/*`；不要调用 E01 详情接口拼接大屏。
4. `PATCH` 必须把当前 `object_version` 放在事件外壳中，`payload` 只放发生变化的字段。
5. 导入页面按 `UPLOADED → PRECHECKING → READY_TO_CONFIRM → IMPORTING → COMPLETED` 展示正常流程，并处理失败和过期终态。
6. Mock 中的姓名、电话和地址只用于 E01 授权页面；五个 E02 Mock 不含敏感字段。运输路径点、政策来源和遥测数据属于演示数据时必须保持明确标注。
7. E02 当前使用长春市服务范围数据集：12 家企业、12 条产能、12 条预订单、10 条运输任务、8 条政策和 6 条园区动态；地图中心为新安食品产业园，节点覆盖长春新区、宽城区、绿园区、双阳区、九台区、农安县、德惠市、榆树市、公主岭市等，数据均标记为 `DEMO_SIMULATION`。
8. E01/B01 丰富演示数据集中在 `e01-resource-rows.json`：企业 12 条、生产计划 12 条、库存 15 条、运输资源 14 条；其他业务资源均补到 12 条，企业标签 24 条，园区保留 3 条合理规模数据。全部记录标记为 `DEMO_SIMULATION`。
