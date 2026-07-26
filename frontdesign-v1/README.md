# frontdesign-v1

这是 B01 网页端的无构建依赖前端：E01 管理台 + E02 公开大屏。
范围不包含 B02 小程序。

## 文件说明

- `index.html`：E01/E02 页面结构和导入、计算交互区。
- `styles.css`：响应式页面样式。
- `api.js`：Mock/Live API 客户端、JWT 保存/刷新和导入调用。
- `scripts.js`：页面状态、资源列表、看板和大屏渲染。

## 页面结构

- 仪表盘 Overview
- 企业管理
- 生产与订单
- 库存与冻库
- 运输任务
- 导入管理
- 计算与建议
- E02 公开大屏

总览指标支持鼠标悬停、键盘聚焦和点击查看明细；E02 使用独立的 1920×1080 设计画布，按浏览器视口等比缩放，包含园区企业产能监控、订单量/销售额两张独立趋势图、政策与园区动态滚动、长春市 OpenStreetMap 2D 平面地图、带模拟折线路径的车辆位置和机器人消息气泡。地图支持放大、缩小、重置视角和鼠标拖拽平移，点击车辆可查看路线进度和异常详情。进入 E02 后可点击“全屏”，点击“返回 E01”恢复管理后台。

## 使用方式

建议使用本地静态服务器启动页面；直接用 `file://` 打开时，浏览器可能阻止读取 Mock JSON。

示例（在公开仓库根目录运行）：
```bash
python -m http.server 8080 --directory .
```
然后访问 `http://localhost:8080/frontdesign-v1/`。这样前端才能按相对路径读取仓库根目录的 `frontend-mocks-v0.1/`，也能保持与后端的 8080 CORS 配置一致。

## Mock / Live 切换

- 页面右上角有 `Mock 数据` 开关，默认开启。关闭后前端请求 `http://localhost:8000/api/v1`，并自动附带 E01 JWT。
- Live 模式点击 `E01 登录`，使用后端账号登录；401 会尝试 refresh，失败后回到登录提示。
- 默认 Mock 文件来自 `../frontend-mocks-v0.1/`，与公开仓库目录结构一致。
- E02 Mock 提供 12 家脱敏企业、12 条产能、12 条预订单、10 条运输任务、10 条带 `route_points`/`route_progress_percent` 的模拟路线、8 条政策、6 条园区动态和连续 7 日趋势；页面明确标注 `DEMO_SIMULATION`，且 Mock 请求禁用缓存，便于现场稳定刷新。

## 已接入的接口示例

- E01 认证：`POST /api/v1/auth/login`、`GET /api/v1/auth/me`、`POST /api/v1/auth/refresh`、`POST /api/v1/auth/logout`
- E01 看板：`GET /api/v1/dashboard/overview`，并展示订单、销售、企业明细、库存预警和运输监控提示
- E01/B01 资源列表：主数据、生产、库存/销售/退货、运输/冻库等集合接口
- B01 导入：`POST /api/v1/imports/precheck`、`POST /api/v1/imports/{batch_id}/confirm`；模板当前包含 19 张业务工作表（另有控制工作表）
- B01 计算：物料需求、历史采购加权推荐、固定规则运输匹配和路线估算等接口；结果会保留计算快照
- 业务操作：产能、库存下限审批、库存预警确认、运输遥测、采购历史
- E02：`GET /api/v1/public/dashboard/overview`、`capacity`、`preorders`、`transport`、`policies`、`news`

Live 模式下后端会话空闲超过 30 分钟要求重新登录；refresh 不能绕过该限制。政策、园区动态、地图路径和车辆遥测在当前演示阶段可使用明确标注的示例数据，不能当作真实外部服务数据。地图底图来自公开 OpenStreetMap 图块，页面保留 `© OpenStreetMap contributors` 署名；路线折点和车辆进度是长春市范围内的演示数据。

E02 的缩放基准是 16:9 的 `1920×1080`。它不会改变 E01 的响应式布局；在 1366×768 等常见分辨率下会整体等比缩放，不产生页面滚动。

## 提交 PR 与联调建议

1. 先启动 `backend` 的 FastAPI 服务，再启动本目录的静态服务器。
2. 后端默认允许 `localhost:8080` 和 `127.0.0.1:8080` 的开发来源，不要在生产环境使用 `*` 放开 CORS。
3. 前端只负责调用契约；导入仍需经过预检和 E01 明确确认，不能把上传成功直接当作写库完成。

