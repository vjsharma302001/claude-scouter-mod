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

const run = async ($: any, on: any, percent: number) => {
  on('session.id', () => ({ value: SID }))
  on('session.usage', () => ({
    value: { context: { percent, tokens: 100000, window: 200000 }, cost: { usd: 1.23 } },
  }))
  on('agent.list', () => ({ value: [] }))
  return $.ui.mount(PANE)
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
