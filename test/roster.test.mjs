import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'dsh-longtasks-'))
process.env.DSH_LONGTASKS_DIR = root

const { Roster, formatBrief, rosterDir } = await import('../index.mjs')

const facts = { sessionId: 'session-test-1', cwd: '/tmp/project' }

function reset() {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
}

function fresh() { return new Roster(root) }

function taskFile(id) { return join(rosterDir(), id, 'TASK.md') }

function readTask(id) { return readFileSync(taskFile(id), 'utf8') }

after(() => { rmSync(root, { recursive: true, force: true }) })

describe('任务目录与档案', () => {
  beforeEach(() => { reset() })

  it('一个任务 = 一个目录：TASK.md 存档案，目录本身就是 workspace', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '迁移管线', brief: '把 Flux 契约迁到新管线，不碰旧路径', next: '先跑通单帧导出', kind: 'feature' }, facts)
    assert.equal(entry.workspace, join(rosterDir(), entry.id))
    assert.ok(existsSync(taskFile(entry.id)))
    const text = readTask(entry.id)
    assert.match(text, /^---\nid: lt-[0-9a-f]{8}\nname: 迁移管线\nstatus: active\nkind: feature\nnext: 先跑通单帧导出\n/)
    assert.match(text, /workspace: /)
    assert.match(text, /## 核心思想\n\n把 Flux 契约迁到新管线/)
    assert.match(text, /## 工作记录/)
    assert.ok(existsSync(join(root, 'INDEX.md')))
  })

  it('同名拒绝，归档后可复用', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '重复任务' }, facts)
    assert.ok(roster.create({ name: '重复任务' }, facts).error)
    roster.update(entry.id, { status: 'archived' })
    assert.equal(roster.create({ name: '重复任务' }, facts).error, undefined)
  })

  it('note 追加阶段性结论，按时间倒序，并进入简报', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '带记录', brief: '核心' }, facts)
    roster.addNote(entry.id, '第一阶段：改完取消逻辑，61 个用例通过')
    roster.addNote(entry.id, '第二阶段：缩略图重试收敛，量级待发版验证')
    const text = readTask(entry.id)
    assert.ok(text.indexOf('第二阶段') < text.indexOf('第一阶段'))
    const reloaded = fresh().get(entry.id).entry
    assert.equal(reloaded.notes.length, 2)
    const brief = formatBrief(reloaded)
    assert.match(brief, /## 核心思想\n\n核心/)
    assert.match(brief, /第二阶段：缩略图重试收敛/)
    assert.match(brief, /## 下一步/)
  })

  it('改状态/下一步只动 frontmatter，正文原样保留', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '改状态', brief: '核心 A' }, facts)
    roster.update(entry.id, { status: 'waiting', next: '等接口', brief: '核心 B' })
    const text = readTask(entry.id)
    assert.match(text, /status: waiting/)
    assert.match(text, /next: 等接口/)
    assert.match(text, /## 核心思想\n\n核心 B/)
  })

  it('agent 自己在 TASK.md 里加的小节不会被插件写坏', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '自由结构', brief: '核心' }, facts)
    writeFileSync(taskFile(entry.id), `${readTask(entry.id)}\n## 待修清单\n\n- [ ] D-003 删除中打开\n- [ ] D-006 恢复失败补码\n`)
    roster.update(entry.id, { next: '先做 D-003' })
    roster.addNote(entry.id, '一条结论')
    const text = readTask(entry.id)
    assert.match(text, /## 待修清单\n\n- \[ \] D-003 删除中打开\n- \[ \] D-006 恢复失败补码/)
    assert.match(text, /next: 先做 D-003/)
    assert.match(text, /一条结论/)
  })

  it('workspace 里的文件被列出来，TASK.md 除外', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '有工作区', brief: '核心' }, facts)
    writeFileSync(join(entry.workspace, 'issue-ledger.md'), '# 台账\n')
    mkdirSync(join(entry.workspace, 'queries'), { recursive: true })
    writeFileSync(join(entry.workspace, 'queries', 'q1.sql'), 'select 1')
    const files = roster.workspaceFiles(fresh().get(entry.id).entry)
    const paths = files.map((file) => file.path).sort()
    assert.deepEqual(paths, ['issue-ledger.md', 'queries/q1.sql'])
  })

  it('按 id / 名字 / 唯一片段解析', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: 'Desktop 异常跟踪' }, facts)
    assert.equal(roster.get(entry.id).entry.id, entry.id)
    assert.equal(roster.get('Desktop 异常跟踪').entry.id, entry.id)
    assert.equal(roster.get('异常').entry.id, entry.id)
    assert.ok(roster.get('不存在').error)
  })

  it('默认视图隐藏归档；删除会连目录一起删', () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '要归档的' }, facts)
    roster.update(entry.id, { status: 'archived' })
    assert.equal(roster.visible().length, 0)
    assert.equal(roster.visible({ includeArchived: true }).length, 1)
    roster.remove(entry.id)
    assert.equal(existsSync(join(rosterDir(), entry.id)), false)
  })

  it('旧版 roster.json 迁移成任务目录', () => {
    writeFileSync(join(root, 'roster.json'), JSON.stringify({
      version: 1,
      entries: [{ id: 'lt-12345678', name: '旧账本里的', status: 'active', goal: '旧目标', updatedAt: Date.now() }],
    }))
    const entries = fresh().all()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, '旧账本里的')
    assert.ok(existsSync(taskFile('lt-12345678')))
    assert.equal(existsSync(join(root, 'roster.json')), false)
    assert.ok(readdirSync(root).some((name) => name.startsWith('roster.json.migrated-')))
  })

  it('早期多一层的 tasks/<id>/ 会合并到 <id>/，已有工作区文件不丢', () => {
    mkdirSync(join(rosterDir(), 'lt-77777777'), { recursive: true })
    writeFileSync(join(rosterDir(), 'lt-77777777', 'TASK.md'), '---\nid: lt-77777777\nname: 多一层的\nstatus: active\n---\n\n## 核心思想\n\n旧的\n')
    mkdirSync(join(rosterDir(), 'tasks', 'lt-77777777'), { recursive: true })
    writeFileSync(join(rosterDir(), 'tasks', 'lt-77777777', 'work.md'), 'agent 写的东西\n')
    const entries = fresh().all()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, '多一层的')
    assert.equal(readFileSync(join(rosterDir(), 'lt-77777777', 'work.md'), 'utf8'), 'agent 写的东西\n')
    assert.equal(existsSync(join(rosterDir(), 'tasks')), false)
  })

  it('早期平铺的 tasks/<id>.md 迁移进任务目录', () => {
    mkdirSync(rosterDir(), { recursive: true })
    writeFileSync(join(rosterDir(), 'lt-99999999.md'), '---\nid: lt-99999999\nname: 平铺的\nstatus: active\n---\n\n## 核心思想\n\n旧的\n')
    const entries = fresh().all()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, '平铺的')
    assert.equal(existsSync(join(rosterDir(), 'lt-99999999.md')), false)
    assert.ok(existsSync(taskFile('lt-99999999')))
  })
})

describe('/longtask 命令', () => {
  beforeEach(() => { reset() })
  const invocation = (rawInput) => ({
    rawInput,
    agent: { session: { id: 'session-test-1', header: { cwd: '/tmp/project' } } },
  })

  it('new → list → note → done → brief', async () => {
    const { runCommand } = await import('../index.mjs')
    const roster = fresh()
    assert.equal(runCommand(roster, invocation('new 命令建的')).kind, 'success')
    assert.match(runCommand(roster, invocation('list')).text, /命令建的/)
    assert.equal(runCommand(roster, invocation('note 命令建的 第一阶段收尾')).kind, 'success')
    assert.match(runCommand(roster, invocation('done 命令建的')).text, /已完成/)
    assert.match(runCommand(roster, invocation('brief 命令建的')).text, /第一阶段收尾/)
  })

  it('未知子命令给出用法', async () => {
    const { runCommand } = await import('../index.mjs')
    const roster = fresh()
    const result = runCommand(roster, invocation('lolwut'))
    assert.equal(result.kind, 'error')
    assert.match(result.text, /list \| show/)
  })
})

describe('工具与系统提示', () => {
  beforeEach(() => { reset() })

  const applyOnce = async () => {
    const tools = []
    const sections = []
    const ctx = {
      get: () => undefined,
      on: () => () => {},
      effect: () => () => {},
      tools: { register: (tool) => tools.push(tool) },
      systemPrompt: { section: (section) => sections.push(section) },
    }
    const { apply } = await import('../index.mjs')
    apply(ctx)
    return { tool: tools[0], section: sections[0] }
  }

  it('create/list/show/note/brief 全链路，show 返回 TASK.md 原文', async () => {
    const { tool } = await applyOnce()
    const exec = { agent: { session: { id: 'session-test-1', header: { cwd: '/tmp/project' } } } }
    const created = await tool.execute({ action: 'create', name: '跑通工具', brief: '核心思想', kind: 'bugfix' }, exec)
    assert.equal(created.ok, true)
    const createdText = tool.output.render({}, created)[0].text
    assert.match(createdText, /workspace/)
    assert.match(createdText, /不要放进 worktree/)

    await tool.execute({ action: 'note', target: created.entry.id, text: '第一阶段结论' }, exec)
    const listed = await tool.execute({ action: 'list' }, exec)
    assert.equal(listed.entries.length, 1)
    assert.match(tool.output.render({}, listed)[0].text, /跑通工具/)

    const shown = await tool.execute({ action: 'show', target: created.entry.id }, exec)
    assert.match(shown.markdown, /## 核心思想\n\n核心思想/)
    assert.match(shown.taskFile, /TASK\.md$/)

    const brief = await tool.execute({ action: 'brief', target: created.entry.id }, exec)
    assert.match(brief.brief, /第一阶段结论/)
    assert.match(brief.brief, /workspace/)
  })

  it('系统提示里带着工作原则，并点明本会话负责的任务', async () => {
    const roster = fresh()
    roster.create({ name: '原则检查', brief: '核心' }, facts)
    const { section } = await applyOnce()
    // 用条目绑定的会话 id，才能命中「本会话负责的任务」那一行
    const rendered = section.text({ agent: { session: { id: 'session-test-1', header: { cwd: '/tmp' } } } })
    assert.match(rendered, /工作原则/)
    assert.match(rendered, /不要放进 worktree 或临时目录/)
    assert.match(rendered, /状态归任务自己/)
    assert.match(rendered, /用户在本会话给出的提醒/)
    // 本会话绑定的任务被点名，提醒该往哪记一目了然
    assert.match(rendered, /本会话负责的任务：「原则检查」/)
  })

  it('久未更新的条目在系统提示里带警示', async () => {
    const roster = fresh()
    const { entry } = roster.create({ name: '放了很久的任务', brief: '核心' }, facts)
    const old = new Date(Date.now() - 6 * 86_400_000).toISOString()
    const text = readTask(entry.id)
    writeFileSync(taskFile(entry.id), text.replace(/updatedAt: .*/, `updatedAt: ${old}`))
    const { section } = await applyOnce()
    const rendered = section.text({ agent: { session: { id: 's', header: { cwd: '/tmp' } } } })
    assert.match(rendered, /放了很久的任务/)
    assert.match(rendered, /已 \d+ 天未更新/)
  })
})
