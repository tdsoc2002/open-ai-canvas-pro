# 腾讯云 VOD VS 直连设计

- DD-01（AC-01）：使用现有声明式插件、TC3 签名、管理端渠道与定价，宿主仅做可信 AppID 和请求参数投影。AppID 仅从已授权系统渠道读取，保存在现有渠道设置中，入请求体而非透传头。固定 HTTPS 官方根地址，禁止客户覆盖 Action 或供应链设置。
- DD-02（AC-02）：参考源点动力的 `relay/modelcontract/tencent_video.go`、`relay/channel/task/tencentvodvs/{input,request,result,signing}.go`。只接受已由乐见资源层授权、腾讯可访问的 HTTP(S) 素材；不直接信任裸云点播 FileId 或 `asset://`。
- DD-03（AC-03）：固定 `CreateAigcVideoTask` 和 `DescribeTaskDetail`，临时成果立即由宿主持久化；业务错误与协议异常保持失败，主文件迟到继续回查。无上游取消或安全提交重试保证。
- DD-04（AC-04）：不更改数据库结构，不安装真实凭据；网关售卖与底层实际计费不是同一口径，宿主按其已配置价格档处理，不制造腾讯返回的用量。
