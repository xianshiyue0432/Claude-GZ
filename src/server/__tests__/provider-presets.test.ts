import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-presets-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('provider presets API', () => {
  test('GET /api/providers/presets returns the configured presets', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ presets: PROVIDER_PRESETS })
  })

  test('configured presets include built-in official and custom entries', () => {
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'official')).toBe(true)
    expect(PROVIDER_PRESETS.some((preset) => preset.id === 'custom')).toBe(true)
  })

  test('configured presets keep current default model ids aligned with official provider docs', () => {
    const deepseek = PROVIDER_PRESETS.find((preset) => preset.id === 'deepseek')
    const zhipu = PROVIDER_PRESETS.find((preset) => preset.id === 'zhipuglm')
    const kimi = PROVIDER_PRESETS.find((preset) => preset.id === 'kimi')
    const minimax = PROVIDER_PRESETS.find((preset) => preset.id === 'minimax')

    expect(deepseek?.defaultModels.main).toBe('deepseek-chat')
    expect(deepseek?.defaultModels.haiku).toBe('deepseek-chat')
    expect(zhipu?.defaultModels.main).toBe('glm-5.1')
    expect(zhipu?.defaultModels.haiku).toBe('glm-4.5-air')
    expect(zhipu?.defaultModels.sonnet).toBe('glm-5-turbo')
    expect(zhipu?.defaultModels.opus).toBe('glm-5.1')
    expect(kimi?.defaultModels.main).toBe('kimi-k2.6')
    expect(minimax?.defaultModels.main).toBe('MiniMax-M2.7')
  })

  test('GET and PUT /api/providers/settings read and write cc-haha settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5.1',
      },
      model: 'glm-5.1',
    }
    await fs.mkdir(path.join(tmpDir, 'cc-haha'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'cc-haha', 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getReq = makeRequest('GET', '/api/providers/settings')
    const getRes = await handleProvidersApi(getReq.req, getReq.url, getReq.segments)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual(initial)

    const updateBody = {
      model: 'kimi-k2.6',
      env: {
        ANTHROPIC_MODEL: 'kimi-k2.6',
      },
    }
    const putReq = makeRequest('PUT', '/api/providers/settings', updateBody)
    const putRes = await handleProvidersApi(putReq.req, putReq.url, putReq.segments)
    expect(putRes.status).toBe(200)

    const updatedRaw = await fs.readFile(path.join(tmpDir, 'cc-haha', 'settings.json'), 'utf-8')
    expect(JSON.parse(updatedRaw)).toEqual(updateBody)
  })
})
