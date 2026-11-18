# 腾讯云 VOD OG 接口

使用 TC3，`POST /`，依次执行 `CreateAigcImageTask`、`DescribeTaskDetail`，服务地址固定为 `vod.tencentcloudapi.com`。图片版本遵循源点动力腾讯 OG 映射：Image 2 使用 `image2_{quality}`，Image 2.5 使用 `image2.5_{flare|sunburst}_{quality}`。Image 2 仅支持 low、medium、high；Image 2.5 另支持 xhigh、max。默认 medium。

`size` 限于源点动力定价使用的 45 个具体像素尺寸；原生 `OutputConfig.Resolution` 按腾讯面积规则投影，不作为乐见售价档来源。支持文生图、参考图、透明背景和蒙版；结果 PNG。参考以平台资源层授权的链接或受限内嵌图片传递，不接受裸点播文件 ID。每个任务只生成一张以匹配宿主按张计费，输入文件最多八张（含蒙版）。

[创建 AIGC 生图任务](https://cloud.tencent.com/document/api/266/126240) · [查询任务详情](https://cloud.tencent.com/document/api/266/33431)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "tencent-vod-og",
  "name": "腾讯云 VOD OG 直连",
  "version": "1.0.0",
  "author": "乐见画布",
  "description": "管理员配置腾讯云点播，直连 OG 图片生成与编辑，不经过源点动力。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "runtime": {
    "backend": "declarative"
  },
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "SecretId",
        "required": true
      },
      {
        "name": "secretKey",
        "type": "secret",
        "label": "SecretKey",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "tencent-vod-og",
        "label": "腾讯云 VOD OG 直连",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://vod.tencentcloudapi.com",
        "auth": {
          "type": "tc3",
          "field": "apiKey",
          "secretField": "secretKey",
          "service": "vod"
        },
        "requiresPublicMediaUrls": false,
        "detachedPolling": true,
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "ModelVersion",
            "description": "原生 Image 2、2.5 Flare / Sunburst 版本。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "Prompt",
            "description": "无参考图片时必填。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "FileInfos",
            "description": "参考图和蒙版。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "OutputConfig.OutputImageCount",
            "description": "每任务一张，与乐见按张计费边界一致。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "ModelVersion",
            "description": "图像质量。"
          },
          {
            "name": "size",
            "type": "string",
            "required": true,
            "mapping": "ExtInfo.AdditionalParameters.size",
            "description": "源点动力定价清单中的像素预设。"
          },
          {
            "name": "imageResolution",
            "type": "string",
            "required": false,
            "mapping": "price selector",
            "description": "1K、2K、4K 售价档。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/",
          "originPath": true,
          "contentType": "application/json",
          "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "X-TC-Action": "CreateAigcImageTask",
            "X-TC-Version": "2018-07-17",
            "X-TC-Region": "ap-guangzhou"
          },
          "body": {
            "$ref": "request.extra.tencentVod"
          }
        },
        "poll": {
          "method": "POST",
          "path": "/",
          "originPath": true,
          "contentType": "application/json",
          "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "X-TC-Action": "DescribeTaskDetail",
            "X-TC-Version": "2018-07-17",
            "X-TC-Region": "ap-guangzhou"
          },
          "body": {
            "TaskId": {
              "$ref": "taskId"
            },
            "SubAppId": {
              "$ref": "request.extra.tencentVodAppId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.Response.TaskId"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$and": [
                      {
                        "$ref": "taskId"
                      },
                      {
                        "$in": [
                          {
                            "$ref": "response.Response.Error.Code"
                          },
                          [
                            "RequestLimitExceeded",
                            "InternalError",
                            "ServiceUnavailable",
                            "RequestTimeout"
                          ]
                        ]
                      }
                    ]
                  },
                  "then": "processing"
                },
                {
                  "when": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$upper": {
                              "$ref": "response.Response.AigcImageTask.Status"
                            }
                          },
                          "FINISH"
                        ]
                      },
                      {
                        "$in": [
                          {
                            "$ref": "response.Response.AigcImageTask.ErrCode"
                          },
                          [
                            null,
                            0
                          ]
                        ]
                      },
                      {
                        "$not": {
                          "$ref": "response.Response.AigcImageTask.ErrCodeExt"
                        }
                      },
                      {
                        "$not": {
                          "$ref": "response.Response.Error"
                        }
                      }
                    ]
                  },
                  "then": "succeeded"
                },
                {
                  "when": {
                    "$in": [
                      {
                        "$upper": {
                          "$ref": "response.Response.AigcImageTask.Status"
                        }
                      },
                      [
                        "PROCESSING",
                        "WAITING",
                        "PENDING"
                      ]
                    ]
                  },
                  "then": "processing"
                },
                {
                  "when": {
                    "$and": [
                      {
                        "$not": {
                          "$ref": "response.Response.Error"
                        }
                      },
                      {
                        "$ref": "response.Response.TaskId"
                      }
                    ]
                  },
                  "then": "pending"
                }
              ],
              "default": "failed"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.Response.Error.Message"
              },
              {
                "$ref": "response.Response.AigcImageTask.Message"
              },
              {
                "$ref": "response.Response.AigcImageTask.ErrCodeExt"
              },
              "腾讯云点播未返回成功的图片任务"
            ]
          },
          "errorPaths": [
            "Response.AigcImageTask.ErrCode",
            "Response.AigcImageTask.ErrCodeExt"
          ],
          "images": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$eq": [
                      {
                        "$upper": {
                          "$ref": "response.Response.AigcImageTask.Status"
                        }
                      },
                      "FINISH"
                    ]
                  },
                  {
                    "$in": [
                      {
                        "$ref": "response.Response.AigcImageTask.ErrCode"
                      },
                      [
                        null,
                        0
                      ]
                    ]
                  },
                  {
                    "$not": {
                      "$ref": "response.Response.AigcImageTask.ErrCodeExt"
                    }
                  },
                  {
                    "$not": {
                      "$ref": "response.Response.Error"
                    }
                  }
                ]
              },
              "then": {
                "$map": {
                  "from": {
                    "$ref": "response.Response.AigcImageTask.Output.FileInfos"
                  },
                  "as": "file",
                  "in": {
                    "$ref": "file.FileUrl"
                  }
                }
              }
            }
          },
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
