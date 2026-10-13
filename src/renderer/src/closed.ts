import type { Project, TerminalDef } from '@shared/types'
import { setState } from './store'

/** Something the user closed, with what is needed to bring it back. */
export type Closed =
  | { kind: 'terminal'; projectId: string; def: TerminalDef; layout: unknown | null }
  | { kind: 'project'; project: Project; index: number }

const MAX = 25
const stack: Closed[] = []

export function rememberClosed(item: Closed): void {
  stack.push(item)
  if (stack.length > MAX) stack.shift()
  setState({ closedCount: stack.length })
}

export function takeClosed(): Closed | undefined {
  const item = stack.pop()
  setState({ closedCount: stack.length })
  return item
}
