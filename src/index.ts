import { registerResourceAction, request as apiRequest, console } from './shared/hostApi'

const BASE_URL = 'https://music.gdstudio.org/api.php'
const HOST = 'music.gdstudio.org'
const PLAYER_JS_URL = 'https://music.gdstudio.org/js/player.js'
const TIME_URL = 'https://music.gdstudio.org/time'

// ========== 签名相关 ==========

let cachedVersion: string | null = null
let cachedPaddedVersion: string | null = null

function padVersion(version: string): string {
  return version.split('.').map((p) => p.padStart(2, '0')).join('')
}

async function getVersion(): Promise<string | null> {
  if (cachedVersion) return cachedVersion
  try {
    const resp = await apiRequest(PLAYER_JS_URL, { method: 'GET', timeout: 10000 })
    const text = typeof resp.body === 'string' ? resp.body : ''
    const match = text.match(/version\s*:\s*"([^"]+)"/)
    if (match) {
      cachedVersion = match[1]
      cachedPaddedVersion = padVersion(cachedVersion)
      console.log(`[gdstudio] version: ${cachedVersion}`)
      return cachedVersion
    }
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
    return parseInt(String(resp.body).trim(), 10)
  } catch {
    return Date.now()
  }
}

// ========== MD5 ==========

function md5(str: string): string {
  function r(n: number, c: number) { return (n << c) | (n >>> (32 - c)) }
  function q(n: number, c: number, x: number, s: number, t: number, a: number) {
    return r(n + c + x + t, s) + a
  }
  function f(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return q((b & c) | (~b & d), a, x, s, t, b)
  }
  function g(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return q((b & d) | (c & ~d), a, x, s, t, b)
  }
  function h(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return q(b ^ c ^ d, a, x, s, t, b)
  }
  function i(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return q(c ^ (b | ~d), a, x, s, t, b)
  }

  const bytes = new TextEncoder().encode(str)
  const len = bytes.length
  const totalLen = len + 8
  const words = new Uint32Array(((totalLen >>> 6) + 1) * 16) // ensure enough space
  for (let j = 0; j < len; j++) words[j >>> 2] |= bytes[j] << ((j & 3) * 8)
  words[len >>> 2] |= 0x80 << ((len & 3) * 8)
  words[words.length - 2] = len * 8

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let j = 0; j < words.length; j += 16) {
    let a = a0, b1 = b0, c1 = c0, d1 = d0
    a = f(a, b1, c1, d1, words[j+0], 7, 0xd76aa478); d1 = f(d1, a, b1, c1, words[j+1], 12, 0xe8c7b756)
    c1 = f(c1, d1, a, b1, words[j+2], 17, 0x242070db); b1 = f(b1, c1, d1, a, words[j+3], 22, 0xc1bdceee)
    a = f(a, b1, c1, d1, words[j+4], 7, 0xf57c0faf); d1 = f(d1, a, b1, c1, words[j+5], 12, 0x4787c62a)
    c1 = f(c1, d1, a, b1, words[j+6], 17, 0xa8304613); b1 = f(b1, c1, d1, a, words[j+7], 22, 0xfd469501)
    a = f(a, b1, c1, d1, words[j+8], 7, 0x698098d8); d1 = f(d1, a, b1, c1, words[j+9], 12, 0x8b44f7af)
    c1 = f(c1, d1, a, b1, words[j+10], 17, 0xffff5bb1); b1 = f(b1, c1, d1, a, words[j+11], 22, 0x895cd7be)
    a = f(a, b1, c1, d1, words[j+12], 7, 0x6b901122); d1 = f(d1, a, b1, c1, words[j+13], 12, 0xfd987193)
    c1 = f(c1, d1, a, b1, words[j+14], 17, 0xa679438e); b1 = f(b1, c1, d1, a, words[j+15], 22, 0x49b40821)
    a = g(a, b1, c1, d1, words[j+1], 5, 0xf61e2562); d1 = g(d1, a, b1, c1, words[j+6], 9, 0xc040b340)
    c1 = g(c1, d1, a, b1, words[j+11], 14, 0x265e5a51); b1 = g(b1, c1, d1, a, words[j+0], 20, 0xe9b6c7aa)
    a = g(a, b1, c1, d1, words[j+5], 5, 0xd62f105d); d1 = g(d1, a, b1, c1, words[j+10], 9, 0x02441453)
    c1 = g(c1, d1, a, b1, words[j+15], 14, 0xd8a1e681); b1 = g(b1, c1, d1, a, words[j+4], 20, 0xe7d3fbc8)
    a = g(a, b1, c1, d1, words[j+9], 5, 0x21e1cde6); d1 = g(d1, a, b1, c1, words[j+14], 9, 0xc33707d6)
    c1 = g(c1, d1, a, b1, words[j+3], 14, 0xf4d50d87); b1 = g(b1, c1, d1, a, words[j+8], 20, 0x455a14ed)
    a = g(a, b1, c1, d1, words[j+13], 5, 0xa9e3e905); d1 = g(d1, a, b1, c1, words[j+2], 9, 0xfcefa3f8)
    c1 = g(c1, d1, a, b1, words[j+7], 14, 0x676f02d9); b1 = g(b1, c1, d1, a, words[j+12], 20, 0x8d2a4c8a)
    a = h(a, b1, c1, d1, words[j+5], 4, 0xfffa3942); d1 = h(d1, a, b1, c1, words[j+8], 11, 0x8771f681)
    c1 = h(c1, d1, a, b1, words[j+11], 16, 0x6d9d6122); b1 = h(b1, c1, d1, a, words[j+14], 23, 0xfde5380c)
    a = h(a, b1, c1, d1, words[j+1], 4, 0xa4beea44); d1 = h(d1, a, b1, c1, words[j+4], 11, 0x4bdecfa9)
    c1 = h(c1, d1, a, b1, words[j+7], 16, 0xf6bb4b60); b1 = h(b1, c1, d1, a, words[j+10], 23, 0xbebfbc70)
    a = h(a, b1, c1, d1, words[j+13], 4, 0x289b7ec6); d1 = h(d1, a, b1, c1, words[j+0], 11, 0xeaa127fa)
    c1 = h(c1, d1, a, b1, words[j+3], 16, 0xd4ef3085); b1 = h(b1, c1, d1, a, words[j+6], 23, 0x04881d05)
    a = h(a, b1, c1, d1, words[j+9], 4, 0xd9d4d039); d1 = h(d1, a, b1, c1, words[j+12], 11, 0xe6db99e5)
    c1 = h(c1, d1, a, b1, words[j+15], 16, 0x1fa27cf8); b1 = h(b1, c1, d1, a, words[j+2], 23, 0xc4ac5665)
    a = i(a, b1, c1, d1, words[j+0], 6, 0xf4292244); d1 = i(d1, a, b1, c1, words[j+7], 10, 0x432aff97)
    c1 = i(c1, d1, a, b1, words[j+14], 15, 0xab9423a7); b1 = i(b1, c1, d1, a, words[j+5], 21, 0xfc93a039)
    a = i(a, b1, c1, d1, words[j+12], 6, 0x655b59c3); d1 = i(d1, a, b1, c1, words[j+3], 10, 0x8f0ccc92)
    c1 = i(c1, d1, a, b1, words[j+10], 15, 0xffeff47d); b1 = i(b1, c1, d1, a, words[j+1], 21, 0x85845dd1)
    a = i(a, b1, c1, d1, words[j+8], 6, 0x6fa87e4f); d1 = i(d1, a, b1, c1, words[j+4], 10, 0xfe2ce6e0)
    c1 = i(c1, d1, a, b1, words[j+15], 15, 0xa3014314); b1 = i(b1, c1, d1, a, words[j+11], 21, 0x4e0811a1)
    a = i(a, b1, c1, d1, words[j+6], 6, 0xf7537e82); d1 = i(d1, a, b1, c1, words[j+13], 10, 0xbd3af235)
    c1 = i(c1, d1, a, b1, words[j+2], 15, 0x2ad7d2bb); b1 = i(b1, c1, d1, a, words[j+9], 21, 0xeb86d391)
    a0 += a; b0 += b1; c0 += c1; d0 += d1
  }

  function toHex(n: number) {
    let s = ''
    for (let j = 0; j < 4; j++) s += ((n >>> (j * 8)) & 0xff).toString(16).padStart(2, '0')
    return s
  }
  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0)
}

async function buildSign(keyword: string): Promise<string> {
  const version = await getVersion()
  if (!version || !cachedPaddedVersion) throw new Error('Version not available')
  const ts = await getServerTimestamp()
  const raw = `${HOST}|${cachedPaddedVersion}|${String(ts).slice(0, 9)}|${encodeURIComponent(keyword)}`
  console.log(`[gdstudio] sign raw: ${raw}`)
  const hash = md5(raw)
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

function buildMusicInfo(item: Record<string, unknown>, source: string) {
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
      qualitys: { '128k': { sizeStr: null }, '192k': { sizeStr: null }, '320k': { sizeStr: null }, flac: { sizeStr: null }, flac24bit: { sizeStr: null } },
      _picId: item.pic_id ? String(item.pic_id) : undefined,
      createTime: now,
      updateTime: now,
      posTime: now,
    },
  }
}

// ========== POST 请求辅助 ==========

async function apiPost(data: Record<string, string | number | null | undefined>) {
  const body = buildQuery(data)
  const resp = await apiRequest(BASE_URL, {
    method: 'POST',
    timeout: 15000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://music.gdstudio.org/',
    },
    body,
  })
  return typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
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
    Object.keys(searchCache).forEach((k) => {
      if (k !== '_key') delete searchCache[+k as unknown as number]
    })
  }

  let batch = searchCache[batchIndex]
  if (!batch) {
    const apiPage = batchIndex + 1
    const queryName = artist ? name + ' ' + artist : name
    const sign = await buildSign(queryName)

    let rawList: Record<string, unknown>[] = []
    for (let retry = 0; retry < 5; retry++) {
      try {
        const data = await apiPost({
          types: 'search',
          source,
          name: queryName,
          pages: String(apiPage),
          count: String(fetchCount),
          s: sign,
        })

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

    // 直接构建所有 item，无音质探测
    const items: Record<number, ReturnType<typeof buildMusicInfo>> = {}
    for (let i = 0; i < rawList.length; i++) {
      items[i] = buildMusicInfo(rawList[i], source)
    }

    batch = { rawList, items, total }
    searchCache[batchIndex] = batch
  }

  const startIdx = offsetInBatch * limit
  const endIdx = Math.min(startIdx + limit, batch.rawList.length)

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
  const allBrs = [999, 740, 320, 192, 128]
  for (let i = 0; i < allBrs.length; i++) {
    if (brsToTry.indexOf(allBrs[i]) === -1) brsToTry.push(allBrs[i])
  }

  let lastError: Error | null = null
  const sign = await buildSign(source + '|' + musicId)

  for (let j = 0; j < brsToTry.length; j++) {
    const br = brsToTry[j]
    try {
      const data = await apiPost({
        types: 'url',
        source,
        id: musicId,
        br: String(br),
        s: sign,
      })

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
      const queryName = String(musicInfo.name || '')
      const sign = await buildSign(queryName)
      const sData = await apiPost({
        types: 'search',
        source,
        name: queryName,
        count: '1',
        pages: '1',
        s: sign,
      })
      const list = Array.isArray(sData) ? sData : []
      if (list.length && list[0].pic_id) picId = String(list[0].pic_id)
    } catch (_err) { /* ignore */ }
  }

  if (!picId) throw new Error('No pic_id found')

  const sign = await buildSign(picId)
  const data = await apiPost({
    types: 'pic',
    source,
    id: picId,
    size: '500',
    s: sign,
  })

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

  const sign = await buildSign(String(lyricId))

  try {
    const data = await apiPost({
      types: 'lyric',
      source,
      id: String(lyricId),
      s: sign,
    })

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
