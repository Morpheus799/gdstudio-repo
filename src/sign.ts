// GD音乐台主 API 的 s 签名(接口不带 s 时返回空数组/401)。
// 算法: s = md5(time[:9] + '|' + hostname + '|' + siteVersion + '|' + urlEncode(value)) 的后 8 位大写十六进制。
// time 来自 /time 端点(服务器 unix 时间,约 20 秒有效); hostname/version 为服务端白名单值。
// 与官网 js/crc32.min.js 的行为对照得出;站点 player.js 升级 version 后需同步更新 SIGN_SITE_VERSION。
export const SIGN_SITE_HOST = 'music.gdstudio.org'
export const SIGN_SITE_VERSION = '20260925'

/** 与官网 urlEncode 等价:encodeURIComponent 后再转义 ! ' ( ) * */
export function urlEncodeSignValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export function calcSign(time: string, value: string): string {
  const msg = `${time.slice(0, 9)}|${SIGN_SITE_HOST}|${SIGN_SITE_VERSION}|${urlEncodeSignValue(value)}`
  return md5Hex(msg).toUpperCase().slice(-8)
}

/**
 * 定制 MD5(与官网 js/crc32.min.js 完全一致):
 * 标准 RFC1321 结构,仅第 29 步轮常量被改为 0xfcfea3f8(标准值 0xfcefa3f8 的 ef/fe 互换)。
 * 该算法被官网播放器与其服务端同时校验,标准 MD5 在官网域会返回 401。
 * 输入为 ASCII 签名消息(urlEncode 后必为 ASCII,多字节分支仅作兜底)。
 */
export function md5Hex(input: string): string {
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 0; i < 4; i++) bytes.push((bitLen >>> (8 * i)) & 0xff)
  const hi = Math.floor(bitLen / 0x100000000)
  for (let i = 0; i < 4; i++) bytes.push((hi >>> (8 * i)) & 0xff)

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const k: number[] = []
  for (let i = 0; i < 64; i++) k.push((Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0))
  k[29] = 0xfcfea3f8 | 0 // 官网站点唯一的常量改动(标准 K[29]=0xfcefa3f8)
  let a = 0x67452301
  let b = 0xefcdab89 | 0
  let c = 0x98badcfe | 0
  let d = 0x10325476 | 0

  for (let off = 0; off < bytes.length; off += 64) {
    const m: number[] = []
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4
      m.push((bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0)
    }
    let aa = a
    let bb = b
    let cc = c
    let dd = d
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (bb & cc) | (~bb & dd)
        g = i
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = bb ^ cc ^ dd
        g = (3 * i + 5) % 16
      } else {
        f = cc ^ (bb | ~dd)
        g = (7 * i) % 16
      }
      f = (f + aa + k[i] + m[g]) | 0
      aa = dd
      dd = cc
      cc = bb
      bb = (bb + ((f << shifts[i]) | (f >>> (32 - shifts[i])))) | 0
    }
    a = (a + aa) | 0
    b = (b + bb) | 0
    c = (c + cc) | 0
    d = (d + dd) | 0
  }

  const hex = (n: number): string =>
    [0, 8, 16, 24].map((sh) => ((n >>> sh) & 0xff).toString(16).padStart(2, '0')).join('')
  return hex(a) + hex(b) + hex(c) + hex(d)
}
