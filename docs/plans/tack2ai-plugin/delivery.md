# 源点动力 OpenAI 通用插件交付

## 当前工作区：目录接入版 1.0.0

当前插件与影策后台一起更新，版本仍为 `1.0.0`。范围、制品摘要、验证与回退说明见 [统一模型接入交付](catalog-delivery.md)。

## 1.0.1 说明调整包（历史归档）

历史分发包 30,582 字节，SHA256：`4043ff31bbdb207ceed6bb93847db4ffbedec08d26cb56e14bce4e58fab9ab04`；不是当前工作区安装包。

- 仅增加包内面向普通用户的个人渠道操作说明，重新嵌入文档。去掉版本和嵌入文档后，新旧 Manifest 逐字段一致；四个调用协议不变。
- 宿主不提供插件自行写入个人渠道的接口。管理员上传并开放插件、允许「自定义渠道」，用户在「设置 → 个人渠道」配置自己拥有的 Key。没有新增宿主 UI、服务商目录条目或线上部署。先前宿主快捷入口的本轮改动已撤回并本机归档。
- ZIP 完整性、成员与源文件逐字节比对、`go test ./internal/protocol ./internal/app -run '^(TestTack2AI|TestOfficialProtocolPackagesAreSelfContainedDeclarativePlugins)' -count=1 -v` 均通过。未使用真实 Key 或执行付费生成。
- 原始 1.0.0 包、源码和专项原始日志备份在 Git 忽略的 `.local/cache/tack2ai-package-only.mgENsY/`；需要回到旧版时，使用原包重新上传，或在工作区恢复原包及对应源码。

## 1.0.0 原始交付（历史记录）

已生成 `plugin-packages/tack2ai.yingce-plugin`（29,363 字节），版本 1.0.0，内含根 Manifest、README 和完整接口合同。一个包提供 `tack2ai-chat`、`tack2ai-image`、`tack2ai-video`、`tack2ai-audio` 四个 Provider；不使用 TD 专用协议或模型系列专用适配，不修改网关或宿主生产代码。

SHA256：`16f4c3fba53bad6d35442809b5b2b23bc97c945f62005552d24a2f4e36e83315`。

## 安装

影策插件中心上传安装包 → 管理员开放并启用 → 渠道填源点动力地址和 API Key → 为实际可用模型选择对应调用协议，按网关能力配置限制与价格。详细步骤及参数在包内 README 和 docs/interface.md。

默认地址为 `https://ai.tack2ai.cn`，也可配置自己的网关。文字使用 Chat Completions；语音使用 TTS，默认 alloy 音色不代表全部模型支持，须选模型的真实音色。视频复杂参考和 resolution_name 使用本网关已经存在的 OpenAI 兼容扩展，不宣称是 OpenAI 官方通用字段。

## 修改范围与事实来源

- 新增插件目录、安装包、协议专项测试、安装/HTTP 执行器专项测试、本组交付文档；features/pending-test 仅增加本插件段落。
- 网关只读核对 OpenAI 路由、视频编码/参考归一化、图片/音频合同和视频结果交付；未读真实凭据，未更改网关文件、配置、数据库或部署。
- 影策 Git 基线 `d4dd8aa342c3145d463a204becc6b5d08b8e861e`；开始时已有其他任务修改，全部保留，没有提交、推送、部署或启动开发服务。

## 实际验证

环境：Go 1.25.8、Bun 1.4.4；使用项目已有依赖和命令，无新增依赖。

| 命令 / 检查 | 结果 |
| --- | --- |
| `node plugin-packages/embed-documentation.mjs tack2ai` | 仅嵌入本插件完整合同，退出码 0 |
| 本目录文件排序后 `zip -X`，按现有打包布局生成单包 | 成功，退出码 0；没有重建其他包 |
| `unzip -t plugin-packages/tack2ai.yingce-plugin` | 三个文件完整性通过，退出码 0 |
| `cd backend && go test ./internal/protocol -run 'TestTack2AI\|TestOfficialProtocolPackagesAreSelfContainedDeclarativePlugins' -count=1 -v` | 通过，退出码 0 |
| `cd backend && go test ./internal/app -run TestTack2AI -count=1 -v` | 通过，退出码 0 |
| ZIP 各成员与源码逐字节比较、SHA256、Provider 清单检查 | 通过；真实包解析和上传生命周期另由专项覆盖 |
| `git diff --check` | 通过，退出码 0 |
| 独立只读静态评审 | pass，见 review.md |

协议专项覆盖四类映射、错误/空返回、0/false、Agent 响应、图片单/多图编辑、视频单图/显式参考/混合顺序/像素尺寸/非法输入/状态。运行时专项覆盖真实上传、启停、重载、卸载、三个同步模态、文字 SSE、multipart 编辑、HTTP 失败、视频分离式提交及原任务恢复下载；上游是本地模拟服务，测试媒体为明确的固定 fixture，不代表真实模型或播放器验收。

中间失败均保留：测试接口名称/输入类型与当前宿主不符已修正；单图空 role 的表达式匹配问题已修复；multipart 错误分支的模拟服务顺序已修正。没有把安装成功或模拟响应当作真实收费成功。

原始命令、输出、退出码、源码原始摘要与文档备份在本机已忽略的 `.local/cache/tack2ai-plugin/`：`protocol-test-initial.log`、`protocol-test-second.log`、`protocol-test.log`、`runtime-test-initial.log`、`runtime-test.log`、`runtime-test-final.log`、`artifact-verification.json`、`SHA256SUMS`。此前被用户中止的 TD 草案另存本地，不进入安装包。

## 未验证与恢复

未执行浏览器安装点击、真实 API Key/模型/余额验证、收费生成、公网参考素材可达性、播放器和真实账单核对；默认开发环境围栏没有解除。语音以网关非 2xx 表示错误为合同，不支持 HTTP 200 JSON 业务错误作为成功音频。未新增音乐、转写、音色克隆、Responses 专用入口、通用视频取消、拼车管理、草稿转正式和能力/价格自动同步。

需要撤销接入时先停用插件；确认在途任务后再卸载，不删除已保存素材、网关任务或账单。停止本地等待不代表网关取消或退款。无需回滚网关；不要用 Git 全量回滚处理其他聊天改动。

## 实施状态

- 已完成：AC-01 至 AC-06、T-01 至 T-05，本轮本地制品交付完成。
- 未完成：无（本轮范围内）。
- TodoList：用户安装后另行授权真实账号和收费模型验收，以实际生成、保存和账单为条件。
