# 腾讯 VOD 图片直连设计

- DD-01（AC-01）：新增独立声明式图片 Provider `tencent-vod-og`；复用腾讯 VOD 系统渠道、可信 SubAppId 与 TC3，只签固定 Action 和域名。宿主派生 OG 质量、图片大小、参考素材和可选蒙版；禁止客户端自定义请求头、FileId 及未校验的地址。素材可使用现有资源层签发的链接或受限内嵌图片。
- DD-02（AC-01、AC-02）：`CreateAigcImageTask` → `DescribeTaskDetail`，按源点动力的 `ExtInfo.AdditionalParameters` 双层 JSON 与输出大小契约；明确成功才提取文件，保留原任务 ID 和临时资源持久化逻辑。
- DD-03（AC-03、AC-04）：定价单位和档位必须与证据匹配，用管理 API 保存、回读并不付费地验证；开发实例若未加载新插件不写该直连模型。纯本地代码，本轮不发布或更改线上服务。

按张计费边界：宿主按次预留固定数量 1，首版禁止一个任务请求多张，也不把部分结果按请求数量收费。
