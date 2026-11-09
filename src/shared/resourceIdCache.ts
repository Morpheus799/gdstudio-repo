import { console, storage } from './hostApi'

export interface ResourceIds {
  picId: string | null
  lyricId: string | null
}

const resourceIds = new Map<string, ResourceIds>()

const cachePath = (source: string, musicId: string) =>
  `resource-ids/v1/${encodeURIComponent(source)}/track-${encodeURIComponent(musicId)}.json`

const isResourceId = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.trim().length > 0)

export async function getCachedResourceIds(source: string, musicId: string): Promise<ResourceIds | null> {
  const key = JSON.stringify([source, musicId])
  const cached = resourceIds.get(key)
  if (cached) return { ...cached }

  try {
    const path = cachePath(source, musicId)
    if (!(await storage.fileExists(path))) return null
    const data: unknown = JSON.parse(await storage.readFile(path, 'utf-8'))
    if (!data || typeof data !== 'object') return null
    const entry = data as Record<string, unknown>
    if (entry.version !== 1 || entry.source !== source || entry.musicId !== musicId ||
        !isResourceId(entry.picId) || !isResourceId(entry.lyricId)) return null

    const ids = { picId: entry.picId, lyricId: entry.lyricId }
    resourceIds.set(key, ids)
    return { ...ids }
  } catch (err) {
    console.warn(`[gdstudio] Failed to read resource ID cache for ${source}:${musicId}:`, err)
    return null
  }
}

export async function cacheResourceIds(source: string, musicId: string, ids: ResourceIds): Promise<void> {
  resourceIds.set(JSON.stringify([source, musicId]), { ...ids })
  try {
    await storage.writeFile(cachePath(source, musicId), JSON.stringify({ version: 1, source, musicId, ...ids }))
  } catch (err) {
    console.warn(`[gdstudio] Failed to save resource ID cache for ${source}:${musicId}:`, err)
  }
}
