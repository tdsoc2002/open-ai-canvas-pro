# 源点动力 OpenAI 通用接口合同

## 插件身份与配置

- 插件 ID：`tack2ai`；版本：`1.0.0`；清单：`yingce.plugin/v2`。
- `apiKey`：必填 secret，由渠道保存，宿主以 `Authorization: Bearer ...` 注入；包中没有凭据。
- 默认地址：`https://ai.tack2ai.cn`。地址填站点根地址或 `/v1` 均使用宿主路径拼接规则；不包含查询参数密钥。
- 四个 Provider：`tack2ai-chat`、`tack2ai-image`、`tack2ai-video`、`tack2ai-audio`。均允许系统渠道、个人自定义渠道、画布、创作和 Agent 场景；实际权限由宿主控制。
- create 携带宿主稳定的 `Idempotency-Key` 和 `X-Canvas-Task-ID`，仅作为网关去重标识，不写入业务正文。不声明 `idempotentCreate`，不自动重试创建。
- 不发送 `X-TD-Contract`，不依赖供应商专用接口或宿主 `host:` 执行器。

## 文字：tack2ai-chat

`POST /v1/chat/completions`，JSON。

`model` 原样传递；`messages` 由宿主组合历史、当前 `prompt`、`instructions` 与参考素材。插件命名空间 `providerOptions.tack2ai-chat` 支持 `temperature`、`top_p`、`max_tokens`、`tools`、`tool_choice`、`response_format`、`stream`。宿主的 token 上限优先；`0`、`false` 不因 omitEmpty 被丢弃。

流式由宿主按 Chat Completions SSE 合同处理。Agent 使用同一端点，宿主完整 chatCompletion 请求经 `agent` 映射，解析 `tool_calls` 的 ID、函数名和参数。

响应：`choices[0].message.content` / `choices[0].text`、`reasoning_content`、`usage`；`error` 对象保持失败。普通文字请求没有正文时标为失败；Agent 工具调用由独立 Agent 响应映射处理，不伪造文本。

## 图片：tack2ai-image

- 无参考图：`POST /v1/images/generations`，JSON。
- 有参考图：`POST /v1/images/edits`，multipart；一张普通图为 `image`，多张为 `image[]`，mask 单独上传。不手动填写 boundary。
- 通用字段：`model`、非空 `prompt`、`n`、`size`、`quality`；默认单张。网关绝对数量上限 128，真实单次张数与参考上限另由模型能力限制。
- 像素合同保留宿主 `size`（绑定 `aspectRatio`、编码 `pixels`），网关只接收正整数 `宽x高` 或省略 `size`。档位合同显式启用 `imageResolution`（网关 `size`，原样发送）与独立 `aspectRatio`（网关 `aspect_ratio`），关闭原像素 `size`；两种编码不能混用。档位及比例默认不启用，也不按模型名称猜测。JSON 和 multipart 使用同一合同。
- `quality` 按模型配置，空值/auto 不强制提交。
- `providerOptions.tack2ai-image.response_format` 可显式设置网关支持的响应格式。不默认附加供应商私有字段或强迫使用未定价 quality=auto。
- 响应完整读取 `data[]`：`url` 或 `b64_json`，支持上游提供的 `output_format` / `mime_type` 提示。缺少提示的裸 Base64 按已有宿主默认 PNG 处理；若模型实际格式不同，应使用 URL 响应或由网关返回格式提示。
- URL 标为临时结果，宿主立即下载保存；空 `data`、错误对象及无可用媒体均不算成功。

## 视频：tack2ai-video

### 创建与字段

`POST /v1/videos`，JSON，使用 OpenAI 编码：

| 影策字段 | 网关字段 | 约束 |
| --- | --- | --- |
| `model` | `model` | 当前令牌可用模型，不猜测或替换模型 ID |
| `prompt` | `prompt` | 必须非空 |
| `duration` | `seconds` | 字符串整数，1–3600 秒，实际范围由模型决定；不使用 -1 |
| `aspectRatio` | `size` | 本网关支持比例或像素尺寸；空/auto/adaptive 不发送 |
| `resolution` | `resolution_name` | 本网关兼容扩展；size 是像素尺寸时不重复发送 |
| `images` | `input_reference` 或 `references` | 单张默认/首帧图使用 `{image_url: ...}`；明确普通参考图和复杂组合用 references |
| `videos` / `audios` | `references` | 本网关已支持的多模态扩展，非 OpenAI 官方字段 |
| 目录声明的模式和独立比例 | `mode` / `aspect_ratio` | 只由宿主按当前模型合同填写，手工配置无声明时保留原编码 |
| `providerOptions.tack2ai-video.metadata` | `metadata` | 仅当前模型目录允许的扩展参数，不覆盖核心字段 |

`references[]` 使用 `type=image/video/audio`、`role`、`url`，对全部素材按宿主顺序排序。图片角色支持 `first_frame`、`last_frame`、`reference_image`；视频/音频分别为 `reference_video`、`reference_audio`。不支持蒙版，不静默丢弃多余或非法角色。数量最多 128，仍受当前模型更严格的模式、体积和时长限制。

通用「出声」「水印」开关不映射到模型私有字段；明确开启会报错，而非静默忽略。按实际模型目录在 `metadata` 配置原始字段，例如部分模型接受 `generate_audio`、另一些接受 `audio`。参数错误由网关真实拒绝，插件不自动补虚构值。`draft=true` 被拒绝，避免误进入草稿收费流程。

### 查询、响应与下载

- 查询：`GET /v1/videos/{taskId}`。
- 下载：`GET /v1/videos/{taskId}/content`，宿主使用渠道 Bearer 鉴权，可处理二进制或受控重定向，随后保存资源。
- 创建与查询响应取 `id`、`status`、`error.message` 和 `usage`。查询保留原 taskId。
- `queued` → pending；`in_progress` → processing；`completed` → succeeded；`failed` → failed；`cancelled/canceled` → cancelled。`unknown`、未识别状态保持待查，绝不因 metadata 存在 URL 就当成功。
- 不把 `metadata.url` 当免鉴权媒体链接，完成后只走 `/content`，即使响应没有顶层 video_url 也可交付。
- 声明 detachedPolling：已受理后释放执行位，由现有宿主按 15 秒间隔回查，现有总等待上限 48 小时。恢复只查询原任务，不重提生成。
- 不声明通用 cancel；本网关 `/v1/videos/{id}` 没有通用 DELETE 合同，不冒充取消成功。影策停止本地等待不等于取消网关任务或退款。

## 语音：tack2ai-audio

`POST /v1/audio/speech`，JSON。

- `model` 原样传递，非空 `prompt` 映射 `input`。
- `request.extra.audioVoice` / 命名空间 `voice` → `voice`，无显式选择或目录默认值时省略，不代填 alloy。
- `audioFormat` / `response_format` → `response_format`；`audioSpeed` / `speed` → `speed`。模型声明默认格式时由宿主填充；没有有效值时省略，不在清单添加默认语速。
- `audioInstructions` / `instructions` → `instructions`，非空时发送。
- 手工配置仍可使用命名空间 `providerOptions.tack2ai-audio` 中已知字段。系统目录声明能力时，仅由宿主从已校验的请求及能力填写，任意扩展规格不能覆盖。
- 若目录声明 `metadata.references` 且宿主校验通过，普通图片和音频素材编码为 `metadata.references[]`，每项只填一个 `image_url`、`audio_url`、`image_data` 或 `audio_data`（内联值为裸 Base64）。最多一张图片或三段音频，实际数量按模型配置，不能混用或与音色同时提交；不支持视频和蒙版。
- 成功按 `binaryPayload` 接收音频字节并保存，不把响应当任务 ID 或 JSON URL；空载荷或非音频内容（包括 HTTP 200 的 JSON 错误）均由宿主拒绝。

## 来源与验证边界

接口依据源点动力现有的 OpenAI 兼容路由、图片合同、视频标准编码和参考素材归一化、语音路由；没有修改网关。模型可用性取决于部署版本及同一 API Key 的 `/v1/catalog/models`。管理员主动拉取并选择导入；插件不定期同步能力和价格，模型目录读取成功也不证明真实生成已成功。

本地专项验证使用真实影策包解析、安装运行时、声明式求值和 HTTP 执行器，配合本地模拟上游；不使用真实密钥、不连接网关数据库、不发起收费任务。真实账号、素材公网可达性、模型输出和账单需另行验收。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "tack2ai",
  "name": "源点动力",
  "version": "1.0.0",
  "author": "源点动力 / 影策",
  "description": "通过源点动力现有 OpenAI 通用协议生成文字、图片、视频和语音，不使用 TD 专用协议或修改网关逻辑。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "源点动力 API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "tack2ai-chat",
        "label": "源点动力文字",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://ai.tack2ai.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "provider message container",
            "description": "包含历史消息和当前用户输入。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "system/instructions",
            "description": "系统指令。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "核采样参数。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens/max_output_tokens",
            "description": "最大输出 token。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools/toolConfig",
            "description": "工具定义。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "工具选择策略。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format/text",
            "description": "结构化输出配置。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "流式开关；后台任务当前以最终响应归一。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "temperature": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-chat.temperature"
              }
            },
            "top_p": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-chat.top_p"
              }
            },
            "max_tokens": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.max_tokens"
                  },
                  {
                    "$ref": "request.providerOptions.tack2ai-chat.max_tokens"
                  }
                ]
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-chat.tools"
              }
            },
            "tool_choice": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-chat.tool_choice"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-chat.response_format"
              }
            },
            "stream": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-chat.stream"
              }
            }
          },
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            },
            "X-Canvas-Task-ID": {
              "$ref": "request.extra.idempotencyKey"
            }
          }
        },
        "agent": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "$ref": "request.extra.agent.chatCompletion"
              },
              {
                "model": {
                  "$ref": "request.model"
                }
              }
            ]
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$or": [
                  {
                    "$trim": {
                      "$ref": "response.choices.0.message.content"
                    }
                  },
                  {
                    "$trim": {
                      "$ref": "response.choices.0.text"
                    }
                  }
                ]
              },
              "then": "succeeded",
              "else": "failed"
            }
          },
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error"
          ],
          "messagePaths": [
            "error.message"
          ],
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              "源点动力未返回文字内容"
            ]
          }
        },
        "agentResponse": {
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "toolCallsPath": "choices.0.message.tool_calls",
          "toolCallIdPaths": [
            "id"
          ],
          "toolCallNamePaths": [
            "function.name"
          ],
          "toolCallArgumentsPaths": [
            "function.arguments"
          ]
        },
        "validations": [
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.model"
                  }
                },
                ""
              ]
            },
            "message": "源点动力模型 ID 不能为空"
          }
        ]
      },
      {
        "id": "tack2ai-image",
        "label": "源点动力图片",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://ai.tack2ai.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "画幅 / 尺寸",
            "type": "string",
            "binding": "aspectRatio",
            "encoding": "pixels",
            "pricing": true
          },
          {
            "name": "imageResolution",
            "label": "分辨率档位",
            "type": "string",
            "binding": "resolution",
            "pricing": true,
            "enabled": false
          },
          {
            "name": "aspectRatio",
            "label": "宽高比",
            "type": "string",
            "binding": "providerOptions.tack2ai-image.aspectRatio",
            "enabled": false
          },
          {
            "name": "quality",
            "label": "图片质量",
            "type": "string",
            "binding": "quality",
            "pricing": true
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 128,
            "step": 1,
            "default": 1
          }
        ],
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "request.images"
                    }
                  },
                  0
                ]
              },
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
            }
          },
          "contentType": "application/json",
          "contentTypeTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "request.images"
                    }
                  },
                  0
                ]
              },
              "then": "multipart/form-data",
              "else": "application/json"
            }
          },
          "files": [
            {
              "name": "image",
              "source": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "media",
                            "where": {
                              "$ne": [
                                {
                                  "$ref": "media.role"
                                },
                                "mask"
                              ]
                            }
                          }
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$ne": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
                        ]
                      }
                    }
                  },
                  "else": null
                }
              },
              "filename": "image.png"
            },
            {
              "name": "image[]",
              "source": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "media",
                            "where": {
                              "$ne": [
                                {
                                  "$ref": "media.role"
                                },
                                "mask"
                              ]
                            }
                          }
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$ne": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
                        ]
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            {
              "name": "mask",
              "source": {
                "$first": {
                  "$filter": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "where": {
                      "$eq": [
                        {
                          "$ref": "media.role"
                        },
                        "mask"
                      ]
                    }
                  }
                }
              },
              "filename": "mask.png"
            }
          ],
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$ref": "request.imageCount"
                      },
                      0
                    ]
                  },
                  "then": {
                    "$ref": "request.imageCount"
                  },
                  "else": 1
                }
              }
            },
            "size": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$ne": [
                      {
                        "$trim": {
                          "$ref": "request.providerOptions.tack2ai-image.aspectRatio"
                        }
                      },
                      ""
                    ]
                  },
                  "then": {
                    "$trim": {
                      "$ref": "request.resolution"
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.aspectRatio"
                              }
                            }
                          },
                          [
                            "",
                            "auto"
                          ]
                        ]
                      },
                      "then": null,
                      "else": {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      }
                    }
                  }
                }
              }
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$trim": {
                  "$ref": "request.providerOptions.tack2ai-image.aspectRatio"
                }
              }
            },
            "quality": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.quality"
                          }
                        }
                      },
                      [
                        "",
                        "auto"
                      ]
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.quality"
                  }
                }
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-image.response_format"
              }
            }
          },
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            },
            "X-Canvas-Task-ID": {
              "$ref": "request.extra.idempotencyKey"
            }
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "response.data"
                    }
                  },
                  0
                ]
              },
              "then": "succeeded",
              "else": "failed"
            }
          },
          "images": {
            "$ref": "response.data"
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error"
          ],
          "messagePaths": [
            "error.message"
          ],
          "resultEphemeral": true,
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              "源点动力未返回图片结果"
            ]
          }
        },
        "validations": [
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.model"
                  }
                },
                ""
              ]
            },
            "message": "源点动力模型 ID 不能为空"
          },
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.prompt"
                  }
                },
                ""
              ]
            },
            "message": "源点动力提示词不能为空"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.imageCount"
                    },
                    0
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.imageCount"
                    },
                    128
                  ]
                }
              ]
            },
            "message": "图片数量必须在 1–128 范围内（未指定时为 1），实际限制由模型能力决定"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$ne": [
                      {
                        "$trim": {
                          "$ref": "request.providerOptions.tack2ai-image.aspectRatio"
                        }
                      },
                      ""
                    ]
                  }
                },
                {
                  "$and": [
                    {
                      "$ne": [
                        {
                          "$trim": {
                            "$ref": "request.resolution"
                          }
                        },
                        ""
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$lower": {
                            "$trim": {
                              "$ref": "request.aspectRatio"
                            }
                          }
                        },
                        [
                          "",
                          "auto"
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "源点动力图片档位与独立宽高比必须搭配使用，不能与像素尺寸同时设置"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$trim": {
                        "$ref": "request.providerOptions.tack2ai-image.aspectRatio"
                      }
                    },
                    ""
                  ]
                },
                {
                  "$in": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      }
                    },
                    [
                      "",
                      "auto"
                    ]
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$split": [
                              {
                                "$trim": {
                                  "$ref": "request.aspectRatio"
                                }
                              },
                              "x"
                            ]
                          }
                        },
                        2
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$gt": [
                            {
                              "$toInt": {
                                "$first": {
                                  "$split": [
                                    {
                                      "$trim": {
                                        "$ref": "request.aspectRatio"
                                      }
                                    },
                                    "x"
                                  ]
                                }
                              }
                            },
                            0
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$toString": {
                                "$toInt": {
                                  "$first": {
                                    "$split": [
                                      {
                                        "$trim": {
                                          "$ref": "request.aspectRatio"
                                        }
                                      },
                                      "x"
                                    ]
                                  }
                                }
                              }
                            },
                            {
                              "$first": {
                                "$split": [
                                  {
                                    "$trim": {
                                      "$ref": "request.aspectRatio"
                                    }
                                  },
                                  "x"
                                ]
                              }
                            }
                          ]
                        }
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$gt": [
                            {
                              "$toInt": {
                                "$last": {
                                  "$split": [
                                    {
                                      "$trim": {
                                        "$ref": "request.aspectRatio"
                                      }
                                    },
                                    "x"
                                  ]
                                }
                              }
                            },
                            0
                          ]
                        },
                        {
                          "$eq": [
                            {
                              "$toString": {
                                "$toInt": {
                                  "$last": {
                                    "$split": [
                                      {
                                        "$trim": {
                                          "$ref": "request.aspectRatio"
                                        }
                                      },
                                      "x"
                                    ]
                                  }
                                }
                              }
                            },
                            {
                              "$last": {
                                "$split": [
                                  {
                                    "$trim": {
                                      "$ref": "request.aspectRatio"
                                    }
                                  },
                                  "x"
                                ]
                              }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "源点动力图片尺寸必须为正整数像素宽x高"
          }
        ]
      },
      {
        "id": "tack2ai-video",
        "label": "源点动力视频 · OpenAI",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://ai.tack2ai.cn",
        "requiresPublicMediaUrls": true,
        "detachedPolling": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "网关公开的 OpenAI 兼容视频模型 ID，原样传递。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "非空视频提示词。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "seconds",
            "description": "固定秒数，序列化为 OpenAI seconds 字符串，范围 1–3600，实际范围由模型决定。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "OpenAI size；本网关同时接受像素尺寸或比例。adaptive/auto 不提交。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution_name",
            "description": "本网关 OpenAI 兼容入口的分辨率扩展；size 已为像素尺寸时不重复发送。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "input_reference / references",
            "description": "单个默认/首帧图使用 input_reference；显式参考角色、多图及首尾帧使用本网关 references 扩展。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "references",
            "description": "本网关 OpenAI 兼容入口的参考视频扩展，保持素材全局顺序。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "references",
            "description": "本网关 OpenAI 兼容入口的参考音频扩展，保持素材全局顺序。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "metadata",
            "description": "tack2ai-video.metadata 只传递模型目录明确允许的 OpenAI 扩展；不覆盖核心字段，不支持 draft 草稿。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.model"
                  }
                },
                ""
              ]
            },
            "message": "源点动力模型 ID 不能为空"
          },
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.prompt"
                  }
                },
                ""
              ]
            },
            "message": "OpenAI 视频提示词不能为空"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$coalesce": [
                                {
                                  "$ref": "request.inputs"
                                },
                                {
                                  "$concatArrays": [
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.images"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "image"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.videos"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "video"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.audios"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "audio"
                                            }
                                          ]
                                        }
                                      }
                                    }
                                  ]
                                }
                              ]
                            }
                          },
                          "as": "media",
                          "where": {
                            "$or": [
                              {
                                "$eq": [
                                  {
                                    "$trim": {
                                      "$ref": "media.value"
                                    }
                                  },
                                  ""
                                ]
                              },
                              {
                                "$not": {
                                  "$or": [
                                    {
                                      "$and": [
                                        {
                                          "$eq": [
                                            {
                                              "$ref": "media.kind"
                                            },
                                            "image"
                                          ]
                                        },
                                        {
                                          "$in": [
                                            {
                                              "$coalesce": [
                                                {
                                                  "$ref": "media.role"
                                                },
                                                {
                                                  "$switch": {
                                                    "cases": [
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "image"
                                                          ]
                                                        },
                                                        "then": "reference_image"
                                                      },
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "video"
                                                          ]
                                                        },
                                                        "then": "reference_video"
                                                      },
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "audio"
                                                          ]
                                                        },
                                                        "then": "reference_audio"
                                                      }
                                                    ],
                                                    "default": "unsupported"
                                                  }
                                                }
                                              ]
                                            },
                                            [
                                              "first_frame",
                                              "last_frame",
                                              "reference_image"
                                            ]
                                          ]
                                        }
                                      ]
                                    },
                                    {
                                      "$and": [
                                        {
                                          "$eq": [
                                            {
                                              "$ref": "media.kind"
                                            },
                                            "video"
                                          ]
                                        },
                                        {
                                          "$eq": [
                                            {
                                              "$coalesce": [
                                                {
                                                  "$ref": "media.role"
                                                },
                                                {
                                                  "$switch": {
                                                    "cases": [
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "image"
                                                          ]
                                                        },
                                                        "then": "reference_image"
                                                      },
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "video"
                                                          ]
                                                        },
                                                        "then": "reference_video"
                                                      },
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "audio"
                                                          ]
                                                        },
                                                        "then": "reference_audio"
                                                      }
                                                    ],
                                                    "default": "unsupported"
                                                  }
                                                }
                                              ]
                                            },
                                            "reference_video"
                                          ]
                                        }
                                      ]
                                    },
                                    {
                                      "$and": [
                                        {
                                          "$eq": [
                                            {
                                              "$ref": "media.kind"
                                            },
                                            "audio"
                                          ]
                                        },
                                        {
                                          "$eq": [
                                            {
                                              "$coalesce": [
                                                {
                                                  "$ref": "media.role"
                                                },
                                                {
                                                  "$switch": {
                                                    "cases": [
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "image"
                                                          ]
                                                        },
                                                        "then": "reference_image"
                                                      },
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "video"
                                                          ]
                                                        },
                                                        "then": "reference_video"
                                                      },
                                                      {
                                                        "when": {
                                                          "$eq": [
                                                            {
                                                              "$ref": "media.kind"
                                                            },
                                                            "audio"
                                                          ]
                                                        },
                                                        "then": "reference_audio"
                                                      }
                                                    ],
                                                    "default": "unsupported"
                                                  }
                                                }
                                              ]
                                            },
                                            "reference_audio"
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$sortByOrder": {
                          "$coalesce": [
                            {
                              "$ref": "request.inputs"
                            },
                            {
                              "$concatArrays": [
                                {
                                  "$map": {
                                    "from": {
                                      "$ref": "request.images"
                                    },
                                    "as": "media",
                                    "in": {
                                      "$merge": [
                                        {
                                          "$ref": "media"
                                        },
                                        {
                                          "kind": "image"
                                        }
                                      ]
                                    }
                                  }
                                },
                                {
                                  "$map": {
                                    "from": {
                                      "$ref": "request.videos"
                                    },
                                    "as": "media",
                                    "in": {
                                      "$merge": [
                                        {
                                          "$ref": "media"
                                        },
                                        {
                                          "kind": "video"
                                        }
                                      ]
                                    }
                                  }
                                },
                                {
                                  "$map": {
                                    "from": {
                                      "$ref": "request.audios"
                                    },
                                    "as": "media",
                                    "in": {
                                      "$merge": [
                                        {
                                          "$ref": "media"
                                        },
                                        {
                                          "kind": "audio"
                                        }
                                      ]
                                    }
                                  }
                                }
                              ]
                            }
                          ]
                        }
                      }
                    },
                    128
                  ]
                }
              ]
            },
            "message": "视频素材必须有有效地址及对应类型的首帧、尾帧或参考角色，最多 128 项；不支持蒙版"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    3600
                  ]
                }
              ]
            },
            "message": "OpenAI 视频必须选择 1–3600 秒内的固定时长，实际范围以模型能力为准"
          },
          {
            "assert": {
              "$not": {
                "$ref": "request.providerOptions.tack2ai-video.metadata.draft"
              }
            },
            "message": "第一版插件不支持 draft 草稿任务"
          },
          {
            "assert": {
              "$not": {
                "$or": [
                  {
                    "$ref": "request.generateAudio"
                  },
                  {
                    "$ref": "request.watermark"
                  }
                ]
              }
            },
            "message": "通用 OpenAI 视频不映射模型专用出声/水印开关，请按模型目录通过 metadata 显式配置"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            },
            "X-Canvas-Task-ID": {
              "$ref": "request.extra.idempotencyKey"
            }
          },
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$toString": {
                "$ref": "request.duration"
              }
            },
            "size": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.aspectRatio"
                          }
                        }
                      },
                      [
                        "",
                        "adaptive",
                        "auto"
                      ]
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            },
            "resolution_name": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$split": [
                            {
                              "$lower": {
                                "$trim": {
                                  "$ref": "request.aspectRatio"
                                }
                              }
                            },
                            "x"
                          ]
                        }
                      },
                      1
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.resolution"
                  }
                }
              }
            },
            "input_reference": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$sortByOrder": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.inputs"
                                  },
                                  {
                                    "$concatArrays": [
                                      {
                                        "$map": {
                                          "from": {
                                            "$ref": "request.images"
                                          },
                                          "as": "media",
                                          "in": {
                                            "$merge": [
                                              {
                                                "$ref": "media"
                                              },
                                              {
                                                "kind": "image"
                                              }
                                            ]
                                          }
                                        }
                                      },
                                      {
                                        "$map": {
                                          "from": {
                                            "$ref": "request.videos"
                                          },
                                          "as": "media",
                                          "in": {
                                            "$merge": [
                                              {
                                                "$ref": "media"
                                              },
                                              {
                                                "kind": "video"
                                              }
                                            ]
                                          }
                                        }
                                      },
                                      {
                                        "$map": {
                                          "from": {
                                            "$ref": "request.audios"
                                          },
                                          "as": "media",
                                          "in": {
                                            "$merge": [
                                              {
                                                "$ref": "media"
                                              },
                                              {
                                                "kind": "audio"
                                              }
                                            ]
                                          }
                                        }
                                      }
                                    ]
                                  }
                                ]
                              }
                            }
                          },
                          1
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$filter": {
                                "from": {
                                  "$sortByOrder": {
                                    "$coalesce": [
                                      {
                                        "$ref": "request.inputs"
                                      },
                                      {
                                        "$concatArrays": [
                                          {
                                            "$map": {
                                              "from": {
                                                "$ref": "request.images"
                                              },
                                              "as": "media",
                                              "in": {
                                                "$merge": [
                                                  {
                                                    "$ref": "media"
                                                  },
                                                  {
                                                    "kind": "image"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          {
                                            "$map": {
                                              "from": {
                                                "$ref": "request.videos"
                                              },
                                              "as": "media",
                                              "in": {
                                                "$merge": [
                                                  {
                                                    "$ref": "media"
                                                  },
                                                  {
                                                    "kind": "video"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          {
                                            "$map": {
                                              "from": {
                                                "$ref": "request.audios"
                                              },
                                              "as": "media",
                                              "in": {
                                                "$merge": [
                                                  {
                                                    "$ref": "media"
                                                  },
                                                  {
                                                    "kind": "audio"
                                                  }
                                                ]
                                              }
                                            }
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                },
                                "as": "media",
                                "where": {
                                  "$and": [
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "media.kind"
                                        },
                                        "image"
                                      ]
                                    },
                                    {
                                      "$in": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        [
                                          null,
                                          "",
                                          "first_frame"
                                        ]
                                      ]
                                    }
                                  ]
                                }
                              }
                            }
                          },
                          1
                        ]
                      }
                    ]
                  },
                  "then": {
                    "image_url": {
                      "$first": {
                        "$map": {
                          "from": {
                            "$sortByOrder": {
                              "$coalesce": [
                                {
                                  "$ref": "request.inputs"
                                },
                                {
                                  "$concatArrays": [
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.images"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "image"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.videos"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "video"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.audios"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "audio"
                                            }
                                          ]
                                        }
                                      }
                                    }
                                  ]
                                }
                              ]
                            }
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "references": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$sortByOrder": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.inputs"
                                  },
                                  {
                                    "$concatArrays": [
                                      {
                                        "$map": {
                                          "from": {
                                            "$ref": "request.images"
                                          },
                                          "as": "media",
                                          "in": {
                                            "$merge": [
                                              {
                                                "$ref": "media"
                                              },
                                              {
                                                "kind": "image"
                                              }
                                            ]
                                          }
                                        }
                                      },
                                      {
                                        "$map": {
                                          "from": {
                                            "$ref": "request.videos"
                                          },
                                          "as": "media",
                                          "in": {
                                            "$merge": [
                                              {
                                                "$ref": "media"
                                              },
                                              {
                                                "kind": "video"
                                              }
                                            ]
                                          }
                                        }
                                      },
                                      {
                                        "$map": {
                                          "from": {
                                            "$ref": "request.audios"
                                          },
                                          "as": "media",
                                          "in": {
                                            "$merge": [
                                              {
                                                "$ref": "media"
                                              },
                                              {
                                                "kind": "audio"
                                              }
                                            ]
                                          }
                                        }
                                      }
                                    ]
                                  }
                                ]
                              }
                            }
                          },
                          1
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$len": {
                              "$filter": {
                                "from": {
                                  "$sortByOrder": {
                                    "$coalesce": [
                                      {
                                        "$ref": "request.inputs"
                                      },
                                      {
                                        "$concatArrays": [
                                          {
                                            "$map": {
                                              "from": {
                                                "$ref": "request.images"
                                              },
                                              "as": "media",
                                              "in": {
                                                "$merge": [
                                                  {
                                                    "$ref": "media"
                                                  },
                                                  {
                                                    "kind": "image"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          {
                                            "$map": {
                                              "from": {
                                                "$ref": "request.videos"
                                              },
                                              "as": "media",
                                              "in": {
                                                "$merge": [
                                                  {
                                                    "$ref": "media"
                                                  },
                                                  {
                                                    "kind": "video"
                                                  }
                                                ]
                                              }
                                            }
                                          },
                                          {
                                            "$map": {
                                              "from": {
                                                "$ref": "request.audios"
                                              },
                                              "as": "media",
                                              "in": {
                                                "$merge": [
                                                  {
                                                    "$ref": "media"
                                                  },
                                                  {
                                                    "kind": "audio"
                                                  }
                                                ]
                                              }
                                            }
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                },
                                "as": "media",
                                "where": {
                                  "$and": [
                                    {
                                      "$eq": [
                                        {
                                          "$ref": "media.kind"
                                        },
                                        "image"
                                      ]
                                    },
                                    {
                                      "$in": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        [
                                          null,
                                          "",
                                          "first_frame"
                                        ]
                                      ]
                                    }
                                  ]
                                }
                              }
                            }
                          },
                          1
                        ]
                      }
                    ]
                  },
                  "then": null,
                  "else": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$coalesce": [
                            {
                              "$ref": "request.inputs"
                            },
                            {
                              "$concatArrays": [
                                {
                                  "$map": {
                                    "from": {
                                      "$ref": "request.images"
                                    },
                                    "as": "media",
                                    "in": {
                                      "$merge": [
                                        {
                                          "$ref": "media"
                                        },
                                        {
                                          "kind": "image"
                                        }
                                      ]
                                    }
                                  }
                                },
                                {
                                  "$map": {
                                    "from": {
                                      "$ref": "request.videos"
                                    },
                                    "as": "media",
                                    "in": {
                                      "$merge": [
                                        {
                                          "$ref": "media"
                                        },
                                        {
                                          "kind": "video"
                                        }
                                      ]
                                    }
                                  }
                                },
                                {
                                  "$map": {
                                    "from": {
                                      "$ref": "request.audios"
                                    },
                                    "as": "media",
                                    "in": {
                                      "$merge": [
                                        {
                                          "$ref": "media"
                                        },
                                        {
                                          "kind": "audio"
                                        }
                                      ]
                                    }
                                  }
                                }
                              ]
                            }
                          ]
                        }
                      },
                      "as": "media",
                      "in": {
                        "type": {
                          "$ref": "media.kind"
                        },
                        "role": {
                          "$coalesce": [
                            {
                              "$ref": "media.role"
                            },
                            {
                              "$switch": {
                                "cases": [
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$ref": "media.kind"
                                        },
                                        "image"
                                      ]
                                    },
                                    "then": "reference_image"
                                  },
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$ref": "media.kind"
                                        },
                                        "video"
                                      ]
                                    },
                                    "then": "reference_video"
                                  },
                                  {
                                    "when": {
                                      "$eq": [
                                        {
                                          "$ref": "media.kind"
                                        },
                                        "audio"
                                      ]
                                    },
                                    "then": "reference_audio"
                                  }
                                ],
                                "default": "unsupported"
                              }
                            }
                          ]
                        },
                        "url": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                }
              }
            },
            "metadata": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.tack2ai-video.metadata"
              }
            },
            "mode": {
              "$omitEmpty": {
                "$ref": "request.extra.tack2aiVideoMode"
              }
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$ref": "request.extra.tack2aiVideoRatio"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$ref": "response.status"
          },
          "message": {
            "$ref": "response.error.message"
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "tack2ai-audio",
        "label": "源点动力语音",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://ai.tack2ai.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "音频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "input",
            "description": "待合成文本。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/audio/speech",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "$ref": "request.prompt"
            },
            "voice": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$trim": {
                      "$ref": "request.extra.audioVoice"
                    }
                  },
                  {
                    "$trim": {
                      "$ref": "request.providerOptions.tack2ai-audio.voice"
                    }
                  }
                ]
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$trim": {
                      "$ref": "request.extra.audioFormat"
                    }
                  },
                  {
                    "$trim": {
                      "$ref": "request.providerOptions.tack2ai-audio.response_format"
                    }
                  }
                ]
              }
            },
            "speed": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$toFloat": {
                      "$omitEmpty": {
                        "$ref": "request.extra.audioSpeed"
                      }
                    }
                  },
                  {
                    "$ref": "request.providerOptions.tack2ai-audio.speed"
                  }
                ]
              }
            },
            "instructions": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.audioInstructions"
                  },
                  {
                    "$ref": "request.providerOptions.tack2ai-audio.instructions"
                  }
                ]
              }
            },
            "metadata": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.extra.audioReferenceEncoding"
                          },
                          "metadata.references"
                        ]
                      },
                      {
                        "$or": [
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$ref": "request.audios"
                                }
                              },
                              0
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$ref": "request.images"
                                }
                              },
                              0
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  "then": {
                    "references": {
                      "$if": {
                        "condition": {
                          "$gt": [
                            {
                              "$len": {
                                "$ref": "request.audios"
                              }
                            },
                            0
                          ]
                        },
                        "then": {
                          "$map": {
                            "from": {
                              "$ref": "request.audios"
                            },
                            "as": "media",
                            "in": {
                              "$if": {
                                "condition": {
                                  "$ref": "media.url"
                                },
                                "then": {
                                  "audio_url": {
                                    "$ref": "media.url"
                                  }
                                },
                                "else": {
                                  "audio_data": {
                                    "$dataPayload": {
                                      "$ref": "media.dataUrl"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        },
                        "else": {
                          "$map": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "media",
                            "in": {
                              "$if": {
                                "condition": {
                                  "$ref": "media.url"
                                },
                                "then": {
                                  "image_url": {
                                    "$ref": "media.url"
                                  }
                                },
                                "else": {
                                  "image_data": {
                                    "$dataPayload": {
                                      "$ref": "media.dataUrl"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  },
                  "else": null
                }
              }
            }
          },
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            },
            "X-Canvas-Task-ID": {
              "$ref": "request.extra.idempotencyKey"
            }
          }
        },
        "response": {
          "binaryPayload": true,
          "resultKind": "audio",
          "status": "succeeded",
          "errorPaths": [
            "error"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "validations": [
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.model"
                  }
                },
                ""
              ]
            },
            "message": "源点动力模型 ID 不能为空"
          },
          {
            "assert": {
              "$ne": [
                {
                  "$trim": {
                    "$ref": "request.prompt"
                  }
                },
                ""
              ]
            },
            "message": "源点动力提示词不能为空"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                {
                  "$or": [
                    {
                      "$not": {
                        "$or": [
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$ref": "request.audios"
                                }
                              },
                              0
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$ref": "request.images"
                                }
                              },
                              0
                            ]
                          }
                        ]
                      }
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.extra.audioReferenceEncoding"
                        },
                        "metadata.references"
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "当前源点动力语音模型未启用所选参考素材类型"
          },
          {
            "assert": {
              "$and": [
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    3
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    1
                  ]
                },
                {
                  "$not": {
                    "$and": [
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.audios"
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.images"
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              ]
            },
            "message": "源点动力语音参考素材最多三段音频或一张图片，不能混用"
          }
        ]
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
