import { app, command, configuration, console } from './shared/hostApi'

// Any Listen closes an input dialog only when validateInput returns an empty result.
// A non-breaking space keeps the same dialog open without showing a validation hint.
const KEEP_DIALOG_OPEN = '\u00a0'

let activeDialog: Promise<void> | undefined

const parseInstruction = (instruction: string): Record<string, unknown> | undefined => {
  const separator = instruction.indexOf(':')
  if (separator < 0) return
  const name = instruction.slice(0, separator).trim()
  const value = instruction.slice(separator + 1).trim()

  switch (name) {
    case 'useOrgSource':
      if (value !== 'true' && value !== 'false') return
      return { useOrgSource: value === 'true' }
    case 'setSignServer':
      return { signServerUrl: value }
    case 'setSignToken':
      return { signKey: value }
  }
}

const saveInstruction = async (instruction: string): Promise<string> => {
  const update = parseInstruction(instruction)
  if (!update) return '无效指令'

  try {
    await configuration.setConfigs(update)
  } catch {
    console.error('[gdstudio] Failed to save maintenance instruction')
    return '保存失败，请重试'
  }

  void app.showMessage('已保存', { type: 'info' }).catch(() => {})
  return KEEP_DIALOG_OPEN
}

const openMaintenanceDialog = async () => {
  let pendingSave: Promise<unknown> = Promise.resolve()
  try {
    await app.showInputDialog({
      value: '',
      validateInput: (instruction: string) => {
        const result = pendingSave.then(() => saveInstruction(instruction))
        pendingSave = result.catch(() => {})
        return result
      },
    })
  } catch (error) {
    if ((error as Error)?.message === 'canceled') return
    console.error('[gdstudio] Failed to open maintenance dialog')
  }
}

export const setupSignServerSettingsCommand = async () => {
  await command.registerCommand('configureSignServer', () => {
    activeDialog ??= openMaintenanceDialog().finally(() => {
      activeDialog = undefined
    })
    return activeDialog
  })
}
