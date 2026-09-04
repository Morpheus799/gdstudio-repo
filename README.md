# gdstudio-repo

用于 Any Listen 的 GDStudio 音乐资源扩展。

## 签名服务器接口

QQ 音乐、TIDAL、Qobuz、Apple Music、YouTube Music 和 Spotify 音源需要配置兼容的签名服务器。

在扩展设置中填写：

- **签名服务器地址**：服务器基础地址，例如 `https://sign.example.com`，不要包含 `/sign`。
- **签名 token**：签名服务器使用的 Bearer token。

扩展会请求：

```http
GET /sign?<query>
Authorization: Bearer <signKey>
```

当扩展没有配置 `signKey` 时，不发送 `Authorization` 请求头。所有 query 参数均经过 URL 编码。

### 请求参数

所有请求都包含：

| 参数 | 必填 | 说明 |
|---|---|---|
| `op` | 是 | 操作类型：`search`、`url`、`pic` 或 `lyric` |
| `source` | 是 | 音源：`tencent`、`tidal`、`qobuz`、`apple`、`ytmusic` 或 `spotify` |

各操作的业务参数如下：

| `op` | 必填参数 | 可选参数 | `id` 含义 |
|---|---|---|---|
| `search` | `name` | `page`、`count` | 不使用 `id` |
| `url` | `id` | `br` | 搜索结果中的歌曲 `id` |
| `pic` | `id` | `size` | 搜索结果中的 `pic_id` |
| `lyric` | `id` | 无 | 搜索结果中的 `lyric_id` |

请求示例：

```http
GET /sign?op=search&source=tidal&name=example&page=1&count=20
Authorization: Bearer <signKey>
```

```http
GET /sign?op=url&source=tidal&id=<song-id>&br=999
Authorization: Bearer <signKey>
```

```http
GET /sign?op=pic&source=tidal&id=<pic-id>&size=500
Authorization: Bearer <signKey>
```

```http
GET /sign?op=lyric&source=tidal&id=<lyric-id>
Authorization: Bearer <signKey>
```

### 成功响应

签名成功时必须返回 HTTP `200` 和 JSON：

```json
{
  "ok": true,
  "req": {
    "url": "https://music.gdstudio.org/api.php",
    "method": "POST",
    "headers": {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://music.gdstudio.org/",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    "body": "types=search&source=tidal&name=example&s=<signature>"
  }
}
```

`req` 字段要求：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | `string` | 是 | 完整的上游请求 URL |
| `method` | `string` | 是 | 上游请求方法，通常为 `GET` 或 `POST` |
| `headers` | `Record<string, string>` | 是 | 上游请求头 |
| `body` | `string \| null` | 是 | 上游请求体；无请求体时为 `null` |

服务器可以附加 `method`、`ts`、`futureMs`、`expiresMs`、`version` 等顶层字段，扩展会忽略这些附加字段。

扩展收到成功响应后，会立即按照 `req.url`、`req.method`、`req.headers` 和 `req.body` 原样请求上游。每次 `/sign` 调用都应返回当前有效的新签名请求，响应不应被缓存。

### 失败响应

签名失败时返回非 `200` HTTP 状态和 JSON：

```json
{
  "ok": false,
  "error": "error message"
}
```

建议状态码：

| 状态码 | 含义 |
|---|---|
| `400` | `op` 或业务参数无效 |
| `401` | Bearer token 缺失或错误 |
| `503` | 当前无法生成签名请求 |

即使 HTTP 状态为 `200`，当 `ok` 不为 `true`、`req` 缺失或 `req.url` 为空时，扩展也会将本次签名视为失败。

## License

Apache License 2.0
