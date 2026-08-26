import { registerResourceAction, request as apiRequest, console, player, musicList, configuration, app, dataConverter } from './shared/hostApi'

const MAIN_API_URL = 'https://music-api.gdstudio.xyz/api.php'
const NO_PIC_PLACEHOLDER = './gdstudio-no-pic'
const EMPTY_LYRIC = '[00:00.00]暂无歌词'
const CONFIG_PRELOAD_QUALITY_ON_SEARCH = 'preloadQualityOnSearch'

// ========== org 音源(经签名服务器直连 GDStudio)==========

// org 系列音源:与主 API 音源(netease/kuwo/joox/bilibili)不同,
// 请求需带签名,由 gdstudio-server 的 /sign 端点组装成品请求后按原样发出
const ORG_SOURCES = new Set(['tencent', 'tidal', 'qobuz', 'apple', 'ytmusic', 'spotify'])
const CONFIG_SIGN_SERVER_URL = 'signServerUrl'
const CONFIG_SIGN_KEY = 'signKey'

let preloadQualityOnSearch = true
let signServerUrl = ''
let signKey = ''

const isOrgSource = (source: string | number | null | undefined) => ORG_SOURCES.has(String(source || ''))

void configuration?.getConfigs?.<[boolean, string, string]>([CONFIG_PRELOAD_QUALITY_ON_SEARCH, CONFIG_SIGN_SERVER_URL, CONFIG_SIGN_KEY]).then(([preload, signUrl, signKeyValue]) => {
  preloadQualityOnSearch = preload !== false
  signServerUrl = typeof signUrl === 'string' ? signUrl.trim() : ''
  signKey = typeof signKeyValue === 'string' ? signKeyValue.trim() : ''
}).catch(() => {})

configuration?.onConfigChanged?.((keys: string[], config: Record<string, unknown>) => {
  if (keys.includes(CONFIG_PRELOAD_QUALITY_ON_SEARCH)) {
    preloadQualityOnSearch = config[CONFIG_PRELOAD_QUALITY_ON_SEARCH] !== false
  }
  if (keys.includes(CONFIG_SIGN_SERVER_URL)) {
    signServerUrl = typeof config[CONFIG_SIGN_SERVER_URL] === 'string' ? config[CONFIG_SIGN_SERVER_URL].trim() : ''
  }
  if (keys.includes(CONFIG_SIGN_KEY)) {
    signKey = typeof config[CONFIG_SIGN_KEY] === 'string' ? config[CONFIG_SIGN_KEY].trim() : ''
  }
})

// ======== 错误提示toast =========

let lastErrorNotifyAt = 0
const ERROR_NOTIFY_INTERVAL = 5000

function showErrorToast(message: string) {
  try {
    // 不传 modal → 宿主渲染为底部居中的 toast 通知，3 秒后自动消失
    const p = app?.showMessage?.(message, { type: 'error' })
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      void (p as Promise<unknown>).catch(() => {})
    }
  } catch (err) {
    console.error('[gdstudio] Failed to show error toast:', err)
  }
}

function notifyHttpError(statusCode: number | string, source?: string | number | null) {
  const now = Date.now()
  if (now - lastErrorNotifyAt < ERROR_NOTIFY_INTERVAL) return
  lastErrorNotifyAt = now
  const src = source ? ` [${source}]` : ''
  showErrorToast(`GD音乐台接口异常${src}：HTTP ${statusCode}，请稍后重试`)
}

function notifyNetworkError(source?: string | number | null) {
  const now = Date.now()
  if (now - lastErrorNotifyAt < ERROR_NOTIFY_INTERVAL) return
  lastErrorNotifyAt = now
  const src = source ? ` [${source}]` : ''
  showErrorToast(`GD音乐台接口连接失败${src}，请检查网络后重试`)
}

// org 音源未配置签名服务器:点击音源搜索/播放即报错引导去设置
function notifySignServerMissing(source?: string | number | null) {
  const now = Date.now()
  if (now - lastErrorNotifyAt < ERROR_NOTIFY_INTERVAL) return
  lastErrorNotifyAt = now
  const src = source ? ` [${source}]` : ''
  showErrorToast(`GD音乐台${src} 音源需要签名服务器，请先在插件设置中配置「签名服务器地址」`)
}

// ========== 工具函数 ==========

function buildQuery(obj: Record<string, string | number | null | undefined>) {
  const parts: string[] = []
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key]
      if (val != null) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(val)))
      }
    }
  }
  return parts.join('&')
}

function qualityToBr(quality: string): number | null {
  switch (quality) {
    case '128k': return 128
    case '192k': return 192
    case '320k': return 320
    case 'flac': return 740
    case 'flac24bit': return 999
    case 'wav': return 999
    case 'ape': return 999
    case 'dolby': return 999
    case 'master': return 999
    default: return null
  }
}

function brToQuality(br: number): string {
  if (br >= 999) return 'flac24bit'
  if (br >= 740) return 'flac'
  if (br >= 320) return '320k'
  if (br >= 192) return '192k'
  return '128k'
}

function buildQualitysFromBr(br: number): Record<string, { sizeStr: null }> {
  const qs: Record<string, { sizeStr: null }> = { '128k': { sizeStr: null } }
  if (br >= 192) qs['192k'] = { sizeStr: null }
  if (br >= 320) qs['320k'] = { sizeStr: null }
  if (br >= 740) qs.flac = { sizeStr: null }
  if (br >= 999) qs.flac24bit = { sizeStr: null }
  return qs
}

function buildInitialQualitys(): Record<string, { sizeStr: null }> {
  return { '128k': { sizeStr: null } }
}

function shouldShowInitialQuality(source: string) {
  return preloadQualityOnSearch
}

function getResponsePreview(data: unknown) {
  if (typeof data === 'string') return data.slice(0, 800)
  try {
    return JSON.stringify(data).slice(0, 800)
  } catch (_err) {
    return String(data).slice(0, 800)
  }
}

function bodyPreview(body: unknown, length = 500) {
  try {
    return (typeof body === 'string' ? body : JSON.stringify(body)).slice(0, length)
  } catch {
    return String(body).slice(0, length)
  }
}

function logSearchResponse(source: string | number | null | undefined, data: unknown) {
  const list = Array.isArray(data) ? data.slice(0, 3) : []
  const preview = list.map((item) => ({
    id: String((item as Record<string, unknown>).id || ''),
    name: String((item as Record<string, unknown>).name || ''),
    artist: (item as Record<string, unknown>).artist,
    album: (item as Record<string, unknown>).album,
    pic_id: (item as Record<string, unknown>).pic_id,
  }))
  console.log(`[gdstudio] search response [${source}] first3: ${JSON.stringify(preview)}`)
}

function buildLyricInfo(musicInfo: Record<string, unknown>, lyric?: string | null, tlyric?: string | null) {
  return {
    lyric: lyric || EMPTY_LYRIC,
    tlyric: tlyric || null,
    rlyric: null as string | null,
    awlyric: null as string | null,
    name: String(musicInfo.name || ''),
    singer: String(musicInfo.singer || ''),
    interval: (musicInfo.interval as string) || null,
  }
}

function formatInterval(seconds: number | string): string | null {
  if (!seconds || +seconds <= 0) return null
  const h = Math.floor(+seconds / 3600)
  const m = Math.floor((+seconds % 3600) / 60)
  const s = Math.floor(+seconds % 60)
  if (h > 0) {
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  }
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function parseArtist(artist: unknown): string {
  if (Array.isArray(artist)) return artist.join('、')
  if (artist == null) return ''
  return String(artist)
    .split(/[、&_;/,，|]/)
    .map((s: string) => s.trim())
    .filter(Boolean)
    .join('、')
}

type MusicInfo = ReturnType<typeof buildMusicInfo>

function buildMusicInfo(item: Record<string, unknown>, source: string, actualBr?: number, picUrl?: string) {
  const now = Date.now()
  let interval: string | null = null
  if (item.duration || item.interval) {
    const dur = Number(item.duration || item.interval)
    if (dur > 0) interval = formatInterval(dur)
  }

  return {
    id: String(item.id),
    name: String(item.name || ''),
    singer: parseArtist(item.artist),
    interval,
    isLocal: false,
    meta: {
      musicId: String(item.id),
      albumName: String(item.album || ''),
      picUrl: picUrl || null,
      source,
      qualitys: actualBr ? buildQualitysFromBr(actualBr) : (shouldShowInitialQuality(source) ? buildInitialQualitys() : {}),
      _picId: item.pic_id ? String(item.pic_id) : undefined,
      createTime: now,
      updateTime: now,
      posTime: now,
    },
  }
}

// ========== API 请求辅助 ==========

const playbackPicIds = new Set<string>()
const picUrlCache = new Map<string, string>()
const picGettingPromises = new Map<string, Promise<string>>()

function buildPicCacheKey(source: string, musicId: string) {
  return source + '|' + musicId
}

async function waitForPlaybackPicAllowed(cacheKey: string) {
  if (playbackPicIds.has(cacheKey)) return true
  for (let i = 0; i < 40; i++) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 250) })
    if (playbackPicIds.has(cacheKey)) return true
  }
  return false
}

async function isCurrentPlayingMusic(musicId: string) {
  try {
    const playInfo = await player?.getPlayInfo?.()
    const index = Number((playInfo as { info?: { index?: number } } | undefined)?.info?.index)
    const list = (playInfo as { list?: Array<{ musicInfo?: { id?: string } }> } | undefined)?.list
    if (!Array.isArray(list) || index < 0 || index >= list.length) return false
    return String(list[index]?.musicInfo?.id || '') === musicId
  } catch (_err) {
    return false
  }
}

function getMusicInfoSource(musicInfo: Record<string, unknown>) {
  return String((musicInfo.meta as Record<string, unknown> | undefined)?.source || '')
}

async function updatePlayingMusicInfo(source: string, musicId: string, update: (musicInfo: Record<string, unknown>) => void) {
  try {
    for (let retry = 0; retry < 12; retry++) {
      const playInfo = await player?.getPlayInfo?.()
      const list = (playInfo as { list?: Array<{ listId?: string; musicInfo?: Record<string, unknown> }> } | undefined)?.list
      if (Array.isArray(list)) {
        const item = list.find((listItem) => {
          const musicInfo = listItem?.musicInfo
          return musicInfo && String(musicInfo.id || '') === musicId && getMusicInfoSource(musicInfo) === source
        })
        const currentMusicInfo = item?.musicInfo
        const listId = item?.listId
        if (currentMusicInfo && listId) {
          update(currentMusicInfo)
          await musicList?.listAction?.({
            action: 'list_music_update',
            data: [{
              id: listId,
              musicInfo: currentMusicInfo as never,
            }],
          } as never)
          return
        }
      }

      await new Promise<void>((resolve) => { setTimeout(resolve, 250) })
    }
  } catch (err) {
    console.error('[gdstudio] Failed to update playing music info:', err)
  }
}

async function updatePlayingMusicQuality(source: string, musicId: string, actualBr: number) {
  await updatePlayingMusicInfo(source, musicId, (musicInfo) => {
    const targetMeta = musicInfo.meta as Record<string, unknown> | undefined
    if (targetMeta) targetMeta.qualitys = buildQualitysFromBr(actualBr)
  })
}

async function updatePlayingMusicPic(source: string, musicId: string, picUrl: string) {
  await updatePlayingMusicInfo(source, musicId, (musicInfo) => {
    const targetMeta = musicInfo.meta as Record<string, unknown> | undefined
    if (targetMeta) targetMeta.picUrl = picUrl
  })
}

function prefetchPlaybackPic(source: string, musicId: string, musicInfo: Record<string, unknown>) {
  const meta = musicInfo.meta as Record<string, unknown> | undefined
  const cacheKey = buildPicCacheKey(source, musicId)
  playbackPicIds.add(cacheKey)
  void fetchMusicPic(source, musicInfo).then((url) => {
    if (meta) meta.picUrl = url
    void updatePlayingMusicPic(source, musicId, url)
  }).catch((err) => {
    console.error(`[gdstudio] Failed to fetch pic for ${source}:${musicId}:`, err)
  })
}

async function fetchMusicPic(source: string, musicInfo: Record<string, unknown>) {
  const musicId = String(musicInfo.id || ((musicInfo.meta as Record<string, unknown> | undefined)?.musicId) || '')
  const cacheKey = buildPicCacheKey(source, musicId)
  const cached = picUrlCache.get(cacheKey)
  if (cached) return cached

  const getting = picGettingPromises.get(cacheKey)
  if (getting) return getting

  const promise = (async () => {
    let picId: string | null = ((musicInfo.meta as Record<string, unknown> | undefined)?._picId as string) || null

    if (!picId) {
      try {
        const queryName = String(musicInfo.name || '')
        const sData = await apiCall({
          types: 'search',
          count: '1',
          source,
          pages: '1',
          name: queryName,
        })
        const list = Array.isArray(sData) ? sData : []
        if (list.length && list[0].pic_id) picId = String(list[0].pic_id)
      } catch (_err) { /* ignore */ }
    }

    if (!picId) throw new Error('No pic_id found')

    const data = await apiCall({
      types: 'pic',
      source,
      id: picId,
      size: '500',
    })

    console.log(`[gdstudio] pic response [${source}] musicId=${musicId} picId=${picId}: ${getResponsePreview(data)}`)

    if (data && data.url) {
      const url = String(data.url)
      picUrlCache.set(cacheKey, url)
      return url
    }
    throw new Error('No pic URL for pic_id ' + picId)
  })().finally(() => {
    picGettingPromises.delete(cacheKey)
  })

  picGettingPromises.set(cacheKey, promise)
  return promise
}

async function detectMainApiQuality(source: string, musicId: string) {
  try {
    const data = await apiCall({
      types: 'url',
      source,
      id: musicId,
      br: '999',
    })
    if (data && data.url) return data.br != null ? Number(data.br) : 128
  } catch (_err) { /* ignore */ }
  return 128
}

async function hydrateMainApiSearchItem(source: string, rawItem: Record<string, unknown>, musicInfo: MusicInfo) {
  const meta = musicInfo.meta as Record<string, unknown>
  if (meta._detailsLoaded) return

  const musicId = String(rawItem.id || musicInfo.id)
  const [actualBr, picUrl] = await Promise.all([
    preloadQualityOnSearch ? detectMainApiQuality(source, musicId) : Promise.resolve(null),
    fetchMusicPic(source, musicInfo as unknown as Record<string, unknown>).catch(() => null),
  ])

  if (actualBr) meta.qualitys = buildQualitysFromBr(actualBr)
  if (picUrl) meta.picUrl = picUrl
  meta._detailsLoaded = true
}

async function apiCallMainApi(params: Record<string, string | number | null | undefined>) {
  const body = buildQuery(params)

  let resp: { statusCode?: number; body: unknown; headers?: Record<string, unknown> }
  try {
    resp = await apiRequest(MAIN_API_URL + '?' + body, {
      method: 'GET',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://music.gdstudio.org/',
      },
    })
  } catch (err) {
    console.error(`[gdstudio] request failed [${params.source}] types=${params.types}:`, err)
    notifyNetworkError(params.source)
    throw err
  }
  const statusCode = resp.statusCode ?? '?'
  if (statusCode !== 200) {
    console.error(`[gdstudio] non-200 response (${statusCode}):`, typeof resp.body === 'string' ? resp.body.slice(0, 500) : JSON.stringify(resp.body).slice(0, 500))
    notifyHttpError(statusCode, params.source)
  }
  const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
  if (params.types === 'search') logSearchResponse(params.source, data)
  return data
}

// org 音源:调签名服务器的 /sign 拿成品请求,按成品请求原样直发 GDStudio。
// 签名时效为秒级(实测 5~15s),因此每次调用都重新取签名,拿到后立即发送。
async function apiCallOrg(params: Record<string, string | number | null | undefined>) {
  const source = String(params.source || '')
  if (!signServerUrl) {
    notifySignServerMissing(source)
    throw new Error('未配置签名服务器地址(插件设置页 signServerUrl)')
  }

  // 组装 /sign 参数:op + 业务参数(与签名服务器的 op/参数一一对应;
  // 注意主 API 字段名 pages 对应签名服务器的 page)
  const signParams: Record<string, string | number> = { op: String(params.types), source }
  for (const key of Object.keys(params)) {
    if (key === 'types' || key === 'source') continue
    if (params[key] != null) signParams[key === 'pages' ? 'page' : key] = String(params[key])
  }
  const signHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
  if (signKey) signHeaders.Authorization = `Bearer ${signKey}`

  let signResp: { statusCode?: number; body: unknown }
  try {
    signResp = await apiRequest(signServerUrl.replace(/\/+$/, '') + '/sign?' + buildQuery(signParams), {
      method: 'GET',
      headers: signHeaders,
      timeout: 8000,
    })
  } catch (err) {
    console.error(`[gdstudio] sign request failed [${source}]:`, err)
    notifyNetworkError(source)
    throw err
  }
  if (signResp.statusCode !== 200) {
    console.error(`[gdstudio] sign server non-200 (${signResp.statusCode}):`, bodyPreview(signResp.body, 300))
    notifyHttpError(signResp.statusCode ?? '?', source)
    throw new Error(`签名服务器返回 ${signResp.statusCode}`)
  }
  let signData: {
    ok?: boolean
    error?: string
    req?: { url: string; method: string; headers: Record<string, string>; body: string | null }
  }
  try {
    // 宿主的 request 返回的 body 可能是已解析的对象,也可能是原始字符串,双态处理
    signData = (typeof signResp.body === 'string' ? JSON.parse(signResp.body) : signResp.body) as typeof signData
  } catch {
    throw new Error('签名服务器响应解析失败: ' + JSON.stringify(signResp.body).slice(0, 200))
  }
  if (!signData.ok || !signData.req || !signData.req.url) {
    throw new Error(`签名失败: ${signData.error || '未知错误'}`)
  }

  // 立即按成品请求原样发送(透传 url/method/headers/body)
  const req = signData.req
  let resp: { statusCode?: number; body: unknown }
  try {
    resp = await apiRequest(req.url, {
      method: (req.method || 'POST') as never,
      headers: req.headers,
      // VM 里没有 TextEncoder,用宿主提供的 dataConverter 做 utf-8 → 字节转换
      binary: req.body != null ? await dataConverter(String(req.body), 'utf-8', 'binary') : undefined,
      timeout: 15000,
    })
  } catch (err) {
    console.error(`[gdstudio] direct request failed [${source}]:`, err)
    notifyNetworkError(source)
    throw err
  }
  const statusCode = resp.statusCode ?? '?'
  if (statusCode !== 200) {
    console.error(`[gdstudio] non-200 response (${statusCode}):`, bodyPreview(resp.body, 500))
    notifyHttpError(statusCode, source)
  }
  const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
  if (params.types === 'search') logSearchResponse(params.source, data)
  return data
}

function apiCall(params: Record<string, string | number | null | undefined>) {
  return isOrgSource(params.source) ? apiCallOrg(params) : apiCallMainApi(params)
}

// ========== 资源操作 ==========

interface BatchCache {
  _key: string
  [batchIndex: number]: {
    rawList: Record<string, unknown>[]
    items: Record<number, MusicInfo>
    total: number
  } | undefined
}

const searchCache: BatchCache = { _key: '' }

async function musicSearch(params: {
  source: string
  name: string
  artist?: string
  page?: number
  limit?: number
}) {
  const source = params.source
  const name = params.name
  const artist = params.artist
  const page = params.page || 1
  const limit = Math.min(params.limit || 20, 50)
  const batchPageCount = 3
  const fetchCount = limit * batchPageCount

  // org 音源未配置签名服务器:立即报错,不进重试/缓存流程
  if (isOrgSource(source) && !signServerUrl) {
    notifySignServerMissing(source)
    throw new Error('未配置签名服务器地址(插件设置页 signServerUrl)')
  }

  const searchKey = source + '|' + name + '|' + (artist || '')
  const batchIndex = Math.floor((page - 1) / batchPageCount)
  const offsetInBatch = (page - 1) % batchPageCount

  if (searchCache._key !== searchKey) {
    searchCache._key = searchKey
    Object.keys(searchCache).forEach((k) => {
      if (k !== '_key') delete searchCache[+k as unknown as number]
    })
  }

  let batch = searchCache[batchIndex]
  if (!batch) {
    const apiPage = batchIndex + 1
    const queryName = artist ? name + ' ' + artist : name

    let rawList: Record<string, unknown>[] = []
    let lastError: string | null = null
    for (let retry = 0; retry < 2; retry++) {
      try {
        const data = await apiCall({
          types: 'search',
          count: String(fetchCount),
          source,
          pages: String(apiPage),
          name: queryName,
        })

        if (data && data.error) {
          lastError = String(data.error)
          break
        }

        rawList = Array.isArray(data) ? data : []
        if (rawList.length > 0) break

        if (retry < 1) {
          await new Promise<void>((resolve) => { setTimeout(resolve, 300) })
        }
      } catch (_err) {
        console.error(`[gdstudio] search request failed [${source}]:`, _err)
        notifyNetworkError(source)
        if (retry < 1) {
          await new Promise<void>((resolve) => { setTimeout(resolve, 500) })
        }
      }
    }

    // gd API 限流/波动时表现为无特征的空结果;按上游维护者建议抛错,
    // 让主程序走失败路径(不缓存 + 提示重试),而不是当成"成功但无结果"
    if (rawList.length === 0) {
      throw new Error(lastError || '搜索返回空结果(可能是 API 限流,请稍后重试)')
    }

    let total: number
    if (rawList.length >= fetchCount) {
      total = apiPage * fetchCount + 1
    } else {
      total = (apiPage - 1) * fetchCount + rawList.length
    }

    const items: Record<number, MusicInfo> = {}
    for (let i = 0; i < rawList.length; i++) {
      items[i] = buildMusicInfo(rawList[i], source)
    }

    batch = { rawList, items, total }
    if(rawList.length > 0)
    {
      searchCache[batchIndex] = batch
    }
  }

  const startIdx = offsetInBatch * limit
  const endIdx = Math.min(startIdx + limit, batch.rawList.length)

  // org 音源不预加载音质/封面:每次签名请求都占上游配额,搜索界面严禁嗅探(防限流)
  if (!isOrgSource(source)) {
    await Promise.all(Array.from({ length: endIdx - startIdx }, async (_item, index) => {
      const itemIndex = startIdx + index
      await hydrateMainApiSearchItem(source, batch.rawList[itemIndex], batch.items[itemIndex])
    }))
  }

  const pageItems: MusicInfo[] = []
  for (let k = startIdx; k < endIdx; k++) {
    pageItems.push(batch.items[k])
  }

  return {
    list: pageItems,
    total: batch.total,
    page,
    limit,
  }
}

async function musicUrl(params: {
  source: string
  musicInfo: Record<string, unknown>
  quality?: string
}) {
  const source = params.source
  const musicInfo = params.musicInfo
  const quality = params.quality
  const musicId = String(musicInfo.id || ((musicInfo.meta as Record<string, unknown> | undefined)?.musicId) || '')
  prefetchPlaybackPic(source, musicId, musicInfo)

  // 从用户选择的音质开始降级:只尝试偏好档及以下(如 320k → 320,192,128),
  // 不再像之前那样偏好档失败后先跳回 999 再往下降(org 音源白烧签名配额);
  // 未指定/未知音质时走完整降级链
  const allBrs = [999, 740, 320, 192, 128]
  let brsToTry: number[] = allBrs
  if (quality) {
    const preferredBr = qualityToBr(quality)
    if (preferredBr) brsToTry = allBrs.filter((br) => br <= preferredBr)
  }

  let lastError: Error | null = null

  for (let j = 0; j < brsToTry.length; j++) {
    const br = brsToTry[j]
    try {
      const data = await apiCall({
        types: 'url',
        source,
        id: musicId,
        br: String(br),
      })

      if (data && data.url) {
        const actualBr = data.br != null ? Number(data.br) : br
        const meta = musicInfo.meta as Record<string, unknown> | undefined
        if (meta) meta.qualitys = buildQualitysFromBr(actualBr)
        void updatePlayingMusicQuality(source, musicId, actualBr)
        return { url: String(data.url), quality: brToQuality(actualBr) }
      }
    } catch (err) {
      lastError = err as Error
    }
  }

  // 全档失败抛错而不是返回占位符:宿主会把返回的 url 存进 SQLite 缓存,
  // './gdstudio-no-url' 这类占位符能通过宿主的 allowedUrl 校验,一旦入缓存
  // 就永久毒化该歌曲(后续播放永远命中坏缓存,不再请求真实 API);
  // 抛错则宿主不写缓存,还会尝试其他扩展源并正常报播放失败
  if (lastError) console.error(`[gdstudio] No URL available for ${source}:${musicId}:`, lastError.message)
  throw new Error(`[${source}] No URL available for ${musicId}${lastError ? `: ${lastError.message}` : ''}`)
}

async function musicPic(params: {
  source: string
  musicInfo: Record<string, unknown>
}) {
  const source = params.source
  const musicInfo = params.musicInfo
  const musicId = String(musicInfo.id || ((musicInfo.meta as Record<string, unknown> | undefined)?.musicId) || '')
  const cacheKey = buildPicCacheKey(source, musicId)
  const cached = picUrlCache.get(cacheKey)
  if (cached) return cached
  if (!playbackPicIds.has(cacheKey) && await isCurrentPlayingMusic(musicId)) playbackPicIds.add(cacheKey)
  if (!(await waitForPlaybackPicAllowed(cacheKey))) return NO_PIC_PLACEHOLDER
  return fetchMusicPic(source, musicInfo).catch((err) => {
    console.error(`[gdstudio] Failed to fetch pic for ${source}:${musicId}:`, err)
    return NO_PIC_PLACEHOLDER
  })
}

async function musicLyric(params: {
  source: string
  musicInfo: Record<string, unknown>
}) {
  const source = params.source
  const musicInfo = params.musicInfo
  const lyricId = ((musicInfo.meta as Record<string, unknown> | undefined)?.musicId as string) || musicInfo.id

  try {
    const data = await apiCall({
      types: 'lyric',
      source,
      id: String(lyricId),
    })

    return buildLyricInfo(
      musicInfo,
      (data && data.lyric) ? String(data.lyric) : null,
      (data && data.tlyric) ? String(data.tlyric) : null
    )
  } catch (_err) {
    console.error(`[gdstudio] Failed to get lyric [${source}] id=${String(lyricId)}:`, _err)
    return buildLyricInfo(musicInfo)
  }
}

// 内部实现刻意用宽松类型(musicInfo 当不透明口袋读写 meta),
// 与宿主声明的精确类型在类型层面对不上;运行时由宿主逐字段校验,
// 故在注册边界收口(与上面 musicList.listAction 的处理一致)
registerResourceAction({
  musicSearch,
  musicUrl,
  musicPic,
  musicLyric,
} as never)
