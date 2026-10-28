import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'scouter',
  component: 'Pane',
  requestId: 'scouter',
  surface: 'terminal',
  props: {
    title: 'SCOUTER',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SID = 'sess-abc-123'

const run = async ($: any, on: any, percent: number, breakdown?: unknown) => {
  on('session.id', () => ({ value: SID }))
  on('session.usage', () => ({
    value: { context: { percent, tokens: 100000, window: 200000, breakdown }, cost: { usd: 1.23 } },
  }))
  on('agent.list', () => ({ value: [] }))
  return $.ui.mount(PANE)
}

const BREAKDOWN = {
  rawMaxTokens: 1_000_000,
  categories: [
    { name: 'Messages', tokens: 101_400, color: 'claude', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 17_600, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Free space', tokens: 812_900, color: 'inactive', kind: 'free', isDeferred: false },
    { name: 'MCP tools', tokens: 154_100, color: 'inactive', kind: 'deferred', isDeferred: true },
    { name: 'Empty', tokens: 0, color: 'inactive', kind: 'used', isDeferred: false },
  ],
}

test('breach banner and session id at 61%', async ($, on) => {
  const ui = await run($, on, 61)
  expect(await ui.find({ type: 'Text', text: /WALL MARIA BREACHED/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: new RegExp(SID) })).toBeTruthy()
  await ui.unmount()
})

test('no breach banner at 20%', async ($, on) => {
  const ui = await run($, on, 20)
  expect(await ui.find({ type: 'Text', text: /WALL MARIA BREACHED/ })).toBeFalsy()
  await ui.unmount()
})

test('breakdown rows: used sorted desc, share of window, deferred marked', async ($, on) => {
  const ui = await run($, on, 15, BREAKDOWN)
  expect(await ui.find({ type: 'Text', text: /Messages/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /101\.4k/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /10\.1%/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Free space/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /MCP tools \(deferred\)/ })).toBeTruthy()
  // a zero-token row is dropped, not drawn as "0"
  expect(await ui.find({ type: 'Text', text: /Empty/ })).toBeFalsy()
  await ui.unmount()
})

test('no breakdown in the reply still renders the pane', async ($, on) => {
  const ui = await run($, on, 15)
  expect(await ui.find({ type: 'Text', text: /no reading/ })).toBeTruthy()
  await ui.unmount()
})
