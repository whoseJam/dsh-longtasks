/**
 * dsh-longtasks — 长线任务花名册（Host 半侧）。
 *
 * 一个长线任务 = 一个目录：
 *
 *   ~/.dsh/longtasks/tasks/<id>/TASK.md    档案：frontmatter 机器字段 + 核心思想 + 工作记录
 *   ~/.dsh/longtasks/tasks/<id>/...        workspace：结构完全自由，agent 自己组织
 *   ~/.dsh/longtasks/INDEX.md              人读索引（写操作后重新生成）
 *
 * 为什么分两层：**核心思想（brief）**是稳定的——这个任务是什么、为什么做、硬约束；
 * **workspace** 是活的——修 bug 的放台账和查询，PR 审查的放队列和结论，调研的放假设和实验，
 * 插件不该预设任何一套。所以插件只解析 frontmatter 与两三个固定小节，工作区里的东西
 * 一律不碰，agent 用普通文件工具自己去组织。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'longtasks'
export const inject = ['tools', 'systemPrompt']

export const STATUSES = ['active', 'waiting', 'done', 'archived']

const STATUS_LABEL = {
  active: '进行中',
  waiting: '等待中',
  done: '已完成',
  archived: '已归档',
}

const SECTIONS = { brief: '核心思想', log: '工作记录' }

const MAX_NAME = 120
const MAX_TEXT = 8000
const MAX_NOTE_CHARS = 8000
const MAX_NOTES = 200
const MAX_BODY_BYTES = 512 * 1024
const MAX_FILES_IN_BRIEF = 20

const TOOL_NAME = 'longtask'

function nowMs() {
  return Date.now()
}

/** 花名册根目录：DSH_HOME/longtasks，测试可用 DSH_LONGTASKS_DIR 覆盖。 */
function rootDir() {
  const override = process.env.DSH_LONGTASKS_DIR
  if (typeof override === 'string' && override.trim().length > 0) return override
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'longtasks')
}

/** 任务目录的父目录。 */
export function rosterDir() {
  return join(rootDir(), 'tasks')
}

/** 旧版单文件 JSON 的位置（只在启动时迁移一次）。 */
export function legacyFile() {
  return join(rootDir(), 'roster.json')
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
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatNoteTime(ms) {
  return formatTime(ms)
}

/** 读入的一条档案补全成规范形态。 */
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
    kind: trimText(base.kind, 40),
    goal: trimText(base.goal, MAX_TEXT) ?? '',
    brief: trimText(base.brief, MAX_TEXT) ?? '',
    status: STATUSES.includes(base.status) ? base.status : 'active',
    next: trimText(base.next, MAX_TEXT) ?? '',
    sessionId: trimText(base.sessionId, 200),
    cwd: trimText(base.cwd, 400),
    workspace: trimText(base.workspace, 600),
    notes,
    createdAt,
    updatedAt,
    lastTouchedAt: Math.max(updatedAt, ...notes.map((note) => note.at), 0),
  }
}

/* ── markdown 读写：只碰 frontmatter 与固定小节，其余原样保留 ────────────── */

function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/)
  if ((lines[0] ?? '').trim() !== '---') return { front: [], body: text }
  const end = lines.indexOf('---', 1)
  if (end === -1) return { front: [], body: text }
  const front = []
  for (const line of lines.slice(1, end)) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (match !== null) front.push([match[1], match[2].trim()])
  }
  return { front, body: lines.slice(end + 1).join('\n') }
}

function renderFrontmatter(front, updates = {}) {
  const order = []
  const values = new Map()
  for (const [key, value] of front) {
    if (!values.has(key)) order.push(key)
    values.set(key, value)
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue
    if (!values.has(key)) order.push(key)
    values.set(key, value)
  }
  const line = (key) => `${key}: ${String(values.get(key) ?? '').replace(/\r?\n/g, ' ').trim()}`
  return ['---', ...order.map(line), '---'].join('\n') + '\n'
}

function patchFrontmatter(text, updates) {
  const { front, body } = splitFrontmatter(text)
  return `${renderFrontmatter(front, updates)}\n${body.replace(/^\n+/, '')}`
}

function sectionRange(lines, title) {
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+(.*?)\s*$/.exec(lines[index])
    if (match !== null && match[1] === title) { start = index; break }
  }
  if (start === -1) return undefined
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) { end = index; break }
  }
  return { start, end }
}

function readSection(body, title) {
  const lines = body.split('\n')
  const range = sectionRange(lines, title)
  if (range === undefined) return ''
  return lines.slice(range.start + 1, range.end).join('\n').trim()
}

function writeSection(text, title, content) {
  const { front, body } = splitFrontmatter(text)
  const lines = body.split('\n')
  const block = ['', ...content.trimEnd().split('\n'), '']
  const range = sectionRange(lines, title)
  const nextBody = range === undefined
    ? `${body.trimEnd()}\n\n## ${title}\n${block.join('\n').trimEnd()}\n`
    : [...lines.slice(0, range.start + 1), ...block, ...lines.slice(range.end)].join('\n')
  const head = front.length === 0 ? '' : `${renderFrontmatter(front)}\n`
  return `${head}${nextBody.replace(/\n{3,}/g, '\n\n')}`
}

/** 小节标题清单（给面板与简报做目录，不解释内容）。 */
export function sectionTitles(body) {
  const titles = []
  for (const line of body.split('\n')) {
    const match = /^##\s+(.*?)\s*$/.exec(line)
    if (match !== null && match[1].length > 0) titles.push(match[1])
  }
  return titles
}

function parseNotes(content, fallbackMs) {
  const notes = []
  let current = null
  for (const line of content.split('\n')) {
    const match = /^###\s+(.*?)\s*$/.exec(line)
    if (match !== null) {
      if (current !== null) notes.push(current)
      current = { at: toMs(match[1], fallbackMs), lines: [] }
      continue
    }
    if (current !== null) current.lines.push(line)
  }
  if (current !== null) notes.push(current)
  return notes
    .map((note) => ({ at: note.at, text: note.lines.join('\n').trim() }))
    .filter((note) => note.text.length > 0)
}

function renderNotes(notes) {
  return notes.map((note) => `### ${formatNoteTime(note.at)}\n\n${note.text.trim()}\n`).join('\n')
}

function parseTaskFile(text, fallbackMs) {
  const { front, body } = splitFrontmatter(text)
  const values = new Map(front)
  return normalizeEntry({
    id: values.get('id'),
    name: values.get('name'),
    kind: values.get('kind'),
    goal: values.get('goal'),
    status: values.get('status'),
    next: values.get('next'),
    sessionId: values.get('sessionId'),
    cwd: values.get('cwd'),
    workspace: values.get('workspace'),
    brief: readSection(body, SECTIONS.brief) || readSection(body, '目标'),
    notes: parseNotes(readSection(body, SECTIONS.log), fallbackMs),
    createdAt: toMs(values.get('createdAt'), fallbackMs),
    updatedAt: toMs(values.get('updatedAt'), fallbackMs),
  })
}

function renderTaskFile(entry) {
  const front = renderFrontmatter([
    ['id', entry.id],
    ['name', entry.name],
    ['status', entry.status],
    ...(entry.kind === undefined ? [] : [['kind', entry.kind]]),
    ...(entry.next.length === 0 ? [] : [['next', entry.next]]),
    ...(entry.sessionId === undefined ? [] : [['sessionId', entry.sessionId]]),
    ...(entry.cwd === undefined ? [] : [['cwd', entry.cwd]]),
    ['workspace', entry.workspace],
    ['createdAt', new Date(entry.createdAt).toISOString()],
    ['updatedAt', new Date(entry.updatedAt).toISOString()],
  ])
  const body = [
    `## ${SECTIONS.brief}`,
    '',
    entry.brief.length > 0 ? entry.brief : '（未填写）',
    '',
    `## ${SECTIONS.log}`,
    '',
    renderNotes(entry.notes).trimEnd(),
    '',
  ].join('\n')
  return `${front}\n${body}`
}

/**
 * 花名册：扫描每个任务目录里的 TASK.md，按文件 mtime 缓存解析结果。
 * 同步读写是刻意的——systemPrompt 提供者必须同步返回。
 */
export class Roster {
  constructor(root = rootDir()) {
    this.root = root
    this.tasks = join(root, 'tasks')
    this.indexFile = join(root, 'INDEX.md')
    this.cache = new Map()
  }

  ensureDir() {
    mkdirSync(this.tasks, { recursive: true })
  }

  taskDir(id) {
    return join(this.tasks, id)
  }

  taskFile(id) {
    return join(this.tasks, id, 'TASK.md')
  }

  /** 旧数据一次性迁移：roster.json 与早期的 tasks/<id>.md 都收进任务目录。 */
  migrateLegacy() {
    this.ensureDir()
    const legacy = legacyFile()
    if (existsSync(legacy)) {
      try {
        const parsed = JSON.parse(readFileSync(legacy, 'utf8'))
        const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
        for (const raw of entries) {
          const entry = normalizeEntry({
            ...raw,
            brief: raw?.brief ?? raw?.goal,
            workspace: raw?.workspace ?? this.defaultWorkspace(raw?.id),
          })
          mkdirSync(this.taskDir(entry.id), { recursive: true })
          writeFileSync(this.taskFile(entry.id), renderTaskFile(entry), 'utf8')
        }
      } catch (error) {
        console.warn(`[dsh-longtasks] 旧版 roster.json 迁移失败，已跳过：${error?.message ?? String(error)}`)
      }
      try {
        renameSync(legacy, `${legacy}.migrated-${Date.now()}`)
      } catch { /* 留待下次启动重试 */ }
    }

    // 早期版本：tasks/<id>.md 平铺 → tasks/<id>/TASK.md
    for (const fileName of readdirSync(this.tasks)) {
      if (!fileName.endsWith('.md')) continue
      const flat = join(this.tasks, fileName)
      const id = fileName.replace(/\.md$/, '')
      const dir = this.taskDir(id)
      try {
        mkdirSync(dir, { recursive: true })
        renameSync(flat, join(dir, 'TASK.md'))
      } catch (error) {
        console.warn(`[dsh-longtasks] 迁移 ${fileName} 失败：${error?.message ?? String(error)}`)
      }
    }
  }

  defaultWorkspace(id) {
    return this.taskDir(id)
  }

  all() {
    this.ensureDir()
    this.migrateLegacy()
    const entries = []
    const seen = new Set()
    for (const id of readdirSync(this.tasks)) {
      if (id.startsWith('.')) continue
      const file = this.taskFile(id)
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      const cached = this.cache.get(id)
      let entry = cached !== undefined && cached.mtime === stat.mtimeMs ? cached.entry : undefined
      if (entry === undefined) {
        try {
          entry = parseTaskFile(readFileSync(file, 'utf8'), stat.mtimeMs)
          if (entry.workspace === undefined) entry.workspace = this.taskDir(id)
          this.cache.set(id, { mtime: stat.mtimeMs, entry })
        } catch (error) {
          console.warn(`[dsh-longtasks] 跳过无法读取的任务 ${id}：${error?.message ?? String(error)}`)
          continue
        }
      }
      seen.add(id)
      entries.push(entry)
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.cache.delete(id)
    return entries
  }

  writeEntry(entry, raw) {
    const dir = this.taskDir(entry.id)
    mkdirSync(dir, { recursive: true })
    entry.workspace = entry.workspace ?? dir
    const file = this.taskFile(entry.id)
    const text = raw ?? renderTaskFile(entry)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
    const stat = statSync(file)
    this.cache.set(entry.id, { mtime: stat.mtimeMs, entry: parseTaskFile(text, stat.mtimeMs) })
  }

  writeIndex() {
    const entries = this.all().slice().sort((left, right) => right.lastTouchedAt - left.lastTouchedAt)
    const lines = ['# 长线任务索引', '', `> 由 dsh-longtasks 生成，${formatTime(Date.now())}`, '']
    for (const status of STATUSES) {
      const group = entries.filter((entry) => entry.status === status)
      if (group.length === 0) continue
      lines.push(`## ${STATUS_LABEL[status]}`, '')
      for (const entry of group) {
        const kind = entry.kind === undefined ? '' : `｜${entry.kind}`
        const step = entry.next.length > 0 ? `｜下一步：${entry.next}` : ''
        lines.push(`- [${entry.name}](tasks/${entry.id}/TASK.md)${kind}｜更新 ${formatTime(entry.lastTouchedAt)}${step}`)
      }
      lines.push('')
    }
    try {
      writeFileSync(this.indexFile, `${lines.join('\n').trimEnd()}\n`, 'utf8')
    } catch (error) {
      console.warn(`[dsh-longtasks] 索引写入失败：${error?.message ?? String(error)}`)
    }
  }

  commit(entry, raw) {
    this.writeEntry(entry, raw)
    this.writeIndex()
    return entry
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

  readRaw(id) {
    try {
      return readFileSync(this.taskFile(id), 'utf8')
    } catch {
      return undefined
    }
  }

  /** workspace 里的文件清单（TASK.md 之外的一切，按修改时间倒序）。 */
  workspaceFiles(entry, limit = MAX_FILES_IN_BRIEF) {
    const dir = entry.workspace ?? this.taskDir(entry.id)
    const files = []
    const walk = (current, depth) => {
      if (depth > 3 || files.length >= limit * 4) return
      let names
      try {
        names = readdirSync(current)
      } catch {
        return
      }
      for (const name of names) {
        if (name.startsWith('.')) continue
        const path = join(current, name)
        let stat
        try {
          stat = statSync(path)
        } catch {
          continue
        }
        const relative = path.slice(dir.length + 1)
        if (stat.isDirectory()) {
          walk(path, depth + 1)
          continue
        }
        if (relative === 'TASK.md') continue
        files.push({ path: relative, size: stat.size, mtime: stat.mtimeMs })
      }
    }
    walk(dir, 0)
    return files.sort((left, right) => right.mtime - left.mtime).slice(0, limit)
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
    const id = newId()
    const entry = normalizeEntry({
      id,
      name,
      kind: fields.kind,
      brief: fields.brief,
      next: fields.next,
      status: fields.status,
      sessionId: fields.sessionId ?? facts.sessionId,
      cwd: fields.cwd ?? facts.cwd,
      workspace: this.taskDir(id),
      notes: [],
      createdAt: at,
      updatedAt: at,
    })
    return { entry: this.commit(entry, renderTaskFile(entry)) }
  }

  update(target, patch) {
    const found = this.get(target)
    if (found.error !== undefined) return found
    const entry = found.entry
    const raw = this.readRaw(entry.id) ?? renderTaskFile(entry)
    const updates = {}
    let changed = false

    const nextName = trimText(patch.name, MAX_NAME)
    if (nextName !== undefined && nextName !== entry.name) {
      entry.name = nextName
      updates.name = nextName
      changed = true
    }
    if (typeof patch.kind === 'string' && patch.kind.trim() !== (entry.kind ?? '')) {
      entry.kind = trimText(patch.kind, 40)
      updates.kind = entry.kind ?? ''
      changed = true
    }
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) return { error: `status 只能是 ${STATUSES.join(' / ')}` }
      if (patch.status !== entry.status) {
        entry.status = patch.status
        updates.status = patch.status
        changed = true
      }
    }
    if (typeof patch.next === 'string' && patch.next.trim() !== entry.next) {
      entry.next = patch.next.trim().slice(0, MAX_TEXT)
      updates.next = entry.next
      changed = true
    }
    if (typeof patch.brief === 'string' && patch.brief.trim() !== entry.brief) {
      entry.brief = patch.brief.trim().slice(0, MAX_TEXT)
      changed = true
    }
    if (typeof patch.sessionId === 'string' && patch.sessionId.trim() !== (entry.sessionId ?? '')) {
      entry.sessionId = trimText(patch.sessionId, 200)
      updates.sessionId = entry.sessionId ?? ''
      changed = true
    }
    if (!changed) return { entry, changed: false }

    entry.updatedAt = nowMs()
    updates.updatedAt = new Date(entry.updatedAt).toISOString()
    let text = patchFrontmatter(raw, updates)
    if (typeof patch.brief === 'string') text = writeSection(text, SECTIONS.brief, entry.brief)
    return { entry: this.commit(entry, text), changed: true }
  }

  addNote(target, text) {
    const found = this.get(target)
    if (found.error !== undefined) return found
    const body = trimText(text, MAX_NOTE_CHARS)
    if (body === undefined) return { error: 'note 的 text 不能为空' }
    const entry = found.entry
    const raw = this.readRaw(entry.id) ?? renderTaskFile(entry)
    const at = nowMs()
    const notes = [{ at, text: body }, ...entry.notes].slice(0, MAX_NOTES)
    entry.notes = notes
    entry.updatedAt = at
    entry.lastTouchedAt = at
    const text2 = writeSection(
      patchFrontmatter(raw, { updatedAt: new Date(at).toISOString() }),
      SECTIONS.log,
      renderNotes(notes),
    )
    return { entry: this.commit(entry, text2) }
  }

  remove(target) {
    const found = this.get(target)
    if (found.error !== undefined) return found
    try {
      rmSync(this.taskDir(found.entry.id), { recursive: true, force: true })
    } catch (error) {
      return { error: `删除任务目录失败：${error?.message ?? String(error)}` }
    }
    this.cache.delete(found.entry.id)
    this.writeIndex()
    return { entry: found.entry }
  }
}

/** 可粘贴的交接简报：新会话开头的第一段话。 */
export function formatBrief(entry, files = []) {
  const lines = []
  lines.push(`# 长线任务交接简报：${entry.name}`)
  lines.push(`- 任务 id：${entry.id}`)
  if (entry.kind !== undefined) lines.push(`- 类型：${entry.kind}`)
  lines.push(`- 状态：${STATUS_LABEL[entry.status] ?? entry.status}`)
  lines.push(`- 常驻会话：${entry.sessionId ?? '未绑定（建议重新绑定到当前会话）'}`)
  if (entry.cwd !== undefined) lines.push(`- 工作目录：${entry.cwd}`)
  if (entry.workspace !== undefined) lines.push(`- 任务 workspace：${entry.workspace}`)
  lines.push(`- 创建：${formatTime(entry.createdAt)}｜最近更新：${formatTime(entry.lastTouchedAt)}`)
  lines.push('')
  lines.push('## 核心思想')
  lines.push('')
  lines.push(entry.brief.length > 0 ? entry.brief : '（未填写）')
  lines.push('')
  lines.push('## 下一步')
  lines.push('')
  lines.push(entry.next.length > 0 ? entry.next : '（未填写）')
  if (entry.notes.length > 0) {
    lines.push('')
    lines.push('## 最近记录')
    lines.push('')
    for (const note of entry.notes.slice(0, 8)) {
      lines.push(`- ${formatTime(note.at)}：${note.text}`)
    }
  }
  if (files.length > 0) {
    lines.push('')
    lines.push(`## workspace 文件（最近 ${files.length} 个，结构由你决定）`)
    lines.push('')
    for (const file of files) {
      lines.push(`- ${file.path}（${Math.max(1, Math.round(file.size / 1024))} KB，${formatTime(file.mtime)}）`)
    }
  }
  lines.push('')
  lines.push('（workspace 用普通文件工具读写；阶段结束用 longtask note 记一行结论，并 update 下一步。）')
  return lines.join('\n')
}

function describeEntry(entry) {
  const parts = [`[${STATUS_LABEL[entry.status] ?? entry.status}] ${entry.name}`]
  if (entry.kind !== undefined) parts.push(entry.kind)
  parts.push(`id=${entry.id}`)
  if (entry.next.length > 0) parts.push(`下一步：${entry.next}`)
  if (entry.sessionId !== undefined) parts.push(`会话：${entry.sessionId}`)
  parts.push(`更新：${formatTime(entry.lastTouchedAt)}`)
  return `- ${parts.join(' · ')}`
}

function makeTool(roster) {
  const parameters = {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        required: true,
        enum: ['create', 'list', 'show', 'update', 'note', 'brief', 'archive', 'delete'],
        description: '要执行的动作；create 建档案，note 记一条结论，brief 取交接简报，list/show 只读',
      },
      name: { type: 'string', description: 'create/update：任务名字，能一眼认出是哪个长期目标' },
      kind: { type: 'string', description: 'create/update：任务性质，例如 bugfix / review / research / ops（自由文本，只做展示）' },
      brief: { type: 'string', description: 'create/update：核心思想——这个任务是什么、为什么做、硬约束是什么。稳定、短，不写流水账' },
      next: { type: 'string', description: 'create/update：下一步该做什么（下次接手的第一动作）' },
      status: { type: 'string', description: 'update：任务状态', enum: STATUSES },
      text: { type: 'string', description: 'note：这一阶段的结论、卡点或决定（一行到一段，不是每一轮的工具流水）' },
      target: { type: 'string', description: 'show/update/note/brief/archive/delete：任务 id 或名字' },
      sessionId: { type: 'string', description: 'create/update：显式指定常驻会话 id；缺省用当前会话' },
      includeArchived: { type: 'boolean', description: 'list：是否连同已归档任务一起列出' },
    },
  }

  return {
    name: TOOL_NAME,
    description: [
      '长线任务花名册：管理跨天、跨会话的长期任务档案。',
      '每条档案 = 核心思想（brief）+ 下一步 + 状态 + 绑定的常驻会话 + 一个独立 workspace 目录。',
      'workspace 里放什么是任务自己的事：插件不预设结构，你用普通文件工具（Read/Write/Edit/Bash）按任务性质自己组织；',
      'brief 只写稳定的核心思想，不要写成流水账。',
      'create 建档案并默认绑定当前会话；list/show 查看；update 改状态/下一步/核心思想；',
      'note 追加一条阶段性结论；brief 取可直接粘贴给新会话的交接简报；archive 归档；delete 删除。',
      '约定：用户说「把这个做成长线任务/以后每天跟进」时用 create；',
      '每完成一个阶段用 note 记一行结论并 update 下一步；新会话接手时先 list 或 brief。',
    ].join(''),
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderToolText(value, roster) }],
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
          entries.sort((left, right) => right.lastTouchedAt - left.lastTouchedAt)
          return {
            ok: true,
            action,
            entries: entries.map((entry) => ({
              ...entry,
              files: roster.workspaceFiles(entry, 20).map((file) => file.path),
            })),
          }
        }
        case 'show':
        case 'brief': {
          const found = roster.get(target)
          if (found.error !== undefined) return { ok: false, action, error: found.error }
          const files = roster.workspaceFiles(found.entry)
          if (action === 'show') {
            return {
              ok: true,
              action,
              entry: found.entry,
              taskFile: roster.taskFile(found.entry.id),
              markdown: roster.readRaw(found.entry.id) ?? '',
              files: files.map((file) => file.path),
            }
          }
          return { ok: true, action, entry: found.entry, brief: formatBrief(found.entry, files) }
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

function renderToolText(value, roster) {
  if (value === null || typeof value !== 'object') return 'longtask: 无输出'
  if (value.ok !== true) return `longtask ${value.action ?? ''} 失败：${value.error ?? '未知错误'}`
  switch (value.action) {
    case 'list': {
      const entries = Array.isArray(value.entries) ? value.entries : []
      if (entries.length === 0) return '长线任务花名册为空；用 longtask create 建第一条档案'
      return [`长线任务花名册（${entries.length} 条）：`, ...entries.map(describeEntry)].join('\n')
    }
    case 'create':
      return [
        `已登记长线任务「${value.entry.name}」（${value.entry.id}），绑定会话：${value.entry.sessionId ?? '未绑定'}`,
        `workspace：${value.entry.workspace}（结构由你决定，用普通文件工具组织）`,
      ].join('\n')
    case 'update':
      return value.changed === false
        ? `任务「${value.entry.name}」没有变化`
        : `已更新任务「${value.entry.name}」：${STATUS_LABEL[value.entry.status] ?? value.entry.status}${value.entry.next.length > 0 ? ` · 下一步：${value.entry.next}` : ''}`
    case 'note': {
      const count = Array.isArray(value.entry.notes) ? value.entry.notes.length : 0
      return `已记一条阶段性结论（共 ${count} 条）：${value.entry.name}`
    }
    case 'archive':
      return `已归档任务「${value.entry.name}」`
    case 'delete':
      return `已删除任务「${value.entry.name}」`
    case 'show':
      return [
        `任务「${value.entry.name}」的档案：${value.taskFile}`,
        value.markdown.trim(),
        value.files.length > 0 ? `\nworkspace 文件：${value.files.join('、')}` : '',
      ].join('\n').trimEnd()
    case 'brief':
      return value.brief ?? formatBrief(value.entry, [])
    default:
      return `longtask ${value.action}: ok`
  }
}

const COMMAND_HELP = 'list | show <id|名字> | brief <id|名字> | note <id|名字> <一行结论> | active|waiting|done|archive <id|名字> | new <名字>'

export function registerCommands(ctx, roster) {
  withService(ctx, 'commands', (commands) => {
    if (typeof commands?.register !== 'function') return
    commands.register({
      name: 'longtask',
      description: `查看或维护长线任务花名册：${COMMAND_HELP}`,
      input: { hint: 'list | note <id> 结论 | done <id> | brief <id>' },
      handler: (invocation) => runCommand(roster, invocation),
    })
  })
}

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
        .sort((left, right) => right.lastTouchedAt - left.lastTouchedAt)
      if (entries.length === 0) return done('长线任务花名册为空。让 AI「把这件事建成长线任务」就会登记第一条。')
      return done([
        `长线任务（${entries.length} 条）：`,
        ...entries.map((entry) => describeEntry(entry)),
        '用法：/longtask note <id> <结论> ｜ /longtask done <id> ｜ /longtask brief <id>',
      ].join('\n'))
    }
    case 'new':
    case 'create': {
      if (rest.length === 0) return fail('用法：/longtask new <名字>')
      const created = roster.create({ name: rest }, facts)
      if (created.error !== undefined) return fail(created.error)
      return done(`已登记「${created.entry.name}」（${created.entry.id}），workspace：${created.entry.workspace}`)
    }
    case 'show':
    case 'brief': {
      const found = roster.get(rest)
      if (found.error !== undefined) return fail(found.error)
      if (verb === 'show') return done(roster.readRaw(found.entry.id) ?? formatBrief(found.entry, []))
      return done(formatBrief(found.entry, roster.workspaceFiles(found.entry)))
    }
    case 'note': {
      const space = rest.indexOf(' ')
      const target = space === -1 ? rest : rest.slice(0, space)
      const text = space === -1 ? '' : rest.slice(space + 1).trim()
      if (target.length === 0 || text.length === 0) return fail('用法：/longtask note <id|名字> <这一阶段的结论>')
      const noted = roster.addNote(target, text)
      if (noted.error !== undefined) return fail(noted.error)
      return done(`已记一条结论：${noted.entry.name}（共 ${noted.entry.notes.length} 条）`)
    }
    case 'active':
    case 'waiting':
    case 'done':
    case 'archive': {
      const updated = roster.update(rest, { status: verb })
      if (updated.error !== undefined) return fail(updated.error)
      return done(`「${updated.entry.name}」→ ${STATUS_LABEL[updated.entry.status]}${updated.changed === false ? '（本来就是这个状态）' : ''}`)
    }
    default:
      return fail(`未知子命令「${verb}」。可用：${COMMAND_HELP}`)
  }
}

function withService(ctx, serviceName, fn) {
  const existing = ctx.get(serviceName)
  if (existing !== undefined && existing !== null) {
    fn(existing)
    return
  }
  const off = ctx.on('internal/service', (name2) => {
    if (name2 !== serviceName) return
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
          .sort((left, right) => right.lastTouchedAt - left.lastTouchedAt)
          .map((entry) => {
            const files = roster.workspaceFiles(entry, 20)
            return { ...entry, fileCount: files.length, files: files.map((file) => file.path) }
          })
        sendJson(res, 200, {
          ok: true,
          dir: roster.root,
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
        const files = roster.workspaceFiles(result.entry, 20)
        sendJson(res, 200, {
          ok: true,
          entry: { ...result.entry, fileCount: files.length, files: files.map((file) => file.path) },
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
        mkdirSync(rootDir(), { recursive: true })
        writeFileSync(join(rootDir(), 'client-ping.json'), `${JSON.stringify(stamp)}\n`, 'utf8')
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0).reverse()) dispose?.()
  }, 'dsh-longtasks: web routes')
}

export function apply(ctx) {
  const roster = new Roster()

  ctx.tools.register(makeTool(roster))
  registerCommands(ctx, roster)

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
        return right.lastTouchedAt - left.lastTouchedAt
      })
      const shown = entries.slice(0, 6)
      const lines = [
        '## 长线任务花名册（dsh-longtasks）',
        '跨会话的长期任务。标 ★ 的是当前会话负责的条目；接手前先用 longtask brief <id> 取交接简报。',
        '每个任务的 workspace 目录就是它自己的工作区，结构完全由任务决定；插件不规定格式，用普通文件工具自己组织。',
        'brief（核心思想）只写稳定的东西；阶段结束用 longtask note 记一行结论，并 update 下一步。',
      ]
      for (const entry of shown) {
        const star = entry.sessionId !== undefined && entry.sessionId === sessionId ? '★ ' : ''
        const pieces = [
          `${star}[${STATUS_LABEL[entry.status] ?? entry.status}] ${entry.name}`,
          `id=${entry.id}`,
          `更新=${formatTime(entry.lastTouchedAt)}`,
        ]
        if (entry.kind !== undefined) pieces.push(`类型=${entry.kind}`)
        if (entry.next.length > 0) pieces.push(`下一步=${entry.next}`)
        const idleDays = Math.floor((Date.now() - entry.lastTouchedAt) / 86_400_000)
        if (idleDays >= 3) pieces.push(`⚠️ 已 ${idleDays} 天未更新`)
        pieces.push(`workspace=${entry.workspace ?? roster.taskDir(entry.id)}`)
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
