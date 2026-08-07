import { registerResourceAction, request as apiRequest, console, crypto, player, musicList, configuration, app } from './shared/hostApi'

const ORG_API_URL = 'https://music.gdstudio.org/api.php'
const MAIN_API_URL = 'https://music-api.gdstudio.xyz/api.php'
const HOST = 'music.gdstudio.org'
const PLAYER_JS_URL = 'https://music.gdstudio.org/js/player.js'
const TIME_URL = 'https://music.gdstudio.org/time'
const MAIN_API_SOURCES = new Set(['netease', 'kuwo', 'joox', 'bilibili'])
const NO_URL_PLACEHOLDER = './gdstudio-no-url'
const NO_PIC_PLACEHOLDER = './gdstudio-no-pic'
const EMPTY_LYRIC = '[00:00.00]暂无歌词'
const CONFIG_PRELOAD_QUALITY_ON_SEARCH = 'preloadQualityOnSearch'

// ========== 签名相关 ==========

let cachedVersion: string | null = null
let cachedPaddedVersion: string | null = null
let preloadQualityOnSearch = true

void configuration?.getConfigs?.<[boolean]>([CONFIG_PRELOAD_QUALITY_ON_SEARCH]).then(([value]) => {
  preloadQualityOnSearch = value !== false
}).catch(() => {})

configuration?.onConfigChanged?.((keys: string[], config: Record<string, unknown>) => {
  if (keys.includes(CONFIG_PRELOAD_QUALITY_ON_SEARCH)) {
    preloadQualityOnSearch = config[CONFIG_PRELOAD_QUALITY_ON_SEARCH] !== false
  }
})

// ========== 错误提示（toast，节流避免刷屏） ==========

let lastErrorNotifyAt = 0
const ERROR_NOTIFY_INTERVAL = 5000

function notifyHttpError(statusCode: number | string, source?: string | number | null) {
  const now = Date.now()
  if (now - lastErrorNotifyAt < ERROR_NOTIFY_INTERVAL) return
  lastErrorNotifyAt = now
  const src = source ? ` [${source}]` : ''
  const message = `GD音乐台接口异常${src}：HTTP ${statusCode}，请稍后重试`
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

function padVersion(version: string): string {
  return version.split('.').map((p) => p.padStart(2, '0')).join('')
}

async function getVersion(): Promise<string | null> {
  if (cachedVersion) return cachedVersion
  try {
    const resp = await apiRequest(PLAYER_JS_URL, { method: 'GET', timeout: 10000 })
    const sc = (resp as unknown as { statusCode?: number }).statusCode ?? '?'
    const text = typeof resp.body === 'string' ? resp.body : ''
    const match = text.match(/version\s*:\s*"([^"]+)"/)
    if (match) {
      cachedVersion = match[1]
      cachedPaddedVersion = padVersion(cachedVersion)
      return cachedVersion
    }
    if (sc !== 200) notifyHttpError(sc)
  } catch (err) {
    console.error(`[gdstudio] Failed to get version: ${err}`)
  }
  return null
}

async function getServerTimestamp(): Promise<number> {
  try {
    const resp = await apiRequest(TIME_URL, {
      method: 'GET',
      timeout: 5000,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://music.gdstudio.org/',
      },
    })
    const sc = (resp as unknown as { statusCode?: number }).statusCode ?? '?'
    if (sc !== 200) {
      notifyHttpError(sc)
      return Date.now()
    }
    return parseInt(String(resp.body).trim(), 10)
  } catch {
    return Date.now()
  }
}

async function buildSign(keyword: string): Promise<string> {
  const version = await getVersion()
  if (!version || !cachedPaddedVersion) throw new Error('Version not available')
  const ts = await getServerTimestamp()
  const raw = `${HOST}|${cachedPaddedVersion}|${String(ts).slice(0, 9)}|${encodeURIComponent(keyword)}`
  const hash = await crypto.md5(raw)
  return hash.slice(-8).toUpperCase()
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

function shouldUseMainApi(source: string | number | null | undefined) {
  return MAIN_API_SOURCES.has(String(source || ''))
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

function normalizeMusicUrl(source: string, url: string) {
  if (!shouldUseMainApi(source) && url.includes('music.gdstudio.xyz')) {
    return url.replaceAll('music.gdstudio.xyz', 'music.gdstudio.org')
  }
  return url
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
        }, queryName)
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
    }, picId)

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
    }, musicId)
    if (data && data.url) return data.br != null ? Number(data.br) : 128
  } catch (_err) { /* ignore */ }
  return 128
}

async function hydrateMainApiSearchItem(source: string, rawItem: Record<string, unknown>, musicInfo: MusicInfo) {
  if (!shouldUseMainApi(source)) return
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

async function apiCall(params: Record<string, string | number | null | undefined>, signKey: string) {
  const useMainApi = shouldUseMainApi(params.source)
  const requestParams = useMainApi ? params : { ...params, s: await buildSign(signKey) }
  const body = buildQuery(requestParams)

  const resp = useMainApi
    ? await apiRequest(MAIN_API_URL + '?' + body, {
        method: 'GET',
        timeout: 15000,
      })
    : await apiRequest(ORG_API_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://music.gdstudio.org/',
    },
    form: requestParams,
  })
  const statusCode = (resp as unknown as { statusCode?: number }).statusCode ?? '?'
  if (statusCode !== 200) {
    console.error(`[gdstudio] non-200 response (${statusCode}):`, typeof resp.body === 'string' ? resp.body.slice(0, 500) : JSON.stringify(resp.body).slice(0, 500))
    notifyHttpError(statusCode, params.source)
  }
  const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
  if (params.types === 'search') logSearchResponse(params.source, data)
  return data
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
  const batchPageCount = shouldUseMainApi(source) ? 3 : 2
  const fetchCount = limit * batchPageCount

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
    for (let retry = 0; retry < 2; retry++) {
      try {
        const data = await apiCall({
          types: 'search',
          count: String(fetchCount),
          source,
          pages: String(apiPage),
          name: queryName,
        }, queryName)

        if (data && data.error) break

        rawList = Array.isArray(data) ? data : []
        if (rawList.length > 0) break

        if (retry < 1) {
          await new Promise<void>((resolve) => { setTimeout(resolve, 300) })
        }
      } catch (_err) {
        if (retry < 1) {
          await new Promise<void>((resolve) => { setTimeout(resolve, 500) })
        }
      }
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
    searchCache[batchIndex] = batch
  }

  const startIdx = offsetInBatch * limit
  const endIdx = Math.min(startIdx + limit, batch.rawList.length)

  if (shouldUseMainApi(source)) {
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

  const brsToTry: number[] = []
  if (quality) {
    const preferredBr = qualityToBr(quality)
    if (preferredBr) brsToTry.push(preferredBr)
  }
  const allBrs = [999, 740, 320, 192, 128]
  for (let i = 0; i < allBrs.length; i++) {
    if (brsToTry.indexOf(allBrs[i]) === -1) brsToTry.push(allBrs[i])
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
      }, musicId)

      if (data && data.url) {
        const actualBr = data.br != null ? Number(data.br) : br
        const meta = musicInfo.meta as Record<string, unknown> | undefined
        if (meta) meta.qualitys = buildQualitysFromBr(actualBr)
        void updatePlayingMusicQuality(source, musicId, actualBr)
        return { url: normalizeMusicUrl(source, String(data.url)), quality: brToQuality(actualBr) }
      }
    } catch (err) {
      lastError = err as Error
    }
  }

  if (lastError) console.error(`[gdstudio] No URL available for ${source}:${musicId}:`, lastError.message)
  return { url: NO_URL_PLACEHOLDER, quality: quality || '128k' }
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
    }, String(lyricId))

    return buildLyricInfo(
      musicInfo,
      (data && data.lyric) ? String(data.lyric) : null,
      (data && data.tlyric) ? String(data.tlyric) : null
    )
  } catch (_err) {
    return buildLyricInfo(musicInfo)
  }
}

registerResourceAction({
  musicSearch,
  musicUrl,
  musicPic,
  musicLyric,
})
