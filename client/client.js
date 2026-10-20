// dsh-longtasks 浏览器半侧（零构建 vanilla，单模块）。
//
// 宿主端 dsh.client 扫描把本文件作为 classic script 注入 __DSH_BOOT__ 图；
// 执行时经 window.__ModuleLoader__.load 注册唯一 factory（id 必须等于插件名，
// 与宿主 graph row 一致）。apply 挂两块表面：左侧栏一级入口 + 整页看板。
// 文案走 ctx.locale 词典（zh / en），组件用注册时声明的 t 座位。
;(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__ || typeof window.__ModuleLoader__.load !== 'function') return
  window.__ModuleLoader__.load({
    id: 'dsh-longtasks',
    /**
     * @param {(id: string) => any} require - 宿主模块解析函数（react 为平台内置）。
     * @returns {{name: string, inject: string[], apply: (ctx: any) => void}}
     */
    factory: function (require) {
      const React = require('react')
      const h = React.createElement
      const { useCallback, useEffect, useMemo, useState } = React

      const PANEL_ID = 'longtasks'
      const NS = 'longtasks'
      const STYLE_ID = 'dsh-longtasks-panel-style'

      const GROUPS = [
        { status: 'active', tone: 'info' },
        { status: 'waiting', tone: 'warning' },
        { status: 'done', tone: 'success' },
        { status: 'archived', tone: 'outline' },
      ]

      const zh = {
        panel: '长线任务',
        intro: '跨天跟进的任务：一条档案对应一个常驻会话，点任务名回到现场。',
        refresh: '刷新',
        showArchived: '显示已归档',
        hideArchived: '隐藏已归档',
        create: '新建',
        createName: '名字',
        createNameHint: '例如：Desktop 0.7.10 异常跟踪',
        createBrief: '核心思想',
        createBriefHint: '这个任务是什么、为什么做、硬约束是什么（可后补）',
        submit: '创建',
        cancel: '取消',
        created: '已创建「{name}」。还没有绑定会话：到目标会话里说「把长线任务 {id} 绑定到当前会话」，或在那里运行 /longtask bind {id}。',
        loading: '正在读取花名册…',
        emptyTitle: '还没有登记任何长线任务。',
        emptyA: '在任意会话里说一句「把这件事建成长线任务」，模型会调用',
        emptyB: '建一条档案并绑定当前会话。',
        emptyC: '之后每天从这行点回去；收工让它用',
        emptyD: '记下结论和下一步。',
        errorPrefix: '花名册读取失败：',
        statusActive: '进行中',
        statusWaiting: '等待中',
        statusDone: '已完成',
        statusArchived: '已归档',
        running: '运行中',
        idleDays: '{n} 天未动',
        next: '下一步：',
        updatedAgo: '更新于 {ago}',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        session: '会话：{title}',
        sessionMissing: '会话不可见（可能已归档或未同步）',
        unbound: '未绑定会话',
        files: 'workspace {n} 个文件',
        notesCount: '记录 {n}',
        copyBrief: '复制简报',
        briefCopied: '「{name}」的交接简报已复制。',
        copyFailed: '复制失败：{error}',
        openFailed: '打开会话失败：{error}',
        openHint: '打开负责这个任务的会话',
        expandHint: '展开核心思想、最近记录与 workspace 文件',
        done: '完成',
        reopen: '恢复',
        resume: '继续',
        archive: '归档',
        coreIdea: '核心思想',
        recentNotes: '最近记录',
        workspaceTitle: 'workspace（结构由这个任务自己决定）',
        bindTip: '在目标会话运行 /longtask bind {id}',
        openWorkspace: '打开目录',
        openWorkspaceHint: '在文件管理器里打开这个任务的 workspace',
        workspaceFailed: '打开目录失败：{error}',
        workspaceCopied: '已复制 workspace 路径：{path}',
      }

      const en = {
        panel: 'Long tasks',
        intro: 'Long-running work: each task keeps one pinned session — click a name to jump back.',
        refresh: 'Refresh',
        showArchived: 'Show archived',
        hideArchived: 'Hide archived',
        create: 'New',
        createName: 'Name',
        createNameHint: 'e.g. Desktop 0.7.10 error triage',
        createBrief: 'Core idea',
        createBriefHint: 'What this task is, why it exists, what is non-negotiable (can be filled later)',
        submit: 'Create',
        cancel: 'Cancel',
        created: 'Created "{name}". It has no session yet: run /longtask bind {id} in the session that should own it.',
        loading: 'Reading the roster…',
        emptyTitle: 'No long task yet.',
        emptyA: 'Say "make this a long task" in any session — the model calls',
        emptyB: 'to create one bound to that session.',
        emptyC: 'Come back here to jump into it; before finishing, let it record conclusions with',
        emptyD: 'and update the next step.',
        errorPrefix: 'Could not read the roster: ',
        statusActive: 'Active',
        statusWaiting: 'Waiting',
        statusDone: 'Done',
        statusArchived: 'Archived',
        running: 'Running',
        idleDays: '{n}d idle',
        next: 'Next: ',
        updatedAgo: 'updated {ago}',
        justNow: 'just now',
        minutesAgo: '{n} min ago',
        hoursAgo: '{n} h ago',
        daysAgo: '{n} d ago',
        session: 'Session: {title}',
        sessionMissing: 'session unavailable (archived or not synced)',
        unbound: 'no session bound',
        files: '{n} workspace files',
        notesCount: '{n} notes',
        copyBrief: 'Copy brief',
        briefCopied: 'Handoff brief for "{name}" copied.',
        copyFailed: 'Copy failed: {error}',
        openFailed: 'Could not open the session: {error}',
        openHint: 'Open the session that owns this task',
        expandHint: 'Show core idea, recent notes and workspace files',
        done: 'Done',
        reopen: 'Reopen',
        resume: 'Resume',
        archive: 'Archive',
        coreIdea: 'Core idea',
        recentNotes: 'Recent notes',
        workspaceTitle: 'workspace (its structure is up to the task)',
        bindTip: 'Run /longtask bind {id} in the target session',
        openWorkspace: 'Open folder',
        openWorkspaceHint: 'Open this task workspace in the file manager',
        workspaceFailed: 'Could not open the folder: {error}',
        workspaceCopied: 'Workspace path copied: {path}',
      }

      const STATUS_KEY = {
        active: 'statusActive',
        waiting: 'statusWaiting',
        done: 'statusDone',
        archived: 'statusArchived',
      }

      const CSS = `
.lt-page {
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  padding: 0 clamp(24px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, inherit);
}
.lt-column {
  display: flex;
  flex-direction: column;
  gap: 28px;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
}
.lt-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-top: 28px;
}
[data-platform='darwin'] .lt-head {
  padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));
}
.lt-headText { min-width: 0; }
.lt-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 28px;
}
.lt-titleCount {
  font-size: 14px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}
.lt-intro {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  max-width: 68ch;
}
.lt-toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
.lt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.lt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.lt-btn:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.lt-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.lt-btn.quiet { color: var(--dsw-alias-label-secondary); }
.lt-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.lt-notice {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.lt-notice.error { color: var(--dsw-alias-state-error-primary); }
.lt-group { display: flex; flex-direction: column; gap: 8px; }
.lt-groupHead { display: flex; align-items: baseline; gap: 8px; }
.lt-groupTitle { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; }
.lt-count {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}
.lt-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.lt-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 -8px;
  padding: 8px;
  border-radius: var(--dsw-radius-xl);
}
.lt-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lt-row[data-done] .lt-rowName { color: var(--dsw-alias-label-secondary); }
.lt-rowIcon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  color: var(--dsw-alias-label-secondary);
}
.lt-rowMain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lt-titleRow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.lt-rowName {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.lt-rowOpen {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lt-rowOpen::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--dsw-radius-xl);
}
.lt-rowOpen:focus-visible { outline: none; }
.lt-rowOpen:focus-visible::after {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.lt-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
}
.lt-tag[data-tone='info'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  color: var(--dsw-alias-state-business-primary);
}
.lt-tag[data-tone='warning'] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  color: var(--dsw-alias-state-warn-primary);
}
.lt-tag[data-tone='success'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.lt-tag[data-tone='neutral'] {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.lt-tag[data-tone='outline'] {
  border: 0.5px solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}
.lt-desc {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lt-next {
  display: flex;
  gap: 6px;
  margin: 2px 0 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  min-width: 0;
}
.lt-nextLabel { flex: none; color: var(--dsw-alias-label-tertiary); }
.lt-nextText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lt-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.lt-metaSep { width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: 0.6; }
.lt-metaPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.lt-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.lt-row:hover .lt-actions,
.lt-row:focus-within .lt-actions { opacity: 1; }
@media (hover: none) { .lt-actions { opacity: 1; } }
.lt-logLabel {
  margin: 8px 0 0;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-caption);
}
.lt-briefBody {
  margin: 2px 0 0;
  font-size: 12.5px;
  line-height: 19px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
}
.lt-pathBtn {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  max-width: 100%;
}
.lt-pathBtn:hover { color: var(--dsw-alias-link); text-decoration: underline; }
.lt-path {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lt-noteText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lt-notes { display: flex; flex-direction: column; gap: 2px; margin: 6px 0 0; padding: 0; list-style: none; }
.lt-note {
  display: flex;
  gap: 10px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.lt-noteTime {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.lt-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.lt-emptyTitle { color: var(--dsw-alias-label-secondary); }
.lt-empty code {
  padding: 1px 5px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-markdown-inline-code);
  font-size: 12px;
}
.lt-loading { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.lt-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  max-width: 620px;
}
.lt-formField { display: flex; flex-direction: column; gap: 4px; }
.lt-formLabel { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.lt-input, .lt-textarea {
  box-sizing: border-box;
  width: 100%;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  padding: 6px 10px;
  outline: none;
}
.lt-textarea { resize: vertical; min-height: 64px; }
.lt-input:focus, .lt-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
.lt-formActions { display: flex; justify-content: flex-end; gap: 6px; }
`

      function ensureStyle() {
        if (typeof document === 'undefined' || document.head === null) return
        for (const stale of document.querySelectorAll(`style[id^="${STYLE_ID}"]`)) stale.remove()
        const tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.setAttribute('data-plugin', 'dsh-longtasks')
        tag.textContent = CSS
        document.head.appendChild(tag)
      }

      function pad2(value) { return String(value).padStart(2, '0') }

      function formatTime(ms) {
        const date = new Date(ms)
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      }

      function formatAgo(ms, t) {
        const delta = Date.now() - ms
        if (!Number.isFinite(delta)) return '—'
        if (delta < 60 * 1000) return t('justNow')
        if (delta < 60 * 60 * 1000) return t('minutesAgo', { n: Math.floor(delta / 60000) })
        if (delta < 24 * 60 * 60 * 1000) return t('hoursAgo', { n: Math.floor(delta / 3600000) })
        if (delta < 30 * 24 * 60 * 60 * 1000) return t('daysAgo', { n: Math.floor(delta / 86400000) })
        return formatTime(ms)
      }

      async function fetchRoster() {
        const response = await fetch('/api/longtasks/roster', { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload === null || payload.ok !== true) {
          throw new Error((payload && payload.error) || `HTTP ${response.status}`)
        }
        return payload
      }

      async function postAction(body) {
        const response = await fetch('/api/longtasks/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload === null || payload.ok !== true) {
          throw new Error((payload && payload.error) || `HTTP ${response.status}`)
        }
        return payload
      }

      function copyText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(text)
        }
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        try { document.execCommand('copy') } finally { document.body.removeChild(area) }
        return Promise.resolve()
      }

      /** 侧栏图标：三条任务线 + 一个勾，全部走 currentColor。 */
      function RosterIcon({ size }) {
        const edge = typeof size === 'number' ? size : 16
        return h('svg', {
          width: edge, height: edge, viewBox: '0 0 16 16', fill: 'none',
          'aria-hidden': 'true', focusable: 'false',
        },
        h('path', { d: 'M2.5 3.5h7M2.5 8h7M2.5 12.5h4.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M10.5 11.6l1.6 1.6 3-3.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }

      /** 列表行首格里的同一枚字形（48px 方框内按 20px 画）。 */
      function RowGlyph() {
        return h('svg', {
          width: 20, height: 20, viewBox: '0 0 16 16', fill: 'none',
          'aria-hidden': 'true', focusable: 'false',
        },
        h('path', { d: 'M2.5 3.5h7M2.5 8h7M2.5 12.5h4.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M10.5 11.6l1.6 1.6 3-3.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }

      /**
       * 组装看板页。组件身份在 apply 时创建一次（渲染期不新建组件），
       * 因此 ctx 只通过闭包进入，不会泄漏到 props。
       */
      function makePage(ctx, fallbackT) {
        return function LongTasksPage(props) {
          const t = props !== undefined && typeof props.t === 'function' ? props.t : fallbackT
          const [state, setState] = useState({ phase: 'loading', entries: [], error: null })
          const [busyId, setBusyId] = useState(null)
          const [notice, setNotice] = useState(null)
          const [showArchived, setShowArchived] = useState(false)
          const [expanded, setExpanded] = useState({})
          const [tick, setTick] = useState(0)
          const [draft, setDraft] = useState(null)

          const load = useCallback(async () => {
            try {
              const payload = await fetchRoster()
              setState({ phase: 'ready', entries: payload.entries ?? [], error: null })
            } catch (error) {
              setState((previous) => ({
                ...previous,
                phase: previous.phase === 'loading' ? 'failed' : previous.phase,
                error: error instanceof Error ? error.message : String(error),
              }))
            }
          }, [])

          useEffect(() => { void load() }, [load])
          useEffect(() => {
            const timer = window.setInterval(() => { void load() }, 12000)
            return () => { window.clearInterval(timer) }
          }, [load])

          // 会话标题/运行状态来自会话目录本身，跟着它刷新即可。
          useEffect(() => {
            const source = ctx.sessions && ctx.sessions.list
            if (source === undefined || source === null) return undefined
            const bump = () => { setTick((value) => value + 1) }
            const dispose = source.subscribe(bump)
            return typeof dispose === 'function' ? dispose : undefined
          }, [])

          const sessionIndex = useMemo(() => {
            const source = ctx.sessions && ctx.sessions.list
            const snapshot = source === undefined || source === null ? null : source.getSnapshot()
            return (snapshot && snapshot.byId) || {}
          }, [tick, state.entries])

          const runAction = useCallback(async (entry, action, extra) => {
            setBusyId(entry.id)
            setNotice(null)
            try {
              await postAction({ action, id: entry.id, ...extra })
              await load()
            } catch (error) {
              setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
            } finally {
              setBusyId(null)
            }
          }, [load])

          const createTask = useCallback(async () => {
            if (draft === null || draft.name.trim().length === 0) return
            setBusyId('new')
            setNotice(null)
            try {
              const created = await postAction({ action: 'create', name: draft.name, brief: draft.brief })
              setDraft(null)
              await load()
              setNotice({ kind: 'ok', text: t('created', { name: created.entry.name, id: created.entry.id }) })
            } catch (error) {
              setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
            } finally {
              setBusyId(null)
            }
          }, [draft, load, t])

          const openSession = useCallback((entry) => {
            if (entry.sessionId === undefined || entry.sessionId === null) return
            try {
              ctx.layout.selectPanel(null)
              ctx.uiWorkspace.openSession(entry.sessionId)
            } catch (error) {
              setNotice({ kind: 'error', text: t('openFailed', { error: error instanceof Error ? error.message : String(error) }) })
            }
          }, [t])

          const openWorkspace = useCallback(async (entry) => {
            const path = entry.workspace
            if (typeof path !== 'string' || path.length === 0) return
            // 可选服务：浏览器里没有桌面能力，退化成复制路径。
            const remote = typeof ctx.get === 'function' ? ctx.get('remote') : undefined
            const sessionRemote = remote === undefined || remote === null ? undefined : remote.session
            try {
              if (sessionRemote !== undefined && typeof sessionRemote.openWorkspacePath === 'function') {
                const result = await sessionRemote.openWorkspacePath({ path, action: 'open' })
                if (result !== null && result !== undefined && result.ok === true) return
              }
            } catch (error) {
              console.warn('dsh-longtasks: openWorkspacePath failed', error)
            }
            try {
              await copyText(path)
              setNotice({ kind: 'ok', text: t('workspaceCopied', { path }) })
            } catch (error) {
              setNotice({ kind: 'error', text: t('workspaceFailed', { error: error instanceof Error ? error.message : String(error) }) })
            }
          }, [t])

          const copyBrief = useCallback(async (entry) => {
            try {
              await copyText(entry.handoff || entry.brief || entry.name)
              setNotice({ kind: 'ok', text: t('briefCopied', { name: entry.name }) })
            } catch (error) {
              setNotice({ kind: 'error', text: t('copyFailed', { error: error instanceof Error ? error.message : String(error) }) })
            }
          }, [t])

          const entries = state.entries
          const visible = showArchived ? entries : entries.filter((entry) => entry.status !== 'archived')
          const busy = busyId !== null

          const groups = GROUPS.map((group) => ({
            ...group,
            rows: visible.filter((entry) => entry.status === group.status),
          })).filter((group) => group.rows.length > 0)

          const renderRow = (entry) => {
            const session = entry.sessionId ? sessionIndex[entry.sessionId] : undefined
            const running = session !== undefined && session.running === true
            const lastActivity = session !== undefined ? session.updatedAt : (entry.lastTouchedAt ?? entry.updatedAt)
            const notes = Array.isArray(entry.notes) ? entry.notes : []
            const files = Array.isArray(entry.files) ? entry.files : []
            const idleDays = Math.floor((Date.now() - lastActivity) / 86400000)
            const canOpen = entry.sessionId !== undefined && entry.sessionId !== null
            const isOpen = expanded[entry.id] === true
            const group = GROUPS.find((item) => item.status === entry.status) || { tone: 'outline' }

            const meta = [
              h('span', { key: 'upd' }, t('updatedAgo', { ago: formatAgo(lastActivity, t) })),
              h('span', { key: 'dot1', className: 'lt-metaSep' }),
              h('span', {
                key: 'sess',
                className: 'lt-metaPath',
                title: canOpen ? entry.sessionId : (entry.id ? t('bindTip', { id: entry.id }) : undefined),
              },
              session !== undefined
                ? t('session', { title: session.displayTitle })
                : (canOpen ? t('sessionMissing') : t('unbound'))),
            ]
            if (files.length > 0) {
              meta.push(h('span', { key: 'dot2', className: 'lt-metaSep' }))
              meta.push(h('span', { key: 'ws' }, t('files', { n: files.length })))
            }

            return h('li', {
              key: entry.id,
              className: 'lt-row',
              'data-done': entry.status === 'done' || entry.status === 'archived' ? '' : undefined,
            },
            h('span', { className: 'lt-rowIcon', 'aria-hidden': 'true' }, h(RowGlyph, null)),
            h('div', { className: 'lt-rowMain' },
              h('div', { className: 'lt-titleRow' },
                canOpen
                  ? h('button', {
                    type: 'button',
                    className: 'lt-rowOpen',
                    title: t('openHint'),
                    onClick: () => { openSession(entry) },
                  }, entry.name)
                  : h('span', { className: 'lt-rowName' }, entry.name),
                entry.kind
                  ? h('span', { className: 'lt-tag', 'data-tone': 'outline' }, entry.kind)
                  : null,
                h('span', { className: 'lt-tag', 'data-tone': group.tone }, t(STATUS_KEY[entry.status] ?? 'statusActive')),
                running ? h('span', { className: 'lt-tag', 'data-tone': 'neutral' }, t('running')) : null,
                idleDays >= 3 && (entry.status === 'active' || entry.status === 'waiting')
                  ? h('span', {
                    className: 'lt-tag', 'data-tone': 'warning',
                    title: formatTime(lastActivity),
                  }, t('idleDays', { n: idleDays }))
                  : null),
              entry.brief ? h('p', { className: 'lt-desc', title: entry.brief }, entry.brief) : null,
              entry.next
                ? h('p', { className: 'lt-next', title: entry.next },
                  h('span', { className: 'lt-nextLabel' }, t('next')),
                  h('span', { className: 'lt-nextText' }, entry.next))
                : null,
              h('div', { className: 'lt-meta' }, meta),
              isOpen
                ? h(React.Fragment, null,
                  entry.brief
                    ? h(React.Fragment, null,
                      h('p', { className: 'lt-logLabel' }, t('coreIdea')),
                      h('p', { className: 'lt-briefBody' }, entry.brief))
                    : null,
                  notes.length > 0
                    ? h(React.Fragment, null,
                      h('p', { className: 'lt-logLabel' }, t('recentNotes')),
                      h('ul', { className: 'lt-notes' }, notes.slice(0, 6).map((note, index) => h('li', { key: index, className: 'lt-note' },
                        h('time', { className: 'lt-noteTime', title: formatTime(note.at) }, formatAgo(note.at, t)),
                        h('span', { className: 'lt-noteText' }, note.text)))))
                    : null,
                  files.length > 0
                    ? h(React.Fragment, null,
                      h('p', { className: 'lt-logLabel' }, t('workspaceTitle')),
                      h('ul', { className: 'lt-notes' }, files.slice(0, 12).map((file, index) => h('li', { key: index, className: 'lt-note' },
                        h('span', { className: 'lt-noteText' }, file)))),
                      h('button', {
                        type: 'button', className: 'lt-path lt-pathBtn', title: t('openWorkspaceHint'),
                        onClick: () => { void openWorkspace(entry) },
                      }, entry.workspace))
                    : h('button', {
                      type: 'button', className: 'lt-path lt-pathBtn', title: t('openWorkspaceHint'),
                      onClick: () => { void openWorkspace(entry) },
                    }, entry.workspace ?? ''))
                : null),
            h('div', { className: 'lt-actions' },
              h('button', {
                type: 'button', className: 'lt-btn quiet', disabled: busy,
                title: t('expandHint'),
                onClick: () => { setExpanded((value) => ({ ...value, [entry.id]: value[entry.id] !== true })) },
              }, t('notesCount', { n: notes.length })),
              h('button', {
                type: 'button', className: 'lt-btn quiet', disabled: busy || !entry.workspace,
                title: t('openWorkspaceHint'),
                onClick: () => { void openWorkspace(entry) },
              }, t('openWorkspace')),
              h('button', {
                type: 'button', className: 'lt-btn quiet',
                onClick: () => { void copyBrief(entry) },
              }, t('copyBrief')),
              entry.status === 'done' || entry.status === 'archived'
                ? h('button', {
                  type: 'button', className: 'lt-btn quiet', disabled: busy,
                  onClick: () => { void runAction(entry, 'update', { status: 'active' }) },
                }, t('reopen'))
                : h('button', {
                  type: 'button', className: 'lt-btn quiet', disabled: busy,
                  onClick: () => { void runAction(entry, 'update', { status: entry.status === 'waiting' ? 'active' : 'done' }) },
                }, entry.status === 'waiting' ? t('resume') : t('done')),
              entry.status === 'archived'
                ? null
                : h('button', {
                  type: 'button', className: 'lt-btn quiet', disabled: busy,
                  onClick: () => { void runAction(entry, 'archive') },
                }, t('archive'))))
          }

          const total = visible.length
          const body = state.phase === 'loading' && entries.length === 0
            ? h('p', { className: 'lt-loading' }, t('loading'))
            : total === 0
              ? h('div', { className: 'lt-empty' },
                h('span', { className: 'lt-emptyTitle' }, t('emptyTitle')),
                h('span', null, t('emptyA'), ' ', h('code', null, 'longtask create'), ' ', t('emptyB')),
                h('span', null, t('emptyC'), ' ', h('code', null, 'longtask note'), ' ', t('emptyD')))
              : h(React.Fragment, null, groups.map((group) => h('section', { key: group.status, className: 'lt-group' },
                h('div', { className: 'lt-groupHead' },
                  h('h2', { className: 'lt-groupTitle' }, t(STATUS_KEY[group.status] ?? 'statusActive')),
                  h('span', { className: 'lt-count' }, String(group.rows.length))),
                h('ul', { className: 'lt-rows' }, group.rows.map(renderRow)))))

          const form = draft === null ? null : h('div', { className: 'lt-form' },
            h('label', { className: 'lt-formField' },
              h('span', { className: 'lt-formLabel' }, t('createName')),
              h('input', {
                className: 'lt-input',
                value: draft.name,
                placeholder: t('createNameHint'),
                autoFocus: true,
                onChange: (event) => { setDraft({ ...draft, name: event.target.value }) },
                onKeyDown: (event) => { if (event.key === 'Enter') void createTask() },
              })),
            h('label', { className: 'lt-formField' },
              h('span', { className: 'lt-formLabel' }, t('createBrief')),
              h('textarea', {
                className: 'lt-textarea',
                rows: 3,
                value: draft.brief,
                placeholder: t('createBriefHint'),
                onChange: (event) => { setDraft({ ...draft, brief: event.target.value }) },
              })),
            h('div', { className: 'lt-formActions' },
              h('button', {
                type: 'button', className: 'lt-btn primary', disabled: busy || draft.name.trim().length === 0,
                onClick: () => { void createTask() },
              }, t('submit')),
              h('button', {
                type: 'button', className: 'lt-btn quiet',
                onClick: () => { setDraft(null) },
              }, t('cancel'))))

          return h('div', { className: 'lt-page' },
            h('div', { className: 'lt-column' },
              h('div', { className: 'lt-head' },
                h('div', { className: 'lt-headText' },
                  h('h1', { className: 'lt-title' },
                    t('panel'),
                    total > 0 ? h('span', { className: 'lt-titleCount' }, String(total)) : null),
                  h('p', { className: 'lt-intro' }, t('intro'))),
                h('div', { className: 'lt-toolbar' },
                  draft === null
                    ? h('button', {
                      type: 'button', className: 'lt-btn quiet', disabled: busy,
                      onClick: () => { setDraft({ name: '', brief: '' }) },
                    }, t('create'))
                    : null,
                  h('button', {
                    type: 'button', className: 'lt-btn quiet', disabled: busy,
                    onClick: () => { void load() },
                  }, t('refresh')),
                  h('button', {
                    type: 'button', className: 'lt-btn quiet',
                    onClick: () => { setShowArchived((value) => !value) },
                  }, showArchived ? t('hideArchived') : t('showArchived')))),
              form,
              state.error !== null
                ? h('p', { className: 'lt-notice error' }, t('errorPrefix') + state.error)
                : null,
              notice !== null
                ? h('p', { className: `lt-notice${notice.kind === 'error' ? ' error' : ''}` }, notice.text)
                : null,
              body)
          )
        }
      }

      /**
       * @param {any} ctx - 客户端根上下文。
       */
      function apply(ctx) {
        ensureStyle()
        // 存活探针：面板半侧是否真被宿主加载，看 ~/.dsh/longtasks/client-ping.json。
        try { void fetch('/api/longtasks/ping', { method: 'POST' }) } catch {}
        const unset = () => ''
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-longtasks: dictionaries')
        const t = ctx.locale.bind(NS)
        const Page = makePage(ctx, typeof t === 'function' ? t : unset)

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, Page))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, RosterIcon))
      }

      return {
        name: 'longtasks-client',
        inject: ['slots', 'layout', 'uiWorkspace', 'sessions', 'locale'],
        apply,
      }
    },
  })
})()
