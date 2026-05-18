import { registerResourceAction, request as apiRequest } from './shared/hostApi'

const BASE_URL = 'https://music-api.gdstudio.xyz/api.php'

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

// quality → br: master/dolby/wav/ape/flac24bit → 999, flac → 740, 320k → 320, 192k → 192, 128k → 128
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

// 构建 qualitys 对象，包含 br 对应品质及以下所有更低品质
function buildQualitysFromBr(br: number): Record<string, { sizeStr: null }> {
  const qs: Record<string, { sizeStr: null }> = {}
  qs['128k'] = { sizeStr: null }
  if (br >= 192) qs['192k'] = { sizeStr: null }
  if (br >= 320) qs['320k'] = { sizeStr: null }
  if (br >= 740) qs.flac = { sizeStr: null }
  if (br >= 999) qs.flac24bit = { sizeStr: null }
  return qs
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

async function detectQuality(source: string, musicId: string): Promise<number> {
  try {
    const qs = buildQuery({ types: 'url', source, id: musicId, br: '999' })
    const resp = await apiRequest(BASE_URL + '?' + qs, { method: 'GET', timeout: 8000 })
    const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
    if (data && data.url) {
      return data.br != null ? Number(data.br) : 128
    }
  } catch (_err) { /* ignore */ }
  return 128
}

function buildMusicInfo(item: Record<string, unknown>, source: string, actualBr: number) {
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
      picUrl: null,
      source,
      qualitys: buildQualitysFromBr(actualBr),
      _picId: item.pic_id ? String(item.pic_id) : undefined,
      createTime: now,
      updateTime: now,
      posTime: now,
    },
  }
}

// ========== 资源操作 ==========

interface BatchCache {
  _key: string
  [batchIndex: number]: {
    rawList: Record<string, unknown>[]
    items: Record<number, ReturnType<typeof buildMusicInfo>>
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
  const fetchCount = limit * 3

  const searchKey = source + '|' + name + '|' + (artist || '')
  const batchIndex = Math.floor((page - 1) / 3)
  const offsetInBatch = (page - 1) % 3

  if (searchCache._key !== searchKey) {
    searchCache._key = searchKey
    // 清理旧 batch
    Object.keys(searchCache).forEach((k) => {
      if (k !== '_key') delete searchCache[+k as unknown as number]
    })
  }

  let batch = searchCache[batchIndex]
  if (!batch) {
    const apiPage = batchIndex + 1
    const qs = buildQuery({
      types: 'search',
      source,
      name: artist ? name + ' ' + artist : name,
      pages: String(apiPage),
      count: String(fetchCount),
    })

    let rawList: Record<string, unknown>[] = []
    for (let retry = 0; retry < 5; retry++) {
      try {
        const response = await apiRequest(BASE_URL + '?' + qs, { method: 'GET', timeout: 15000 })
        const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body

        if (data && data.error) break

        rawList = Array.isArray(data) ? data : []
        if (rawList.length > 0) break

        if (retry < 4) {
          await new Promise<void>((resolve) => { setTimeout(resolve, 300) })
        }
      } catch (_err) {
        if (retry < 4) {
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

    batch = { rawList, items: {}, total }
    searchCache[batchIndex] = batch
  }

  const startIdx = offsetInBatch * limit
  const endIdx = Math.min(startIdx + limit, batch.rawList.length)

  // 找出当前页中尚未构建的 item
  const needDetect: number[] = []
  for (let i = startIdx; i < endIdx; i++) {
    if (!batch.items[i]) needDetect.push(i)
  }

  // 并行探测音质，再构建 item 并缓存
  if (needDetect.length) {
    const brResults = await Promise.all(
      needDetect.map((i) => {
        return detectQuality(source, String(batch!.rawList[i].id)).catch(() => 128)
      })
    )
    for (let j = 0; j < needDetect.length; j++) {
      const idx = needDetect[j]
      batch.items[idx] = buildMusicInfo(batch.rawList[idx], source, brResults[j])
    }
  }

  // 从缓存组装当前页
  const pageItems: ReturnType<typeof buildMusicInfo>[] = []
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

  const brsToTry: number[] = []
  if (quality) {
    const preferredBr = qualityToBr(quality)
    if (preferredBr) brsToTry.push(preferredBr)
  }
  // 补充剩余 br 值，按优先级降序尝试
  const allBrs = [999, 740, 320, 192, 128]
  for (let i = 0; i < allBrs.length; i++) {
    if (brsToTry.indexOf(allBrs[i]) === -1) brsToTry.push(allBrs[i])
  }

  let lastError: Error | null = null
  for (let j = 0; j < brsToTry.length; j++) {
    const br = brsToTry[j]
    try {
      const qs = buildQuery({ types: 'url', source, id: musicId, br: String(br) })
      const resp = await apiRequest(BASE_URL + '?' + qs, { method: 'GET', timeout: 15000 })
      const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body

      if (data && data.url) {
        const actualBr = data.br != null ? Number(data.br) : br
        return { url: String(data.url), quality: brToQuality(actualBr) }
      }
    } catch (err) {
      lastError = err as Error
    }
  }

  throw lastError || new Error('No URL available for ' + musicId)
}

async function musicPic(params: {
  source: string
  musicInfo: Record<string, unknown>
}) {
  const source = params.source
  const musicInfo = params.musicInfo

  let picId: string | null = ((musicInfo.meta as Record<string, unknown> | undefined)?._picId as string) || null

  if (!picId) {
    try {
      const sq = buildQuery({
        types: 'search', source,
        name: String(musicInfo.name || ''), count: '1', pages: '1',
      })
      const sResp = await apiRequest(BASE_URL + '?' + sq, { method: 'GET', timeout: 10000 })
      const sData = typeof sResp.body === 'string' ? JSON.parse(sResp.body) : sResp.body
      const list = Array.isArray(sData) ? sData : []
      if (list.length && list[0].pic_id) picId = String(list[0].pic_id)
    } catch (_err) { /* ignore */ }
  }

  if (!picId) throw new Error('No pic_id found')

  const pq = buildQuery({ types: 'pic', source, id: picId, size: '500' })
  const resp = await apiRequest(BASE_URL + '?' + pq, { method: 'GET', timeout: 10000 })
  const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body

  if (data && data.url) return String(data.url)
  throw new Error('No pic URL for pic_id ' + picId)
}

async function musicLyric(params: {
  source: string
  musicInfo: Record<string, unknown>
}) {
  const source = params.source
  const musicInfo = params.musicInfo
  const lyricId = ((musicInfo.meta as Record<string, unknown> | undefined)?.musicId as string) || musicInfo.id

  const qs = buildQuery({ types: 'lyric', source, id: String(lyricId) })

  try {
    const resp = await apiRequest(BASE_URL + '?' + qs, { method: 'GET', timeout: 10000 })
    const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body

    return {
      lyric: (data && data.lyric) ? String(data.lyric) : '',
      tlyric: (data && data.tlyric) ? String(data.tlyric) : null,
      rlyric: null as string | null,
      awlyric: null as string | null,
      name: String(musicInfo.name || ''),
      singer: String(musicInfo.singer || ''),
      interval: (musicInfo.interval as string) || null,
    }
  } catch (_err) {
    return {
      lyric: '',
      tlyric: null as string | null,
      rlyric: null as string | null,
      awlyric: null as string | null,
      name: String(musicInfo.name || ''),
      singer: String(musicInfo.singer || ''),
      interval: (musicInfo.interval as string) || null,
    }
  }
}

registerResourceAction({
  musicSearch,
  musicUrl,
  musicPic,
  musicLyric,
})
