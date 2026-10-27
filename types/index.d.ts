export type AgentStat = {
  id: string
  type: string
  model: string
  description: string
  startedAt: number
  turns: number
  costUsd: number
}

// A background task the session is running (shell / subagent / monitor / workflow),
// as captured from a Stop/SubagentStop event's `background_tasks` snapshot.
export type TaskRow = {
  id: string
  type: string
  status: string
  label: string
}

// A past session's recon log for the current folder: its id and ai-title.
export type SessionRow = {
  sid: string
  title: string
}

declare module 'claude-code' {
  interface PluginState {
    scouter: {
      agents: Record<string, AgentStat>
      tasks: Record<string, TaskRow>
      tick: number
      breached: boolean
      recent: SessionRow[]
    }
  }
}
