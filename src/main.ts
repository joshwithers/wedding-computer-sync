import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian'
import { WeddingComputerClient, ApiError } from './api'
import { SyncEngine, type Baseline } from './sync'

type WCSettings = {
  serverUrl: string
  token: string
  baseFolder: string
  autoSync: boolean
  intervalMinutes: number
}

const DEFAULT_SETTINGS: WCSettings = {
  serverUrl: 'https://wedding.computer',
  token: '',
  baseFolder: 'Wedding Computer',
  autoSync: true,
  intervalMinutes: 1,
}

type PersistedData = {
  settings: WCSettings
  baseline: Baseline
}

export default class WeddingComputerSyncPlugin extends Plugin {
  settings: WCSettings = DEFAULT_SETTINGS
  baseline: Baseline = {}
  private engine: SyncEngine | null = null
  private statusBar: HTMLElement | null = null
  private syncing = false
  private pushTimers = new Map<string, number>()

  async onload(): Promise<void> {
    await this.loadPersisted()

    this.addSettingTab(new WCSettingTab(this.app, this))
    this.statusBar = this.addStatusBarItem()
    this.setStatus('idle')

    this.addCommand({
      id: 'sync-now',
      name: 'Sync now',
      callback: () => void this.syncNow(true),
    })

    this.addRibbonIcon('refresh-cw', 'Wedding Computer: sync now', () => void this.syncNow(true))

    // Push local edits shortly after they happen
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) this.queuePush(file.path)
      })
    )
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile) this.queuePush(file.path)
      })
    )
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        const engine = this.getEngine()
        if (!engine) return
        if (engine.serverPath(oldPath) || (file instanceof TFile && engine.serverPath(file.path))) {
          new Notice(
            'Wedding Computer: renames do not sync — the original file will come back on the next sync. Rename contacts and weddings in the app instead.'
          )
        }
      })
    )

    // Periodic full sync + one shortly after startup
    this.registerInterval(
      window.setInterval(() => {
        if (this.settings.autoSync) void this.syncNow(false)
      }, Math.max(1, this.settings.intervalMinutes) * 60_000)
    )
    if (this.settings.autoSync && this.settings.token) {
      this.registerInterval(window.setTimeout(() => void this.syncNow(false), 3_000))
    }
  }

  onunload(): void {
    for (const timer of this.pushTimers.values()) window.clearTimeout(timer)
    this.pushTimers.clear()
  }

  getEngine(): SyncEngine | null {
    if (!this.settings.token) return null
    if (!this.engine) {
      this.engine = new SyncEngine(
        this.app,
        new WeddingComputerClient(this.settings.serverUrl, this.settings.token),
        this.settings.baseFolder,
        this.baseline,
        () => this.savePersisted()
      )
    }
    return this.engine
  }

  /** Settings changed — rebuild the engine with the new client/folder. */
  resetEngine(): void {
    this.engine = null
  }

  async syncNow(manual: boolean): Promise<void> {
    const engine = this.getEngine()
    if (!engine) {
      if (manual) new Notice('Wedding Computer: add your sync token in the plugin settings first.')
      return
    }
    if (this.syncing) return
    this.syncing = true
    this.setStatus('syncing')

    try {
      const stats = await engine.fullSync()
      const changed = stats.pulled + stats.pushed + stats.deleted
      this.setStatus('ok', `synced ${timeNow()}`)
      if (manual) {
        new Notice(
          `Wedding Computer: ${stats.pulled} pulled, ${stats.pushed} pushed` +
            (stats.conflicts ? `, ${stats.conflicts} conflicts` : '') +
            (stats.errors.length ? `, ${stats.errors.length} errors` : '')
        )
      } else if (stats.conflicts > 0) {
        new Notice(`Wedding Computer: ${stats.conflicts} sync conflict(s) — look for .conflict.md files.`)
      }
      if (stats.errors.length) {
        console.warn('[wedding-computer-sync] errors:', stats.errors)
        if (changed === 0) this.setStatus('error', `${stats.errors.length} errors`)
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 401
          ? 'sync token rejected'
          : err instanceof Error
            ? err.message
            : 'sync failed'
      this.setStatus('error', msg)
      if (manual) new Notice(`Wedding Computer: ${msg}`)
      console.error('[wedding-computer-sync]', err)
    } finally {
      this.syncing = false
    }
  }

  /** Debounce pushes per file so a burst of keystroke saves becomes one PUT. */
  private queuePush(vaultPath: string): void {
    const engine = this.getEngine()
    if (!engine || !this.settings.autoSync) return
    if (engine.isApplyingRemote(vaultPath)) return
    if (!engine.serverPath(vaultPath)) return

    const existing = this.pushTimers.get(vaultPath)
    if (existing) window.clearTimeout(existing)
    this.pushTimers.set(
      vaultPath,
      window.setTimeout(() => {
        this.pushTimers.delete(vaultPath)
        void engine
          .pushPath(vaultPath)
          .then((stats) => {
            if (stats && stats.pushed > 0) this.setStatus('ok', `synced ${timeNow()}`)
            if (stats?.errors.length) {
              new Notice(`Wedding Computer: ${stats.errors[0]}`)
            }
          })
          .catch((err) => console.error('[wedding-computer-sync] push failed:', err))
      }, 2_500)
    )
  }

  private setStatus(state: 'idle' | 'syncing' | 'ok' | 'error', detail?: string): void {
    if (!this.statusBar) return
    const label =
      state === 'idle'
        ? 'WC: not connected'
        : state === 'syncing'
          ? 'WC: syncing…'
          : state === 'ok'
            ? `WC: ${detail ?? 'synced'}`
            : `WC: ${detail ?? 'error'}`
    this.statusBar.setText(label)
  }

  // ── Persistence ──

  async loadPersisted(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<PersistedData>
    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }
    this.baseline = data.baseline ?? {}
  }

  async savePersisted(): Promise<void> {
    const data: PersistedData = { settings: this.settings, baseline: this.baseline }
    await this.saveData(data)
  }
}

function timeNow(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

class WCSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: WeddingComputerSyncPlugin
  ) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Your Wedding Computer instance.')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.serverUrl)
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim() || DEFAULT_SETTINGS.serverUrl
            this.plugin.resetEngine()
            await this.plugin.savePersisted()
          })
      )

    new Setting(containerEl)
      .setName('Sync token')
      .setDesc('Settings → Device sync → Generate sync token in Wedding Computer.')
      .addText((text) => {
        text.inputEl.type = 'password'
        text
          .setPlaceholder('paste your token')
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim()
            this.plugin.resetEngine()
            await this.plugin.savePersisted()
          })
      })

    new Setting(containerEl)
      .setName('Vault folder')
      .setDesc('Where contacts/ and weddings/ live in this vault. Leave empty for the vault root.')
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.baseFolder)
          .setValue(this.plugin.settings.baseFolder)
          .onChange(async (value) => {
            this.plugin.settings.baseFolder = value.trim().replace(/^\/+|\/+$/g, '')
            this.plugin.resetEngine()
            await this.plugin.savePersisted()
          })
      )

    new Setting(containerEl)
      .setName('Auto-sync')
      .setDesc('Pull and push automatically. Turn off to sync only via the command or ribbon icon.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
          this.plugin.settings.autoSync = value
          await this.plugin.savePersisted()
        })
      )

    new Setting(containerEl)
      .setName('Sync interval (minutes)')
      .setDesc('How often to run a full sync. Edits push within seconds regardless.')
      .addText((text) =>
        text.setValue(String(this.plugin.settings.intervalMinutes)).onChange(async (value) => {
          const n = parseInt(value, 10)
          this.plugin.settings.intervalMinutes = Number.isFinite(n) && n >= 1 ? n : 1
          await this.plugin.savePersisted()
        })
      )

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Checks the server URL and token.')
      .addButton((button) =>
        button.setButtonText('Test').onClick(async () => {
          try {
            const client = new WeddingComputerClient(
              this.plugin.settings.serverUrl,
              this.plugin.settings.token
            )
            const { vendor, files } = await client.listFiles()
            new Notice(`Connected to ${vendor} — ${files.length} files available.`)
          } catch (err) {
            new Notice(
              err instanceof ApiError && err.status === 401
                ? 'Token rejected. Generate one under Settings → Device sync in Wedding Computer.'
                : `Connection failed: ${err instanceof Error ? err.message : err}`
            )
          }
        })
      )

    new Setting(containerEl)
      .setName('Sync now')
      .addButton((button) =>
        button
          .setButtonText('Sync')
          .setCta()
          .onClick(() => void this.plugin.syncNow(true))
      )
  }
}
