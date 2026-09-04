import changeLog from '../publish/changeLog.md?raw'
import { app, extensionVersion, storage } from './shared/hostApi'

const LAST_SHOWN_VERSION_PATH = 'update-notice/last-shown-version'

export const showUpdateNotice = async () => {
  const lastShownVersion = (await storage.fileExists(LAST_SHOWN_VERSION_PATH))
    ? await storage.readFile(LAST_SHOWN_VERSION_PATH, 'utf-8')
    : ''
  if (lastShownVersion === extensionVersion) return

  await app.showMessage(`${extensionVersion} 更新内容：\n\n${changeLog.trim()}`, {
    modal: true,
    type: 'info',
    textSelect: true,
  })
  await storage.writeFile(LAST_SHOWN_VERSION_PATH, extensionVersion)
}
