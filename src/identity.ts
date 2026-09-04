export const gdSources = [
  ['netease', '网易云音乐'],
  ['kuwo', '酷我音乐'],
  ['joox', 'JOOX'],
  ['tencent', 'QQ音乐'],
  ['tidal', 'TIDAL'],
  ['qobuz', 'QOBUZ'],
  ['bilibili', '哔哩哔哩'],
  ['apple', 'Apple Music'],
  ['ytmusic', 'YouTube Music'],
  ['spotify', 'Spotify'],
] as const

export type GdSource = (typeof gdSources)[number][0]

const sourceSet = new Set<string>(gdSources.map(([source]) => source))

export const toHostSource = (source: GdSource) => `gd-${source}`

export const toGdSource = (source: string): GdSource | null => {
  const value = source.startsWith('gd-') || source.startsWith('gd_') ? source.slice(3) : source
  return sourceSet.has(value) ? (value as GdSource) : null
}

export const getGdSource = (source: string) => {
  const value = toGdSource(source)
  if (!value) throw new Error(`Unsupported GD source: ${source}`)
  return value
}

export const isLegacySource = (source: string) => sourceSet.has(source)

export const buildMusicId = (source: GdSource, rawId: string) => `gd:v1:${source}:${rawId}`

export const getRawMusicId = (musicInfo: Record<string, unknown>) => {
  const meta = musicInfo.meta as Record<string, unknown> | undefined
  if (typeof meta?.musicId === 'string' && meta.musicId) return meta.musicId
  return typeof musicInfo.id === 'string' || typeof musicInfo.id === 'number' ? String(musicInfo.id) : ''
}
