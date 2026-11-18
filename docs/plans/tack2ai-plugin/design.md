# 源点动力影策插件设计

输入：requirements.md；本机网关的 router/openai_compat_router.go、service/openai_video_request.go、service/openai_video_references.go、controller/openai_video_documentation.go，以及图片/音频路由。源码不代表这些改动已在目标网关部署。

## 边界与决策
- DD-01（AC-01、AC-06）：新增独立插件目录和安装包，使用 yingce.plugin/v2，只用现有声明式能力，不改网关或宿主生产逻辑。保留当前工作区的其他任务改动；基线和原始资料存本地忽略目录。
- DD-02（AC-02）：tack2ai-chat 复用现有 Chat Completions、Agent 及宿主 SSE 线格式，不新增 Responses 适配。
- DD-03（AC-03）：tack2ai-image 根据参考图切换 JSON 生成/multipart 编辑，解析完整 data[] 的 URL/Base64；tack2ai-audio 使用 /v1/audio/speech 二进制返回。仅映射通用字段，实际模型能力另配。
- DD-04（AC-04）：tack2ai-video 使用 OpenAI JSON 编码，不发送 X-TD 头。非空 prompt 和固定时长 seconds；size 支持本网关认可的比例/像素尺寸，非像素 size 可附带 resolution_name。单个默认/首帧图片用 input_reference，其他参考用本网关公开的 references 扩展，保持角色、数量及顺序。
- DD-05（AC-05）：视频通过 result 端点鉴权下载，不把 metadata 中可能需鉴权的 URL 当公开成片。分离式回查和恢复不重复 create；不声明通用取消或自动重试创建。unknown 保持待查，无媒体或 HTTP 失败向上抛出。
- DD-06（AC-05）：视频不猜测模型专用音频/水印参数名，宿主通用开关保持关闭；明确开启时拒绝静默忽略，模型扩展只从 tack2ai-video.metadata 传递。第一版禁止 draft 草稿。所有凭据由渠道保存和宿主注入，不进入包。

## 验证与门禁
使用真实 ZIP 解析、安装启停与 HTTP 执行器的最小专项验证；上游为本地模拟服务，不接网关数据库或收费模型。需求/设计/计划门禁通过后实施，独立只读评审后交付。已有工作区非干净，不启用自动化开发或 Git 提交流程；只手工修改本轮限定文件。

## 实施状态
- 已完成：DD-01 至 DD-06；未修改网关或宿主生产逻辑，专项检查及独立静态评审通过。
- 未完成：无（本次设计范围内）。
- TodoList：真实模型和浏览器安装后验收；本次未运行，后续须另获收费授权，以目标部署的实际结果为验收依据。
