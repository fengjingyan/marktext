import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  enterSourceMode,
  exitSourceMode,
  expectNoRendererErrors,
  launchElectron,
  launchWithMarkdown,
  waitForEditor
} from './helpers'

const MARKDOWN = '# Heading\n\nParagraph with **bold** text.\n\n- First\n- Second\n\n```js\nconst a = 1\nconst b = 2\n```\n'

test.describe('Rendered editor line numbers', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(MARKDOWN, {
      preferences: { editorLineNumbers: false, codeBlockLineNumbers: false, language: 'en' },
      suppressErrorDialog: true
    })
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test.afterEach(async() => {
    await expectNoRendererErrors(app)
  })

  test('settings toggle updates the gutter independently of code blocks and source mode', async() => {
    await expect(page.locator('.editor-line-numbers')).toHaveCount(0)
    const windowPromise = app.waitForEvent('window')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('app-create-settings-window'))
    const settings = await windowPromise
    await settings.waitForSelector('.pref-container')
    await settings.evaluate(() => { location.hash = '#/preference/editor' })
    const toggle = settings.locator('#setting-editorLineNumbers .el-switch')
    await expect(toggle).not.toHaveClass(/is-checked/)
    await toggle.click()
    const labels = page.locator('.editor-line-numbers span')
    await expect.poll(() => labels.allTextContents()).toEqual(['1', '2', '3', '4', '5', '6'])
    await expect(page.locator('.mu-code-block')).not.toHaveClass(/mu-line-numbers/)
    await settings.close()

    await enterSourceMode(page, app)
    await expect(page.locator('.editor-line-numbers')).toHaveCount(0)
    await exitSourceMode(page, app)
    await expect(labels).toHaveCount(6)

    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { codeBlockLineNumbers: true })
    })
    await expect(page.locator('.mu-code-block')).toHaveClass(/mu-line-numbers/)
    await expect(labels).toHaveCount(6)

    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineNumbers: false })
    })
    await expect(page.locator('.editor-line-numbers')).toHaveCount(0)
    await expect(page.locator('.mu-code-block')).toHaveClass(/mu-line-numbers/)
  })

  test('the preference survives restarting Electron', async() => {
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineNumbers: true })
    })
    await expect(page.locator('.editor-line-numbers span')).toHaveCount(6)
    const userDataDir = await app.evaluate(({ app }) => app.getPath('userData'))
    await expectNoRendererErrors(app)
    await app.close()
    const relaunched = await launchElectron([], { userDataDir, suppressErrorDialog: true })
    app = relaunched.app
    page = relaunched.page
    await waitForEditor(page)
    await expect(page.locator('.editor-line-numbers span')).toHaveCount(6)
  })

  test('numbers follow edits, scrolling and wrapping', async() => {
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineNumbers: true })
    })
    await enterSourceMode(page, app)
    await page.evaluate(() => {
      const cm = document.querySelector('.source-code .CodeMirror') as Element & {
        CodeMirror: { setValue(value: string): void }
      }
      cm.CodeMirror.setValue(Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n'))
    })
    await exitSourceMode(page, app)
    const editor = page.locator('.editor-component')
    await editor.evaluate((host) => { host.scrollTop = 0 })
    await expect(page.locator('.editor-line-numbers span').first()).toHaveText('1')
    await editor.evaluate((host) => { host.scrollTop = 300 })
    await expect.poll(async() => Number(await page.locator('.editor-line-numbers span').first().textContent())).toBeGreaterThan(1)
    const alignment = await page.evaluate(() => {
      const label = document.querySelector('.editor-line-numbers span')
      if (!label) throw new Error('No visible line number after scrolling')
      const index = Number(label.textContent) - 1
      const content = document.querySelectorAll('.editor-component .mu-content')[index]
      const range = document.createRange()
      range.selectNodeContents(content)
      return Math.abs(label.getBoundingClientRect().top - range.getClientRects()[0].top)
    })
    expect(alignment).toBeLessThan(2)

    await editor.evaluate((host) => { host.scrollTop = 0 })
    const first = page.locator('.editor-component .mu-paragraph-content').first()
    await first.click()
    await page.keyboard.press('Home')
    await page.keyboard.insertText('A long line that wraps without adding a logical line number. '.repeat(20))
    const second = page.locator('.editor-component .mu-paragraph-content').nth(1)
    await expect(second).toHaveText('Paragraph 2')
    await expect(page.locator('.editor-line-numbers span').nth(1)).toHaveText('2')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(page.locator('.editor-component .mu-paragraph-content')).toHaveCount(51)
    await expect(page.locator('.editor-line-numbers span').first()).toHaveText('1')
    await expect(page.locator('.editor-line-numbers span').nth(1)).toHaveText('2')
  })

  test('the gutter stays beside the text column through outline and width changes', async() => {
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineNumbers: true })
    })
    const expectTextColumnGutter = async() => {
      await expect.poll(() => page.evaluate(() => {
        const gutter = document.querySelector('.editor-line-numbers')?.getBoundingClientRect()
        const column = document.querySelector('.editor-component .mu-container')
        const editor = document.querySelector('.editor-component')?.getBoundingClientRect()
        if (!gutter || !column || !editor) return null
        const columnBounds = column.getBoundingClientRect()
        const textLeft = columnBounds.left + parseFloat(getComputedStyle(column).paddingLeft)
        return {
          insideEditor: gutter.left >= editor.left && gutter.right < editor.right,
          columnOffset: Math.round(gutter.left - columnBounds.left),
          nearText: textLeft - gutter.right > 0 && textLeft - gutter.right <= 64
        }
      })).toEqual({ insideEditor: true, columnOffset: 0, nearText: true })
    }
    const editorWindow = await app.browserWindow(page)
    await editorWindow.evaluate(window => window.setContentSize(1440, 900))
    await expectTextColumnGutter()
    const outline = page.locator('.document-outline')
    await outline.locator('.outline-toggle').click()
    await expect(outline).not.toHaveClass(/is-expanded/)
    await expectTextColumnGutter()
    await editorWindow.evaluate(window => window.setContentSize(1000, 800))
    await expectTextColumnGutter()
    await outline.locator('.outline-toggle').click()
    await expect(outline).toHaveClass(/is-expanded/)
    await expectTextColumnGutter()
    await page.evaluate(() => {
      window.electron.ipcRenderer.send('mt::set-user-preference', { editorLineWidth: '90%', tocPosition: 'right' })
    })
    await expect(outline).toHaveClass(/is-right/)
    await expectTextColumnGutter()
  })
})
