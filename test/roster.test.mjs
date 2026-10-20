import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

const dir = mkdtempSync(join(tmpdir(), 'dsh-longtasks-'))
process.env.DSH_LONGTASKS_FILE = join(dir, 'roster.json')

const { Roster, formatBrief, rosterFile } = await import('../index.mjs')

function resetRoster() {
  writeFileSync(rosterFile(), JSON.stringify({ version: 1, entries: [] }))
}

function freshRoster() {
  return new Roster()
}

const facts = { sessionId: 'session-test-1', cwd: '/tmp/project' }

describe('Roster', () => {
  beforeEach(() => { resetRoster() })
  after(() => { /* 临时目录随系统清理 */ })

  it('creates an entry bound to the current session', () => {
    resetRoster()
    const roster = freshRoster()
    const created = roster.create({ name: '迁移管线', goal: '换掉旧路径' }, facts)
    assert.equal(created.error, undefined)
    assert.match(created.entry.id, /^lt-[0-9a-f]{8}$/)
    assert.equal(created.entry.sessionId, 'session-test-1')
    assert.equal(created.entry.cwd, '/tmp/project')
    assert.equal(created.entry.status, 'active')
  })

  it('refuses a duplicate live name but allows reusing an archived one', () => {
    resetRoster()
    const roster = freshRoster()
    roster.create({ name: '重复任务' }, facts)
    assert.ok(roster.create({ name: '重复任务' }, facts).error)
    const archived = roster.get('重复任务').entry
    roster.update(archived.id, { status: 'archived' })
    assert.equal(roster.create({ name: '重复任务' }, facts).error, undefined)
  })

  it('appends notes and keeps them in the brief', () => {
    resetRoster()
    const roster = freshRoster()
    const { entry } = roster.create({ name: '带笔记' }, facts)
    roster.addNote(entry.id, '完成了 A 部分')
    roster.addNote(entry.id, '卡在 B 的接口上')
    const fresh = freshRoster()
    const found = fresh.get(entry.id).entry
    assert.equal(found.notes.length, 2)
    const brief = formatBrief(found)
    assert.match(brief, /完成了 A 部分/)
    assert.match(brief, /卡在 B 的接口上/)
    assert.match(brief, /## 下一步/)
  })

  it('reloads when the file changed outside the process', async () => {
    resetRoster()
    const roster = freshRoster()
    roster.create({ name: '别人改的' }, facts)
    assert.equal(roster.all().length, 1)
    // 外部进程写入：mtime 变化必须让缓存失效
    await new Promise((resolve) => setTimeout(resolve, 12))
    writeFileSync(rosterFile(), JSON.stringify({ version: 1, entries: [{ id: 'lt-00000000', name: '外部条目' }] }))
    assert.equal(roster.all().length, 1)
    assert.equal(roster.all()[0].name, '外部条目')
  })

  it('resolves targets by id, exact name, or a unique fragment', () => {
    resetRoster()
    const roster = freshRoster()
    const { entry } = roster.create({ name: 'Desktop 异常跟踪' }, facts)
    assert.equal(roster.get(entry.id).entry.id, entry.id)
    assert.equal(roster.get('Desktop 异常跟踪').entry.id, entry.id)
    assert.equal(roster.get('异常').entry.id, entry.id)
    assert.ok(roster.get('不存在').error)
  })

  it('hides archived entries from the default view', () => {
    resetRoster()
    const roster = freshRoster()
    const { entry } = roster.create({ name: '要归档的' }, facts)
    roster.update(entry.id, { status: 'archived' })
    assert.equal(roster.visible().length, 0)
    assert.equal(roster.visible({ includeArchived: true }).length, 1)
  })
})

describe('longtask tool', () => {
  it('runs create/list/note/brief through the tool surface', async () => {
    resetRoster()
    const registered = []
    const ctx = {
      get: () => undefined,
      on: () => () => {},
      effect: () => () => {},
      tools: { register: (tool) => registered.push(tool) },
      systemPrompt: { section: () => {} },
    }
    const { apply } = await import('../index.mjs')
    apply(ctx)
    const tool = registered[0]
    assert.equal(tool.name, 'longtask')
    const exec = { agent: { session: { id: 'session-test-1', header: { cwd: '/tmp/project' } } } }

    const created = await tool.execute({ action: 'create', name: '跑通工具', goal: 'g' }, exec)
    assert.equal(created.ok, true)
    await tool.execute({ action: 'note', target: created.entry.id, text: '记一条' }, exec)
    const listed = await tool.execute({ action: 'list' }, exec)
    assert.equal(listed.entries.length, 1)
    assert.match(tool.output.render({}, listed)[0].text, /跑通工具/)
    const brief = await tool.execute({ action: 'brief', target: created.entry.id }, exec)
    assert.match(brief.brief, /记一条/)
  })
})

describe('数据安全', () => {
  it('备份无法解析的花名册，而不是静默覆盖', async () => {
    const { readdirSync } = await import('node:fs')
    writeFileSync(rosterFile(), '{ 这不是 JSON')
    const roster = new Roster()
    assert.deepEqual(roster.all(), [])
    const backups = readdirSync(dir).filter((name) => name.includes('.corrupt-'))
    assert.equal(backups.length, 1)
    assert.match(backups[0], /^roster\.json\.corrupt-\d+$/)
  })

  it('外部写入后合并，不吞掉另一个进程新增的条目', () => {
    resetRoster()
    const mine = new Roster()
    assert.equal(mine.all().length, 0)
    // 模拟「载入之后盘上又变了，但 mtime 检测没发现」的时刻
    const staleStamp = mine.cacheStamp
    writeFileSync(rosterFile(), JSON.stringify({
      version: 1,
      entries: [{ id: 'lt-aaaaaaaa', name: '别的窗口建的', status: 'active', updatedAt: Date.now() }],
    }))
    mine.cacheStamp = staleStamp
    mine.create({ name: '我建的' }, facts)
    const names = mine.all().map((entry) => entry.name).sort()
    assert.deepEqual(names, ['别的窗口建的', '我建的'].sort())
  })

  it('删除的条目不会被合并复活', () => {
    resetRoster()
    const roster = new Roster()
    const { entry } = roster.create({ name: '待删除' }, facts)
    assert.equal(roster.all().length, 1)
    // 让下一次 flush 走合并分支
    roster.cacheStamp = -1
    roster.remove(entry.id)
    assert.equal(roster.all().length, 0)
  })
})

describe('/longtask 命令', () => {
  const invocation = (rawInput) => ({
    rawInput,
    agent: { session: { id: 'session-test-1', header: { cwd: '/tmp/project' } } },
  })

  it('new → list → note → done → brief 全链路', async () => {
    resetRoster()
    const { runCommand } = await import('../index.mjs')
    const roster = new Roster()

    assert.equal(runCommand(roster, invocation('new 命令建的')).kind, 'success')
    assert.match(runCommand(roster, invocation('list')).text, /命令建的/)
    assert.equal(runCommand(roster, invocation('note 命令建的 完成了第一段')).kind, 'success')
    assert.match(runCommand(roster, invocation('done 命令建的')).text, /已完成/)
    assert.match(runCommand(roster, invocation('brief 命令建的')).text, /完成了第一段/)
    assert.equal(runCommand(roster, invocation('list')).text.includes('已完成'), true)
  })

  it('空输入按 list 处理，未知子命令给出用法', async () => {
    resetRoster()
    const { runCommand } = await import('../index.mjs')
    const roster = new Roster()
    assert.equal(runCommand(roster, invocation('')).kind, 'success')
    const unknown = runCommand(roster, invocation('lolwut'))
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /list \| show/)
  })
})

describe('系统提示注入', () => {
  it('久未更新的条目带警示', async () => {
    resetRoster()
    const sixDaysAgo = Date.now() - 6 * 86_400_000
    writeFileSync(rosterFile(), JSON.stringify({
      version: 1,
      entries: [{
        id: 'lt-bbbbbbbb',
        name: '放了很久的任务',
        status: 'active',
        updatedAt: sixDaysAgo,
        createdAt: sixDaysAgo,
      }],
    }))
    const sections = []
    const ctx = {
      get: () => undefined,
      on: () => () => {},
      effect: () => () => {},
      tools: { register: () => {} },
      systemPrompt: { section: (section) => sections.push(section) },
    }
    const { apply } = await import('../index.mjs')
    apply(ctx)
    const text = sections[0].text({ agent: { session: { id: 's', header: { cwd: '/tmp' } } } })
    assert.match(text, /放了很久的任务/)
    assert.match(text, /已 6 天未更新/)
  })
})
