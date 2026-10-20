/**
 * dsh-longtasks — 长线任务花名册（Host 半侧）。
 *
 * 一个长线任务 = 一条档案：名字、目标、状态、下一步、绑定的常驻会话、交接日志。
 * 会话本身由 DSH 持久化；档案把「哪个会话在负责哪件事」固定下来，于是隔天
 * 重开电脑可以从看板一键回到那个会话，而不是重新开一个、再解释一遍。
 * systemPrompt 段让任何新会话开工时就看见花名册，longtask 工具让模型自己
 * 维护交接（收工写 note，接手先 brief）。
 */

import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'longtasks'
export const inject = ['tools', 'systemPrompt']

export const STATUSES = ['active', 'waiting', 'done', 'archived']

const STATUS_LABEL = {
  active: '进行中',
  waiting: '等待中',
  done: '已完成',
  archived: '已归档',
}

const MAX_NAME = 120
const MAX_TEXT = 8000
const MAX_NOTE_CHARS = 8000
const MAX_NOTES = 200
const MAX_ROSTER_IN_PROMPT = 6
const MAX_BODY_BYTES = 512 * 1024

const TOOL_NAME = 'longtask'

/** 当前时间毫秒。单独包一层，便于测试替换。 */
function nowMs() {
  return Date.now()
}

/** 花名册文件位置：DSH_HOME/longtasks/roster.json，测试可用环境变量覆盖。 */
export function rosterFile() {
  const override = process.env.DSH_LONGTASKS_FILE
  if (typeof override === 'string' && override.trim().length > 0) return override
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'longtasks', 'roster.json')
}

function trimText(value, limit) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed
}

function newId() {
  return `lt-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** 规范时刻：支持毫秒数、ISO 字符串，非法值回落到 fallback。 */
function toMs(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function formatTime(ms) {
  const date = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 把外部读入的一条记录补全成规范形态；未知字段不保留。 */
export function normalizeEntry(raw) {
  const base = raw !== null && typeof raw === 'object' ? raw : {}
  const createdAt = toMs(base.createdAt, nowMs())
  const updatedAt = toMs(base.updatedAt, createdAt)
  const notes = Array.isArray(base.notes)
    ? base.notes.flatMap((note) => {
      if (note === null || typeof note !== 'object') return []
      const text = trimText(note.text, MAX_NOTE_CHARS)
      if (text === undefined) return []
      return [{ at: toMs(note.at, createdAt), text }]
    }).slice(-MAX_NOTES)
    : []
  return {
    id: trimText(base.id, 64) ?? newId(),
    name: trimText(base.name, MAX_NAME) ?? '未命名长线任务',
    goal: trimText(base.goal, MAX_TEXT) ?? '',
    status: STATUSES.includes(base.status) ? base.status : 'active',
    next: trimText(base.next, MAX_TEXT) ?? '',
    sessionId: trimText(base.sessionId, 200),
    cwd: trimText(base.cwd, 400),
    notes,
    createdAt,
    updatedAt,
  }
}

/**
 * 花名册存储：内存缓存 + 原子写（临时文件 + rename）。
 * 同步读写是刻意的——systemPrompt 提供者必须同步返回。
 */
export class Roster {
  constructor(file = rosterFile()) {
    this.file = file
    this.cache = null
    this.cacheStamp = null
    // 本实例删除过的 id：合并外部写入时不让他们复活。
    this.removed = new Set()
  }

  /** 当前文件的 mtime 戳；文件不存在记 0，读不到记 null（保留内存值）。 */
  stamp() {
    try {
      return statSync(this.file).mtimeMs
    } catch (error) {
      if (error?.code === 'ENOENT') return 0
      return null
    }
  }

  all() {
    const stamp = this.stamp()
    if (this.cache !== null && (stamp === null || stamp === this.cacheStamp)) return this.cache
    if (stamp === 0) {
      this.cache = []
      this.cacheStamp = 0
      return this.cache
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      this.cache = Array.isArray(parsed?.entries) ? parsed.entries.map(normalizeEntry) : []
    } catch (error) {
      // 读不动就先留证据：损坏文件备份成 .corrupt-<ts>，否则下一次写会把它覆盖掉。
      this.quarantine(error)
      if (this.cache === null) this.cache = []
    }
    this.cacheStamp = stamp
    return this.cache
  }

  /** 把无法解析的花名册复制一份留档，原文件留给下一次写入覆盖。 */
  quarantine(error) {
    try {
      const backup = `${this.file}.corrupt-${Date.now()}`
      copyFileSync(this.file, backup)
      console.warn(`[dsh-longtasks] 花名册无法解析，已备份到 ${backup}：${error?.message ?? String(error)}`)
    } catch (copyError) {
      console.warn(`[dsh-longtasks] 花名册无法解析且备份失败：${copyError?.message ?? String(copyError)}`)
    }
  }

  /** 直接读盘上的条目（绕过缓存），合并写入时用。 */
  readDisk() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed?.entries) ? parsed.entries.map(normalizeEntry) : []
    } catch {
      return []
    }
  }

  flush() {
    const local = this.all()
    const stamp = this.stamp()
    let entries = local
    if (stamp !== null && stamp !== this.cacheStamp) {
      // 载入之后盘上又变了（另一个 host 进程、手改文件）：按 id 合并，
      // updatedAt 较新的一方胜出，本实例删掉的 id 不复活。
      const byId = new Map()
      for (const entry of this.readDisk()) byId.set(entry.id, entry)
      for (const entry of local) {
        const other = byId.get(entry.id)
        if (other === undefined || entry.updatedAt >= other.updatedAt) byId.set(entry.id, entry)
      }
      for (const id of this.removed) byId.delete(id)
      entries = [...byId.values()]
      this.cache = entries
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.file)
    this.cacheStamp = this.stamp()
    this.removed.clear()
    return entries
  }

  visible({ includeArchived = false } = {}) {
    return this.all().filter((entry) => includeArchived || entry.status !== 'archived')
  }

  get(target) {
    const needle = typeof target === 'string' ? target.trim().toLowerCase() : ''
    if (needle.length === 0) return { error: '缺少 target（任务 id 或名字）' }
    const entries = this.all()
    const exact = entries.find(
      (entry) => entry.id.toLowerCase() === needle || entry.name.toLowerCase() === needle,
    )
    if (exact !== undefined) return { entry: exact }
    const partial = entries.filter(
      (entry) => entry.id.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle),
    )
    if (partial.length === 1) return { entry: partial[0] }
    if (partial.length > 1) {
      return {
        error: `target "${target}" 匹配到多个任务：${partial.map((entry) => `${entry.name}（${entry.id}）`).join('、')}，请改用 id`,
      }
    }
    return { error: `没有找到任务 "${target}"；先用 longtask list 查看现有档案` }
  }

  create(fields, facts = {}) {
    const name = trimText(fields.name, MAX_NAME)
    if (name === undefined) return { error: 'name 必填：给这条长线任务起一个能认出来的名字' }
    const duplicate = this.all().find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.status !== 'archived',
    )
    if (duplicate !== undefined) {
      return { error: `已存在同名任务「${duplicate.name}」（${duplicate.id}）；改名或直接 update 它` }
    }
    const at = nowMs()
    const entry = normalizeEntry({
      id: newId(),
      name,
      goal: fields.goal,
      status: fields.status,
      next: fields.next,
      sessionId: fields.sessionId ?? facts.sessionId,
      cwd: fields.cwd ?? facts.cwd,
      notes: [],
      createdAt: at,
      updatedAt: at,
    })
    this.all().push(entry)
    this.flush()
    return { entry }
  }

  update(target, patch) {
    const found = this.get(target)
    if (found.error !== undefined) return found
    const entry = found.entry
    let changed = false
    const nextName = trimText(patch.name, MAX_NAME)
    if (nextName !== undefined && nextName !== entry.name) {
      entry.name = nextName
      changed = true
    }
    if (typeof patch.goal === 'string' && patch.goal.trim() !== entry.goal) {
      entry.goal = patch.goal.trim().slice(0, MAX_TEXT)
      changed = true
    }
    if (typeof patch.next === 'string' && patch.next.trim() !== entry.next) {
      entry.next = patch.next.trim().slice(0, MAX_TEXT)
      changed = true
    }
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) {
        return { error: `status 只能是 ${STATUSES.join(' / ')}` }
      }
      if (patch.status !== entry.status) {
        entry.status = patch.status
        changed = true
      }
    }
    if (typeof patch.sessionId === 'string' && patch.sessionId.trim() !== (entry.sessionId ?? '')) {
      entry.sessionId = trimText(patch.sessionId, 200)
      changed = true
    }
    if (typeof patch.cwd === 'string' && patch.cwd.trim() !== (entry.cwd ?? '')) {
      entry.cwd = trimText(patch.cwd, 400)
      changed = true
    }
    if (changed) {
      entry.updatedAt = nowMs()
      this.flush()
    }
    return { entry, changed }
  }

  addNote(target, text) {
    const found = this.get(target)
    if (found.error !== undefined) return found
    const entry = found.entry
    const body = trimText(text, MAX_NOTE_CHARS)
    if (body === undefined) return { error: 'note 的 text 不能为空' }
    const at = nowMs()
    entry.notes.push({ at, text: body })
    if (entry.notes.length > MAX_NOTES) entry.notes.splice(0, entry.notes.length - MAX_NOTES)
    entry.updatedAt = at
    this.flush()
    return { entry }
  }

  remove(target) {
    const found = this.get(target)
    if (found.error !== undefined) return found
    const index = this.all().indexOf(found.entry)
    this.all().splice(index, 1)
    this.removed.add(found.entry.id)
    this.flush()
    return { entry: found.entry }
  }
}

/** 可粘贴的交接简报：新会话开头的第一段话。 */
export function formatBrief(entry) {
  const lines = []
  lines.push(`# 长线任务交接简报：${entry.name}`)
  lines.push(`- 任务 id：${entry.id}`)
  lines.push(`- 状态：${STATUS_LABEL[entry.status] ?? entry.status}`)
  lines.push(`- 常驻会话：${entry.sessionId ?? '未绑定（建议重新绑定到当前会话）'}`)
  if (entry.cwd !== undefined) lines.push(`- 工作目录：${entry.cwd}`)
  lines.push(`- 创建：${formatTime(entry.createdAt)}｜最近更新：${formatTime(entry.updatedAt)}`)
  lines.push('')
  lines.push('## 目标')
  lines.push(entry.goal.length > 0 ? entry.goal : '（未填写）')
  lines.push('')
  lines.push('## 下一步')
  lines.push(entry.next.length > 0 ? entry.next : '（未填写）')
  if (entry.notes.length > 0) {
    lines.push('')
    lines.push('## 最近交接日志')
    for (const note of entry.notes.slice(-8)) {
      lines.push(`- ${formatTime(note.at)}：${note.text}`)
    }
  }
  lines.push('')
  lines.push('（继续推进时，收工或阶段结束用 longtask note 追加进展与下一步。）')
  return lines.join('\n')
}

function describeEntry(entry) {
  const parts = [`[${STATUS_LABEL[entry.status] ?? entry.status}] ${entry.name}`, `id=${entry.id}`]
  if (entry.next.length > 0) parts.push(`下一步：${entry.next}`)
  if (entry.sessionId !== undefined) parts.push(`会话：${entry.sessionId}`)
  parts.push(`更新：${formatTime(entry.updatedAt)}`)
  return `- ${parts.join(' · ')}`
}

/**
 * longtask 工具定义。刻意手写 ToolDefinition（不依赖 defineTool 的 schema
 * DSL）：参数表就是 JSON Schema，插件因此除 tools 服务外不引入任何平台依赖。
 */
function makeTool(roster) {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'show', 'update', 'note', 'brief', 'archive', 'delete'],
        description: '要执行的动作；create 建档案，note 记交接，brief 取简报，list/show 只读',
      },
      name: { type: 'string', description: 'create/update：任务名字，能一眼认出是哪个长期目标' },
      goal: { type: 'string', description: 'create/update：这个长线任务最终要达成什么' },
      next: { type: 'string', description: 'create/update：下一步该做什么（下次接手的第一动作）' },
      status: {
        type: 'string',
        description: 'create/update：任务状态',
        enum: STATUSES,
      },
      text: { type: 'string', description: 'note：本次进展、卡点、决定，以及下次从哪继续' },
      target: { type: 'string', description: 'show/update/note/brief/archive/delete：任务 id 或名字' },
      sessionId: { type: 'string', description: 'create/update：显式指定常驻会话 id；缺省用当前会话' },
      includeArchived: { type: 'boolean', description: 'list：是否连同已归档任务一起列出' },
    },
  }

  return {
    name: TOOL_NAME,
    description: [
      '长线任务花名册：管理跨天、跨会话的长期任务档案。',
      '每条档案记住负责它的常驻会话 id、目标、状态、下一步和交接日志，于是隔天重开会话也能直接回到现场。',
      'create 建档案并默认绑定当前会话；list 列出；show 看详情；update 改状态/目标/下一步；',
      'note 追加一条交接日志；brief 取可直接粘贴给新会话的交接简报；archive 归档；delete 删除。',
      '约定：用户说「把这个做成长线任务/以后每天跟进」时用 create；',
      '每次收工或阶段结束时用 note 记下做了什么、卡在哪、下次从哪继续，并 update 下一步；',
      '新会话接手一个长任务时先 list 或 brief，再动手。',
    ].join(''),
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderToolText(value) }],
    },
    async execute(args, exec) {
      const action = typeof args?.action === 'string' ? args.action : ''
      const session = exec?.agent?.session ?? null
      const facts = {
        sessionId: typeof session?.id === 'string' && session.id.length > 0 ? session.id : undefined,
        cwd: typeof session?.header?.cwd === 'string' && session.header.cwd.length > 0
          ? session.header.cwd
          : undefined,
      }
      const target = typeof args?.target === 'string' && args.target.trim().length > 0
        ? args.target
        : args?.name

      switch (action) {
        case 'create': {
          const created = roster.create(args ?? {}, facts)
          if (created.error !== undefined) return { ok: false, action, error: created.error }
          return { ok: true, action, entry: created.entry }
        }
        case 'list': {
          const entries = roster.visible({ includeArchived: args?.includeArchived === true })
          entries.sort((left, right) => right.updatedAt - left.updatedAt)
          return { ok: true, action, entries }
        }
        case 'show':
        case 'brief': {
          const found = roster.get(target)
          if (found.error !== undefined) return { ok: false, action, error: found.error }
          return { ok: true, action, entry: found.entry, brief: formatBrief(found.entry) }
        }
        case 'update': {
          const updated = roster.update(target, args ?? {})
          if (updated.error !== undefined) return { ok: false, action, error: updated.error }
          return { ok: true, action, entry: updated.entry, changed: updated.changed }
        }
        case 'note': {
          const noted = roster.addNote(target, args?.text)
          if (noted.error !== undefined) return { ok: false, action, error: noted.error }
          return { ok: true, action, entry: noted.entry }
        }
        case 'archive': {
          const archived = roster.update(target, { status: 'archived' })
          if (archived.error !== undefined) return { ok: false, action, error: archived.error }
          return { ok: true, action, entry: archived.entry }
        }
        case 'delete': {
          const removed = roster.remove(target)
          if (removed.error !== undefined) return { ok: false, action, error: removed.error }
          return { ok: true, action, entry: removed.entry }
        }
        default:
          return {
            ok: false,
            action,
            error: `未知 action「${action}」；可用：create / list / show / update / note / brief / archive / delete`,
          }
      }
    },
  }
}

function renderToolText(value) {
  if (value === null || typeof value !== 'object') return 'longtask: 无输出'
  if (value.ok !== true) return `longtask ${value.action ?? ''} 失败：${value.error ?? '未知错误'}`
  switch (value.action) {
    case 'list': {
      const entries = Array.isArray(value.entries) ? value.entries : []
      if (entries.length === 0) return '长线任务花名册为空；用 longtask create 建第一条档案'
      return [`长线任务花名册（${entries.length} 条）：`, ...entries.map(describeEntry)].join('\n')
    }
    case 'create':
      return `已登记长线任务「${value.entry.name}」（${value.entry.id}），绑定会话：${value.entry.sessionId ?? '未绑定'}`
    case 'update':
      return value.changed === false
        ? `任务「${value.entry.name}」没有变化`
        : `已更新任务「${value.entry.name}」：${STATUS_LABEL[value.entry.status] ?? value.entry.status}${value.entry.next.length > 0 ? ` · 下一步：${value.entry.next}` : ''}`
    case 'note': {
      const count = Array.isArray(value.entry.notes) ? value.entry.notes.length : 0
      return `已记一条交接日志（共 ${count} 条）：${value.entry.name}`
    }
    case 'archive':
      return `已归档任务「${value.entry.name}」`
    case 'delete':
      return `已删除任务「${value.entry.name}」`
    case 'show':
    case 'brief':
      return value.brief ?? formatBrief(value.entry)
    default:
      return `longtask ${value.action}: ok`
  }
}

/** `/longtask` 的子命令表（面向用户的短路径，模型侧仍用 longtask 工具）。 */
const COMMAND_HELP = 'list | show <id|名字> | brief <id|名字> | note <id|名字> <文本> | active|waiting|done|archive <id|名字> | new <名字>'

/**
 * 注册 /longtask 命令。用户不必经过模型就能查状态、记一条交接、改状态。
 * @param {object} ctx - Cordis 上下文。
 * @param {Roster} roster - 花名册。
 */
export function registerCommands(ctx, roster) {
  withService(ctx, 'commands', (commands) => {
    if (typeof commands?.register !== 'function') return
    commands.register({
      name: 'longtask',
      description: `查看或维护长线任务花名册：${COMMAND_HELP}`,
      input: { hint: 'list | note <id> 进展 | done <id> | brief <id>' },
      handler: (invocation) => runCommand(roster, invocation),
    })
  })
}

/**
 * /longtask 的处理体（导出便于测试）。
 * @param {Roster} roster - 花名册。
 * @param {{rawInput?: string, agent?: {session?: {id?: string, header?: {cwd?: string}} | null} | null}} invocation - 命令调用。
 * @returns {{kind: 'success'|'error', text: string}}
 */
export function runCommand(roster, invocation) {
  const raw = typeof invocation?.rawInput === 'string' ? invocation.rawInput.trim() : ''
  const session = invocation?.agent?.session ?? null
  const facts = {
    sessionId: typeof session?.id === 'string' && session.id.length > 0 ? session.id : undefined,
    cwd: typeof session?.header?.cwd === 'string' && session.header.cwd.length > 0
      ? session.header.cwd
      : undefined,
  }
  const [verbRaw, ...tokens] = raw.length === 0 ? [] : raw.split(/\s+/)
  const verb = (verbRaw ?? 'list').toLowerCase()
  const rest = tokens.join(' ')

  const fail = (text) => ({ kind: 'error', text })
  const done = (text) => ({ kind: 'success', text })

  switch (verb) {
    case 'list': {
      const entries = roster.visible({ includeArchived: rest.includes('--all') })
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)
      if (entries.length === 0) return done('长线任务花名册为空。让 AI「把这件事建成长线任务」就会登记第一条。')
      return done([
        `长线任务（${entries.length} 条）：`,
        ...entries.map((entry) => describeEntry(entry)),
        '用法：/longtask note <id> <进展> ｜ /longtask done <id> ｜ /longtask brief <id>',
      ].join('\n'))
    }
    case 'new':
    case 'create': {
      if (rest.length === 0) return fail('用法：/longtask new <名字>')
      const created = roster.create({ name: rest }, facts)
      if (created.error !== undefined) return fail(created.error)
      return done(`已登记「${created.entry.name}」（${created.entry.id}），绑定当前会话。目标与下一步可让 AI 用 longtask update 补。`)
    }
    case 'show':
    case 'brief': {
      const found = roster.get(rest)
      if (found.error !== undefined) return fail(found.error)
      return done(formatBrief(found.entry))
    }
    case 'note': {
      const space = rest.indexOf(' ')
      const target = space === -1 ? rest : rest.slice(0, space)
      const text = space === -1 ? '' : rest.slice(space + 1).trim()
      if (target.length === 0 || text.length === 0) return fail('用法：/longtask note <id|名字> <这次做了什么、卡在哪、下次从哪继续>')
      const noted = roster.addNote(target, text)
      if (noted.error !== undefined) return fail(noted.error)
      return done(`已记一条交接日志：${noted.entry.name}（共 ${noted.entry.notes.length} 条）`)
    }
    case 'active':
    case 'waiting':
    case 'done':
    case 'archive': {
      const updated = roster.update(rest, { status: verb === 'active' ? 'active' : verb })
      if (updated.error !== undefined) return fail(updated.error)
      return done(`「${updated.entry.name}」→ ${STATUS_LABEL[updated.entry.status]}${updated.changed === false ? '（本来就是这个状态）' : ''}`)
    }
    default:
      return fail(`未知子命令「${verb}」。可用：${COMMAND_HELP}`)
  }
}

/** 可选服务就绪后调用；服务缺席时保持安静（不把 fiber 挂死）。 */
function withService(ctx, serviceName, fn) {
  const existing = ctx.get(serviceName)
  if (existing !== undefined && existing !== null) {
    fn(existing)
    return
  }
  const off = ctx.on('internal/service', (serviceName2) => {
    if (serviceName2 !== serviceName) return
    const service = ctx.get(serviceName)
    if (service === undefined || service === null) return
    off()
    fn(service)
  })
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  return JSON.parse(text)
}

/** 浏览器面板的唯一数据面：只走公开 JSON 路由，不碰私有服务。 */
function registerRoutes(ctx, webServer, roster) {
  if (typeof webServer?.register !== 'function') return
  const disposers = []

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/longtasks/roster',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost')
        const includeArchived = url.searchParams.get('all') === '1'
        const entries = roster.visible({ includeArchived })
          .slice()
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .map((entry) => ({ ...entry, brief: formatBrief(entry) }))
        sendJson(res, 200, {
          ok: true,
          file: roster.file,
          statuses: STATUSES,
          statusLabels: STATUS_LABEL,
          entries,
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/longtasks/ping',
    handler: async (req, res) => {
      try {
        const stamp = { at: Date.now(), ua: req.headers['user-agent'] ?? null }
        mkdirSync(dirname(rosterFile()), { recursive: true })
        writeFileSync(join(dirname(rosterFile()), 'client-ping.json'), `${JSON.stringify(stamp)}\n`, 'utf8')
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/api/longtasks/action',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '只接受 POST' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const action = typeof body.action === 'string' ? body.action : ''
        const id = typeof body.id === 'string' ? body.id : undefined
        let result
        if (action === 'update') result = roster.update(id, body)
        else if (action === 'note') result = roster.addNote(id, body.text)
        else if (action === 'archive') result = roster.update(id, { status: 'archived' })
        else if (action === 'delete') result = roster.remove(id)
        else result = { error: `未知 action「${action}」` }
        if (result.error !== undefined) {
          sendJson(res, 400, { ok: false, error: result.error })
          return
        }
        sendJson(res, 200, { ok: true, entry: { ...result.entry, brief: formatBrief(result.entry) } })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0).reverse()) dispose?.()
  }, 'dsh-longtasks: web routes')
}

/**
 * 插件挂载。
 * @param {object} ctx - Cordis 上下文。
 */
export function apply(ctx) {
  const roster = new Roster()

  ctx.tools.register(makeTool(roster))
  registerCommands(ctx, roster)

  // 开工即见花名册：新会话的第一轮组装就把现有长线任务写进系统提示，
  // 于是「重新熟悉任务」不需要人再解释一遍。
  ctx.systemPrompt.section({
    name: 'dsh-longtasks:roster',
    order: -45,
    text: (assemble) => {
      const session = assemble?.agent?.session ?? null
      const sessionId = typeof session?.id === 'string' ? session.id : undefined
      const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : undefined
      const entries = roster.visible().slice()
      if (entries.length === 0) return ''
      entries.sort((left, right) => {
        const leftMine = left.sessionId !== undefined && left.sessionId === sessionId ? 1 : 0
        const rightMine = right.sessionId !== undefined && right.sessionId === sessionId ? 1 : 0
        if (leftMine !== rightMine) return rightMine - leftMine
        const leftHere = left.cwd !== undefined && left.cwd === cwd ? 1 : 0
        const rightHere = right.cwd !== undefined && right.cwd === cwd ? 1 : 0
        if (leftHere !== rightHere) return rightHere - leftHere
        return right.updatedAt - left.updatedAt
      })
      const shown = entries.slice(0, MAX_ROSTER_IN_PROMPT)
      const lines = [
        '## 长线任务花名册（dsh-longtasks）',
        '跨会话的长期任务记录。标 ★ 的是当前会话负责的条目；接手前先用 longtask brief <id> 取交接简报，收工前用 longtask note 记下进展与下一步。',
      ]
      for (const entry of shown) {
        const star = entry.sessionId !== undefined && entry.sessionId === sessionId ? '★ ' : ''
        const pieces = [
          `${star}[${STATUS_LABEL[entry.status] ?? entry.status}] ${entry.name}`,
          `id=${entry.id}`,
          `更新=${formatTime(entry.updatedAt)}`,
        ]
        if (entry.next.length > 0) pieces.push(`下一步=${entry.next}`)
        if (entry.goal.length > 0) pieces.push(`目标=${entry.goal}`)
        const idleDays = Math.floor((Date.now() - entry.updatedAt) / 86_400_000)
        if (idleDays >= 3) pieces.push(`⚠️ 已 ${idleDays} 天未更新`)
        lines.push(`- ${pieces.join('｜')}`)
      }
      if (entries.length > shown.length) {
        lines.push(`- 另有 ${entries.length - shown.length} 条：用 longtask list 查看全部`)
      }
      return lines.join('\n')
    },
  })

  withService(ctx, 'webServer', (webServer) => { registerRoutes(ctx, webServer, roster) })
}
