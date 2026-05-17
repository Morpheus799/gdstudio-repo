var API = require('any-listen')

var BASE_URL = 'https://music-api.gdstudio.xyz/api.php'

// ========== 工具函数 ==========

function buildQuery(obj) {
  var parts = []
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      var val = obj[key]
      if (val != null) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(val)))
      }
    }
  }
  return parts.join('&')
}

/**
 * Quality → br 参数映射
 * master/dolby 是主程序设置中超出 API 上限的两档 → 均映射为 999
 */
function qualityToBr(quality) {
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

function brToQuality(br) {
  if (br >= 999) return 'flac24bit'
  if (br >= 740) return 'flac'
  if (br >= 320) return '320k'
  if (br >= 192) return '192k'
  return '128k'
}

/**
 * 根据实际获取到的 br 值，构建 qualitys 对象
 * 返回该 br 值对应品质及以下所有更低品质
 */
function buildQualitysFromBr(br) {
  var qs = {}
  // 只要 API 返回了 URL，至少是 128k 级别
  qs['128k'] = { sizeStr: null }
  if (br >= 192)  qs['192k'] = { sizeStr: null }
  if (br >= 320)  qs['320k'] = { sizeStr: null }
  if (br >= 740)  qs.flac = { sizeStr: null }
  if (br >= 999)  qs.flac24bit = { sizeStr: null }
  return qs
}

function formatInterval(seconds) {
  if (!seconds || seconds <= 0) return null
  var h = Math.floor(seconds / 3600)
  var m = Math.floor((seconds % 3600) / 60)
  var s = Math.floor(seconds % 60)
  if (h > 0) {
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  }
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function parseArtist(artist) {
  if (Array.isArray(artist)) return artist.join('、')
  if (artist == null) return ''
  return String(artist)
    .split(/[、&_;/,，|]/)
    .map(function (s) { return s.trim() })
    .filter(Boolean)
    .join('、')
}

/**
 * 探测某首歌曲的实际可用音质
 * 以 br=999 请求，API 自动返回最大可用品质
 */
async function detectQuality(source, musicId, songName) {
  API.logcat.debug('[' + source + '] detectQuality: id=' + musicId + ' name=' + songName)
  try {
    var qs = buildQuery({ types: 'url', source: source, id: musicId, br: '999' })
    var resp = await API.request(BASE_URL + '?' + qs, { method: 'GET', timeout: 8000 })
    var data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
    if (data && data.url) {
      var actualBr = data.br != null ? Number(data.br) : 128
      API.logcat.debug('[' + source + '] detectQuality OK: id=' + musicId + ' data.br=' + data.br + ' actualBr=' + actualBr)
      return actualBr
    }
    API.logcat.debug('[' + source + '] detectQuality no url, body keys: ' + (data ? Object.keys(data).join(',') : 'null'))
  } catch (err) {
    API.logcat.debug('[' + source + '] detectQuality error: ' + (err.message || err))
  }
  API.logcat.warn('[' + source + '] detectQuality failed, fallback to 128')
  return 128
}

function buildMusicInfo(item, source, actualBr) {
  var now = Date.now()
  var interval = null
  if (item.duration || item.interval) {
    var dur = Number(item.duration || item.interval)
    if (dur > 0) interval = formatInterval(dur)
  }

  return {
    id: String(item.id),
    name: String(item.name || ''),
    singer: parseArtist(item.artist),
    interval: interval,
    isLocal: false,
    meta: {
      musicId: String(item.id),
      albumName: String(item.album || ''),
      picUrl: null,
      source: source,
      qualitys: buildQualitysFromBr(actualBr),
      _picId: item.pic_id ? String(item.pic_id) : undefined,
      createTime: now,
      updateTime: now,
      posTime: now,
    },
  }
}

// ========== 资源操作 ==========

async function musicSearch(params) {
  var source = params.source
  var name = params.name
  var artist = params.artist
  var page = params.page || 1
  var limit = Math.min(params.limit || 20, 50)

  var qs = buildQuery({
    types: 'search',
    source: source,
    name: artist ? name + ' ' + artist : name,
    pages: String(page),
    count: String(limit),
  })

  var rawList = []
  var maxRetries = 5
  for (var retry = 0; retry < maxRetries; retry++) {
    try {
      var response = await API.request(BASE_URL + '?' + qs, { method: 'GET', timeout: 15000 })
      var data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body

      if (data && data.error) {
        API.logcat.warn('[' + source + '] search api error: ' + data.error)
        break
      }

      rawList = Array.isArray(data) ? data : []
      if (rawList.length > 0) break

      if (retry < maxRetries - 1) {
        API.logcat.warn('[' + source + '] search returned empty list, retry ' + (retry + 1) + '/' + maxRetries)
        // 等待一小段时间后重试
        await new Promise(function (resolve) { setTimeout(resolve, 300) })
      }
    } catch (err) {
      API.logcat.warn('[' + source + '] search attempt ' + (retry + 1) + ' failed: ' + (err.message || err))
      if (retry < maxRetries - 1) {
        await new Promise(function (resolve) { setTimeout(resolve, 500) })
      }
    }
  }

    // 并行探测每首歌的实际音质
    API.logcat.info('[' + source + '] search got ' + rawList.length + ' items, detecting qualities...')
    var qualityResults = await Promise.all(
      rawList.map(function (item) {
        return detectQuality(source, String(item.id), String(item.name || '')).catch(function (e) {
          API.logcat.warn('[' + source + '] detectQuality exception: ' + (e && e.message ? e.message : e))
          return 128
        })
      })
    )
    API.logcat.info('[' + source + '] quality results: ' + qualityResults.join(','))

    var resultList = rawList.map(function (item, idx) {
      var info = buildMusicInfo(item, source, qualityResults[idx])
      return info
    })

    // 抽样打印前3首的完整 meta.qualitys
    for (var si = 0; si < Math.min(3, resultList.length); si++) {
      var s = resultList[si]
      API.logcat.info('[' + source + '] SAMPLE[' + si + ']: id=' + s.id + ' name=' + s.name + ' qualitys=' + JSON.stringify(s.meta.qualitys) + ' source=' + s.meta.source)
    }

    return {
      list: resultList,
      total: rawList.length,
      page: page,
      limit: limit,
    }
}

async function musicUrl(params) {
  var source = params.source
  var musicInfo = params.musicInfo
  var quality = params.quality
  var musicId = String(musicInfo.id || (musicInfo.meta && musicInfo.meta.musicId) || '')

  var brsToTry = []
  if (quality) {
    var preferredBr = qualityToBr(quality)
    if (preferredBr) brsToTry.push(preferredBr)
  }
  var allBrs = [999, 740, 320, 192, 128]
  for (var i = 0; i < allBrs.length; i++) {
    if (brsToTry.indexOf(allBrs[i]) === -1) brsToTry.push(allBrs[i])
  }

  var lastError = null
  for (var j = 0; j < brsToTry.length; j++) {
    var br = brsToTry[j]
    try {
      var qs = buildQuery({ types: 'url', source: source, id: musicId, br: String(br) })
      var resp = await API.request(BASE_URL + '?' + qs, { method: 'GET', timeout: 15000 })
      var data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body

      if (data && data.url) {
        var actualBr = data.br != null ? Number(data.br) : br
        return { url: String(data.url), quality: brToQuality(actualBr) }
      }
    } catch (err) {
      lastError = err
      API.logcat.warn('[' + source + '] musicUrl br=' + br + ' failed: ' + (err.message || err))
    }
  }

  throw lastError || new Error('[' + source + '] No URL available for ' + musicId)
}

async function musicPic(params) {
  var source = params.source
  var musicInfo = params.musicInfo

  var picId = (musicInfo.meta && musicInfo.meta._picId) ? musicInfo.meta._picId : null

  if (!picId) {
    try {
      var sq = buildQuery({
        types: 'search', source: source,
        name: String(musicInfo.name || ''), count: '1', pages: '1',
      })
      var sResp = await API.request(BASE_URL + '?' + sq, { method: 'GET', timeout: 10000 })
      var sData = typeof sResp.body === 'string' ? JSON.parse(sResp.body) : sResp.body
      var list = Array.isArray(sData) ? sData : []
      if (list.length && list[0].pic_id) picId = String(list[0].pic_id)
    } catch (err) {
      API.logcat.warn('[' + source + '] musicPic fallback failed: ' + (err.message || err))
    }
  }

  if (!picId) throw new Error('[' + source + '] No pic_id found')

  var pq = buildQuery({ types: 'pic', source: source, id: picId, size: '500' })
  var resp = await API.request(BASE_URL + '?' + pq, { method: 'GET', timeout: 10000 })
  var data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body

  if (data && data.url) return String(data.url)
  throw new Error('[' + source + '] No pic URL for pic_id ' + picId)
}

async function musicLyric(params) {
  var source = params.source
  var musicInfo = params.musicInfo
  var lyricId = (musicInfo.meta && musicInfo.meta.musicId) ? musicInfo.meta.musicId : musicInfo.id

  var qs = buildQuery({ types: 'lyric', source: source, id: String(lyricId) })

  try {
    var resp = await API.request(BASE_URL + '?' + qs, { method: 'GET', timeout: 10000 })
    var data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body

    return {
      lyric: (data && data.lyric) ? String(data.lyric) : '',
      tlyric: (data && data.tlyric) ? String(data.tlyric) : null,
      rlyric: null, awlyric: null,
      name: String(musicInfo.name || ''),
      singer: String(musicInfo.singer || ''),
      interval: musicInfo.interval || null,
    }
  } catch (err) {
    API.logcat.warn('[' + source + '] musicLyric failed: ' + (err.message || err))
    return {
      lyric: '', tlyric: null, rlyric: null, awlyric: null,
      name: String(musicInfo.name || ''),
      singer: String(musicInfo.singer || ''),
      interval: musicInfo.interval || null,
    }
  }
}

API.registerResourceAction({
  musicSearch: musicSearch,
  musicUrl: musicUrl,
  musicPic: musicPic,
  musicLyric: musicLyric,
})

API.logcat.info('GD Studio extension loaded')
