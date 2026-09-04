import { gunzipSync } from 'fflate'

import { buildMusicId, gdSources, isLegacySource, toGdSource, toHostSource } from './identity'
import { app, command, console, dataConverter, player, storage } from './shared/hostApi'

const REPORT_PATH = 'migration/last-report.json'
const OUTPUT_NAME = 'any-listen.gdstudio-v1.migrated.json'

interface BackupFile {
  songlist?: {
    version?: number
    data?: ListData
  }
}

interface MusicInfo {
  id: string
  isLocal: boolean
  meta: {
    source: string
    musicId?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface MusicList {
  list: MusicInfo[]
  meta: {
    songCount: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface ListData {
  defaultList: MusicList
  loveList: MusicList
  userList: MusicList[]
}

interface MigrationReport {
  createdAt: number
  changed: number
  duplicates: number
  lists: number
  sources: Record<string, number>
}

let migrationPrompt: Promise<void> | undefined

const getBackupLists = (data: ListData) => [data.defaultList, data.loveList, ...data.userList]

const toBytes = (file: Uint8Array | string) => {
  if (typeof file !== 'string') return new Uint8Array(file)
  const bytes = new Uint8Array(file.length)
  for (let i = 0; i < file.length; i++) bytes[i] = file.charCodeAt(i)
  return bytes
}

const readBackup = async (path: string): Promise<BackupFile> => {
  // Any Listen currently returns a Latin-1 string for the "binary" format at runtime.
  const binaryFile: Uint8Array | string = await app.readOpenDialogFile(path, 'binary')
  const file = toBytes(binaryFile)
  const content = file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file) : file
  return JSON.parse(await dataConverter(content, 'utf-8')) as BackupFile
}

const migrateBackup = (backup: BackupFile) => {
  if (backup.songlist?.version !== 1 || !backup.songlist.data) {
    throw new Error('这不是受支持的 Any Listen 歌单备份')
  }

  const sourceCounts: Record<string, number> = {}
  let changed = 0
  let duplicates = 0
  const lists = getBackupLists(backup.songlist.data)

  for (const list of lists) {
    const ids = new Set<string>()
    const migrated: MusicInfo[] = []

    for (const music of list.list) {
      if (music.isLocal) {
        migrated.push(music)
        ids.add(music.id)
        continue
      }

      const source = toGdSource(music.meta.source)
      if (!source) {
        migrated.push(music)
        ids.add(music.id)
        continue
      }

      const rawId = String(music.meta.musicId || music.id)
      const id = buildMusicId(source, rawId)
      const hostSource = toHostSource(source)

      if (ids.has(id)) {
        duplicates++
        continue
      }

      ids.add(id)
      migrated.push({
        ...music,
        id,
        meta: {
          ...music.meta,
          source: hostSource,
          musicId: rawId,
          gdSource: source,
          gdIdentityVersion: 1,
        },
      })

      if (music.id !== id || music.meta.source !== hostSource) {
        changed++
        sourceCounts[source] = (sourceCounts[source] ?? 0) + 1
      }
    }

    list.list = migrated
    list.meta.songCount = migrated.length
  }

  return {
    report: {
      createdAt: Date.now(),
      changed,
      duplicates,
      lists: lists.length,
      sources: sourceCounts,
    } satisfies MigrationReport,
    backup,
  }
}

const reportText = (report: MigrationReport) => {
  const sourceLines = Object.entries(report.sources)
    .map(([source, count]) => `${source}: ${count}`)
    .join('\n')
  return `待转换歌曲：${report.changed}\n合并重复歌曲：${report.duplicates}\n扫描歌单：${report.lists}${sourceLines ? `\n\n${sourceLines}` : ''}`
}

const migrateSelectedBackup = async () => {
  const files = await app.showOpenDialog({
    title: '选择 Any Listen 歌单备份',
    filters: { 'Any Listen 备份': ['alcfg', 'json'] },
    canSelectFiles: true,
  })
  if (!files.length) return

  const { backup, report } = migrateBackup(await readBackup(files[0]))
  if (!report.changed && !report.duplicates) {
    await app.showMessage('备份中没有需要升级的 GD音乐台歌曲。', { modal: true, type: 'info' })
    return
  }

  const action = await app.showMessage(reportText(report), {
    modal: true,
    type: 'warning',
    buttons: [{ text: '生成迁移文件' }, { text: '取消' }],
  })
  if (action !== 0) return

  const saveOptions = {
    title: '保存迁移后的歌单备份',
    defaultFileName: OUTPUT_NAME,
    filters: { JSON: ['json'] },
    canSelectFolder: true,
  }
  const dir = await app.showSaveDialog(saveOptions)
  if (!dir) return

  const outputPath = await app.writeSaveDialogFile(dir, OUTPUT_NAME, JSON.stringify(backup))
  await storage.writeFile(REPORT_PATH, JSON.stringify(report, null, 2))
  await app.showMessage(
    `迁移文件已保存：${outputPath}\n\n请在 Any Listen 的“备份与恢复”中导入该文件，并选择完整覆盖本地歌单。更新数据后，建议清理一次缓存并清空旧播放队列。`,
    {
      modal: true,
      type: 'info',
    }
  )
}

export const runBackupMigration = async () => {
  try {
    await migrateSelectedBackup()
  } catch (err) {
    console.error('[gdstudio] Backup migration failed:', err)
    await app.showMessage(`迁移失败：${err instanceof Error ? err.message : String(err)}`, { modal: true, type: 'error' })
  }
}

const showLastReport = async () => {
  if (!(await storage.fileExists(REPORT_PATH))) {
    await app.showMessage('还没有生成过迁移报告。', { modal: true, type: 'info' })
    return
  }
  const report = JSON.parse(await storage.readFile(REPORT_PATH, 'utf-8')) as MigrationReport
  await app.showMessage(reportText(report), { modal: true, type: 'info', textSelect: true })
}

export const promptLegacyMigration = async () => {
  if (migrationPrompt) return migrationPrompt
  migrationPrompt = (async () => {
    if (typeof player?.playerAction === 'function') {
      await player.playerAction({ action: 'stop' }).catch(() => {})
    }
    const action = await app.showMessage('检测到旧版 GD音乐台歌曲。请导出 Any Listen 歌单备份，再由插件生成迁移文件。', {
      modal: true,
      type: 'warning',
      buttons: [{ text: '选择已导出的备份' }, { text: '查看导出步骤' }, { text: '关闭' }],
    })
    if (action === 0) await runBackupMigration()
    if (action === 1) {
      await app.showMessage(
        '请打开 Any Listen 设置，进入“备份与恢复”，导出包含歌单的 .alcfg 文件，然后运行“迁移旧版歌单数据”。',
        {
          modal: true,
          type: 'info',
        }
      )
    }
  })().finally(() => {
    migrationPrompt = undefined
  })
  return migrationPrompt
}

export const setupMigrationCommands = async () => {
  await command.registerCommand('migrateLegacyData', runBackupMigration)
  await command.registerCommand('showMigrationReport', showLastReport)
  console.log(`[gdstudio] Identity migration ready for ${gdSources.length} sources`)
}

export const shouldRejectLegacySource = (source: string) => isLegacySource(source)
