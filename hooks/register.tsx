import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { AgentStat, TaskRow } from '../types'

const PANE = 'scouter'
const SWEET_SPOT = 50

const agents = atom({ plugin: 'scouter', key: 'agents' } as const, {} as Record<string, AgentStat>)
const tasks = atom({ plugin: 'scouter', key: 'tasks' } as const, {} as Record<string, TaskRow>)
const tick = atom({ plugin: 'scouter', key: 'tick' } as const, 0)
const breached = atom({ plugin: 'scouter', key: 'breached' } as const, false)

// ponytail: approximate per-MTok USD prices; bump if Anthropic pricing moves.
const PRICES: Record<string, { in: number; out: number; cacheR: number; cacheW: number }> = {
  opus:   { in: 15,  out: 75, cacheR: 1.5,  cacheW: 18.75 },
  sonnet: { in: 3,   out: 15, cacheR: 0.3,  cacheW: 3.75 },
  haiku:  { in: 0.8, out: 4,  cacheR: 0.08, cacheW: 1 },
  fable:  { in: 15,  out: 75, cacheR: 1.5,  cacheW: 18.75 },
}
const priceFor = (model: string) => {
  const m = model.toLowerCase()
  if (m.includes('opus')) return PRICES.opus!
  if (m.includes('haiku')) return PRICES.haiku!
  if (m.includes('fable')) return PRICES.fable!
  return PRICES.sonnet!
}
const costOf = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }, model: string) => {
  const p = priceFor(model)
  return (u.input_tokens * p.in + u.output_tokens * p.out + u.cache_read_input_tokens * p.cacheR + u.cache_creation_input_tokens * p.cacheW) / 1_000_000
}

const bar = (pct: number, width = 18) => {
  const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '█'.repeat(fill) + '░'.repeat(width - fill)
}
const barColor = (pct: number) => (pct >= 80 ? 'red' : pct >= SWEET_SPOT ? 'yellow' : 'green')
const wallName = (pct: number) => (pct >= 80 ? 'WALL ROSE' : 'WALL MARIA')
const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{6,8}$/, '')

// --- background tasks (shells / monitors / workflows / subagents) ---------
const TERMINAL = new Set(['completed', 'failed', 'done', 'stopped', 'cancelled', 'canceled', 'deleted', 'error'])
const isLive = (status: string | undefined) => !TERMINAL.has((status ?? '').toLowerCase())
const clip = (s: string, n = 44) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p
// "cd /long/path && cmd 2>&1" → "path › cmd"; a bare command is left as-is (sans 2>&1).
const prettyCmd = (cmd: string) => {
  const t = cmd.replace(/\s*2>&1\s*$/, '').trim()
  const m = t.match(/^cd\s+('([^']*)'|"([^"]*)"|(\S+))\s*&&\s*([\s\S]+)$/)
  return m ? `${base(m[2] ?? m[3] ?? m[4] ?? '')} › ${m[5]!.trim()}` : t
}
const iconOf = (type: string) =>
  type === 'shell' ? '$' : type === 'subagent' ? '⚔' : type === 'workflow' ? '⚙' : type === 'monitor' ? '◉' : '●'

// Stop a running task/agent by id and drop it from the panel optimistically.
const stopTask = async ($: any, id: string) => {
  try { await $.tool.call({ tool: 'TaskStop', task_id: id }) } catch {}
  try { await update($, tasks, (m: Record<string, TaskRow>) => { const n = { ...m }; delete n[id]; return n }) } catch {}
}

const checkBreach = async ($: any) => {
  const { context } = await $.session.usage()
  const pct = context.percent ?? 0
  const was = await read($, breached)
  if (pct >= SWEET_SPOT && !was) {
    await update($, breached, () => true)
    $.ui.status(`⚔ ${pct}% · ${wallName(pct)} BREACHED`)
    $.ui.toast(`⚔ ${wallName(pct)} BREACHED (${pct}%) — titans in the walls; hand off or wrap this session`, { timeoutMs: 8000 })
    try { await $.audio.play({ asset: 'fx/breach.wav' }) } catch {}
  } else if (pct < SWEET_SPOT && was) {
    await update($, breached, () => false)
    $.ui.status(undefined)
  }
}

const render = async ($: any, e: any) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  await read($, tick) // subscribe to the 1s heartbeat so elapsed/context redraw
  const sid = await $.session.id()
  const { context, cost } = await $.session.usage()
  const pct = context.percent ?? 0
  const stats = await read($, agents)
  const taskMap = await read($, tasks)
  const now = Date.now()
  const live = (await $.agent.list()).filter((a: any) =>
    a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
  // shells captured from Bash tool.call (see below); subagents are shown live above.
  const bg = Object.values(taskMap).filter((t: TaskRow) => t.type !== 'subagent' && isLive(t.status))
  const over = pct >= SWEET_SPOT

  const Stop = ({ id }: { id: string }) => (
    <Button key={id} role="dismiss" onPress={() => void stopTask($, id)}><Text color="red">✕ recall</Text></Button>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={over ? 'red' : 'green'} paddingX={2} paddingY={1}>
      <Text color="green" bold>⟪ ⊹ SURVEY CORPS ⊹ ⟫</Text>
      <Text dimColor>recon · context watch</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="green">BREACH  </Text>
          <Text color={barColor(pct)} bold>{bar(pct)}</Text>
          <Text color={barColor(pct)} bold>  {pct}%</Text>
        </Text>
        <Text dimColor>{context.tokens ?? 0} / {context.window} tok  ·  ${(cost?.usd ?? 0).toFixed(2)}</Text>
      </Box>

      {over && (
        <Box marginTop={1}>
          <Text color="red" bold>⚔ {wallName(pct)} BREACHED — fall back or hand off</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text><Text color="cyan">session  </Text><Text dimColor>{sid}</Text></Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="green">── scouts deployed · ✕ to recall ──</Text>
        {live.length === 0 && <Text dimColor>  none in the field</Text>}
        {live.map((a: any) => {
          const st: AgentStat | undefined = stats[a.id]
          const model = st ? shortModel(st.model) : '—'
          return (
            <Box key={a.id} marginTop={1}>
              <Box flexDirection="column" flexGrow={1}>
                <Text color="green" bold>⚔ {a.name ?? a.type}</Text>
                <Text dimColor>   {model} · r{st?.turns ?? 0} · {st ? fmtDur(now - st.startedAt) : '0:00'} · ≈${(st?.costUsd ?? 0).toFixed(2)}</Text>
              </Box>
              <Stop id={a.id} />
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="green">── tasks running · ✕ to recall ──</Text>
        {bg.length === 0 && <Text dimColor>  none in the field</Text>}
        {bg.map((t: TaskRow) => (
          <Box key={t.id} marginTop={1}>
            <Box flexDirection="column" flexGrow={1}>
              <Text color="green" bold>{iconOf(t.type)} {clip(t.type === 'shell' ? prettyCmd(t.label) : t.label)}</Text>
              <Text dimColor>   {t.type} · {t.status}</Text>
            </Box>
            <Stop id={t.id} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'scouter', description: 'Toggle the Scouter context/agent panel' })
    void $.ui.open({ id: PANE, title: 'SCOUTER' })
    $.clock.every(1000, async () => {
      try {
        await update($, tick, n => (n + 1) % 1_000_000)
        await checkBreach($)
      } catch {}
    })
    return next(e)
  })

  on('command.run', { command: 'scouter' }, async $ => {
    await $.ui.open({ id: PANE, title: 'SCOUTER' })
    return { text: 'Scouter panel opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.agentId) {
        const id = r.agentId
        await update($, agents, m => ({
          ...m,
          [id]: { id, type: e.subagentType ?? 'agent', model: r.model ?? 'model', description: e.description ?? '', startedAt: Date.now(), turns: 0, costUsd: 0 },
        }))
      }
    } catch {}
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      const id = (e as any).agentId
      const usage = r.usage ?? (e as any).usage
      if (id && usage) {
        await update($, agents, m => {
          const a = m[id]
          return a ? { ...m, [id]: { ...a, turns: a.turns + 1, costUsd: a.costUsd + costOf(usage, usage.model ?? a.model) } } : m
        })
      }
    } catch {}
    return r
  })

  // Live source for shells: a Bash command started in the background resolves with a
  // `backgroundTaskId` (the same id TaskStop takes). Subagents self-report via
  // $.agent.list(); the mod API exposes no live list of other background tasks.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    try {
      const id = (r as any).result?.backgroundTaskId
      if (id) {
        const label = (e as any).command ?? 'shell'
        await update($, tasks, m => ({ ...m, [id]: { id, type: 'shell', status: 'running', label } }))
      }
    } catch {}
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => render($, e))
}
