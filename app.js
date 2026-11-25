/* 宝宝成长记录 — 主程序（无外部依赖，数据全部保存在本机） */
'use strict';

/* ---------------- 配置 ---------------- */
const TYPES = {
  breast:  { name: '母乳喂养', short: '母乳', icon: '🤱', color: '#ff9aa2' },
  formula: { name: '奶粉喂养', short: '奶粉', icon: '🍼', color: '#f6ab62' },
  poop:    { name: '拉臭臭',   short: '臭臭', icon: '💩', color: '#b88967' },
  pee:     { name: '尿尿',     short: '尿尿', icon: '💧', color: '#f5cd57' },
  sleep:   { name: '睡眠',     short: '睡眠', icon: '😴', color: '#8fa9e8' },
  solid:   { name: '辅食',     short: '辅食', icon: '🥣', color: '#88bf7b' },
  health:  { name: '健康',     short: '健康', icon: '🌡️', color: '#ef767a' },
  growth:  { name: '成长',     short: '成长', icon: '📏', color: '#61c6d8' },
  note:    { name: '记事',     short: '记事', icon: '📝', color: '#b9a0d8' }
};
const CORE = ['breast', 'formula', 'pee', 'poop'];
const EXTRA = ['sleep', 'solid', 'health', 'growth', 'note'];
// 母乳可隐藏：隐藏时辅食顶替到第一排，母乳从快捷区移除（数据不删）
function coreTypes() { return state.settings.showBreast ? CORE : ['formula', 'solid', 'pee', 'poop']; }
function extraTypes() { return state.settings.showBreast ? EXTRA : ['sleep', 'health', 'growth', 'note']; }
const FEED_TYPES = ['breast', 'formula'];
// 母乳隐藏时，喝奶间隔只按奶粉计算
const isFeed = (e) => !!e && (state.settings.showBreast ? FEED_TYPES.includes(e.type) : e.type === 'formula');
const GROUPS = [
  { name: '喂养', types: ['breast', 'formula'], color: '#ff9aa2' },
  { name: '尿布', types: ['pee', 'poop'], color: '#f5cd57' },
  { name: '睡眠', types: ['sleep'], color: '#8fa9e8' },
  { name: '其他', types: ['solid', 'health', 'growth', 'note'], color: '#88bf7b' }
];
const DB_NAME = 'babylog';
const LS_EVENTS = 'babylog_events_v1';
const LS_SETTINGS = 'babylog_settings_v1';

/* ---------------- 工具 ---------------- */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const pad = (n) => String(n).padStart(2, '0');

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
}
function fmtFull(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); }
function isToday(ts) { return dayKey(ts) === dayKey(Date.now()); }
function isYesterday(ts) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return dayKey(ts) === dayKey(y.getTime());
}
function fmtDuration(min) {
  min = Math.round(Number(min) || 0);
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}小时${m}分` : `${h}小时`;
}
/* 把毫秒时间差格式化成易读的间隔文案 */
function fmtGap(ms) {
  ms = Math.max(0, Math.round(Number(ms) || 0));
  if (ms < 60000) return '刚刚';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h}小时${m}分` : `${h}小时`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}天${rh}小时` : `${d}天`;
}
/* 倒序列表中，第 i 条记录距上一条同类型记录的间隔（毫秒）；无同类上次返回 null */
function sameTypeGapBefore(list, i) {
  const cur = list[i];
  if (!cur) return null;
  for (let j = i + 1; j < list.length; j++) {
    if (list[j].type === cur.type) return cur.timestamp - list[j].timestamp;
  }
  return null;
}
/* 一组记录里相邻两次喝奶的平均间隔（毫秒），排除异常长间隔 */
function avgFeedGap(list) {
  const feeds = (list || []).filter(isFeed).sort((a, b) => b.timestamp - a.timestamp);
  if (feeds.length < 2) return null;
  let sum = 0, cnt = 0;
  for (let i = 0; i < feeds.length - 1; i++) {
    const gap = feeds[i].timestamp - feeds[i + 1].timestamp;
    if (gap > 0 && gap < 7 * 86400000) { sum += gap; cnt++; }
  }
  return cnt ? sum / cnt : null;
}
function ageString(birth) {
  if (!birth) return '设置生日后显示月龄';
  const b = new Date(birth), now = new Date();
  if (isNaN(b.getTime()) || b > now) return '生日设置有误';
  let months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
  const anchor = new Date(b.getFullYear(), b.getMonth() + months, b.getDate());
  if (anchor > now) { months--; }
  const days = Math.floor((now - new Date(b.getFullYear(), b.getMonth() + months, b.getDate())) / 86400000);
  if (months < 0) return '还没出生';
  if (months === 0) return `${days}天`;
  const y = Math.floor(months / 12), m = months % 12;
  return (y ? `${y}岁` : '') + (m ? `${m}个月` : '') + (days < 7 ? `${days}天` : '');
}
function summary(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'breast': return `${d.side || '双侧'} · ${fmtDuration(d.duration)}`;
    case 'formula': return `${d.amount || 0} ml${d.brand ? ' · ' + d.brand : ''}`;
    case 'poop': return [d.amount, d.color, d.texture].filter(Boolean).join(' · ');
    case 'pee': return `${d.amount || '中等'}`;
    case 'sleep': return `睡了 ${fmtDuration(d.duration)}`;
    case 'solid': return [d.meal, d.food, d.amount, d.accept].filter(Boolean).join(' · ');
    case 'health': return [d.temp ? `体温 ${d.temp}℃` : '', d.symptom, d.medicine].filter(Boolean).join(' · ');
    case 'growth': return [d.weight ? `体重 ${d.weight}kg` : '', d.height ? `身长 ${d.height}cm` : '', d.head ? `头围 ${d.head}cm` : ''].filter(Boolean).join(' · ');
    case 'note': return d.text || '';
    default: return '';
  }
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 1900);
}

/* ---------------- 本地存储（IndexedDB，失败回退 localStorage） ---------------- */
const Store = {
  db: null, fallback: false,
  async init() {
    if (this.db) return;
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('events')) {
            const s = db.createObjectStore('events', { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp');
          }
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      this.fallback = true;
      console.warn('IndexedDB 不可用，使用 localStorage 回退', e);
    }
  },
  tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  txDone(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, mode);
      fn(t.objectStore(store));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  /* localStorage 安全读写（空间满时不抛错） */
  lsEvents() { try { const a = JSON.parse(localStorage.getItem(LS_EVENTS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
  lsSetEvents(a) { try { localStorage.setItem(LS_EVENTS, JSON.stringify(a)); return true; } catch (e) { console.warn('本地存储空间不足，镜像未更新', e); return false; } },
  lsSettings() { try { const o = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } },
  lsSetSettings(o) { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(o)); } catch (e) {} },

  /* 读取两处数据并合并（按 updatedAt 取新），同时把合并结果写回两处实现自愈 */
  async all() {
    const ls = this.lsEvents();
    let idb = [];
    if (!this.fallback) { try { idb = await this.tx('events', 'readonly', (s) => s.getAll()); } catch (e) {} }
    const map = new Map();
    [...ls, ...idb].forEach((ev) => {
      if (!ev || !ev.id) return;
      const prev = map.get(ev.id);
      if (!prev || (ev.updatedAt || ev.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) map.set(ev.id, ev);
    });
    const all = [...map.values()];
    // 自愈：补全到两边
    this.lsSetEvents(all);
    if (!this.fallback) { try { await this.txDone('events', 'readwrite', (s) => all.forEach((ev) => s.put(ev))); } catch (e) {} }
    return all.filter((e) => !e._deleted);
  },
  async save(ev) {
    const rec = { ...ev, updatedAt: Date.now(), _deleted: false };
    if (!this.fallback) { try { await this.tx('events', 'readwrite', (s) => s.put(rec)); } catch (e) {} }
    const all = this.lsEvents();
    const i = all.findIndex((e) => e.id === rec.id);
    if (i >= 0) all[i] = rec; else all.push(rec);
    this.lsSetEvents(all);
  },
  async remove(id) {
    const tomb = { id, _deleted: true, updatedAt: Date.now() };
    if (!this.fallback) { try { await this.tx('events', 'readwrite', (s) => s.put(tomb)); } catch (e) {} }
    const all = this.lsEvents();
    const i = all.findIndex((e) => e.id === id);
    if (i >= 0) all[i] = tomb; else all.push(tomb);
    this.lsSetEvents(all);
  },
  async replaceAll(events) {
    const stamped = events.map((ev) => ({ ...ev, updatedAt: Date.now(), _deleted: false }));
    if (!this.fallback) { try { await this.txDone('events', 'readwrite', (s) => { s.clear(); stamped.forEach((ev) => s.put(ev)); }); } catch (e) {} }
    this.lsSetEvents(stamped);
  },
  async getSetting(key, def) {
    let v;
    if (!this.fallback) { try { const row = await this.tx('settings', 'readonly', (s) => s.get(key)); v = row && row.key !== undefined ? row.value : undefined; } catch (e) {} }
    if (v === undefined) v = this.lsSettings()[key];
    return v !== undefined && v !== null ? v : def;
  },
  async setSetting(key, value) {
    if (!this.fallback) { try { await this.tx('settings', 'readwrite', (s) => s.put({ key, value })); } catch (e) {} }
    const o = this.lsSettings();
    try { JSON.stringify(value); o[key] = value; } catch (e) { /* 句柄类不可序列化，跳过镜像 */ }
    this.lsSetSettings(o);
  }
};

/* ---------------- 状态 ---------------- */
let deferredPrompt = null; // 浏览器提供的「安装到桌面」事件（安卓/Chrome 可用）
const state = {
  tab: 'home',
  events: [],
  settings: { name: '宝宝', birth: '', quickAdd: false, theme: 'light', lastBackupAt: 0, backupDirName: '', defaultMl: 120, defaultBrand: '', autoBackup: false, showBreast: false },
  backupHandle: null,
  timelineFilter: 'all',
  statsRange: 7,
  confirmFn: null
};

async function loadData() {
  await Store.init();
  state.events = (await Store.all()).sort((a, b) => b.timestamp - a.timestamp);
  for (const k of Object.keys(state.settings)) {
    const v = await Store.getSetting(k, state.settings[k]);
    if (v !== undefined && v !== null) state.settings[k] = v;
  }
  if (!Store.fallback) {
    try { state.backupHandle = await Store.getSetting('backupHandle', null); } catch (e) { state.backupHandle = null; }
  }
  document.documentElement.dataset.theme = state.settings.theme === 'dark' ? 'dark' : 'light';
}

/* 备份：计算距上次备份天数 */
function backupAgeDays() {
  if (!state.settings.lastBackupAt) return null;
  return Math.floor((Date.now() - state.settings.lastBackupAt) / 86400000);
}

/* ---------------- 顶栏 / 导航 ---------------- */
const TABS = [
  { id: 'home', icon: '🏠', label: '记录' },
  { id: 'timeline', icon: '📋', label: '时间线' },
  { id: 'stats', icon: '📊', label: '统计' },
  { id: 'data', icon: '💾', label: '数据' },
  { id: 'settings', icon: '⚙️', label: '设置' }
];
const TITLES = {
  home: ['宝宝成长记录', '今天也要好好长大呀'],
  timeline: ['时间线', '每一条都是成长的痕迹'],
  stats: ['统计', '看看这段时间的规律'],
  data: ['数据管理', '数据只保存在这台设备上'],
  settings: ['设置', '按你的习惯来调整']
};

function renderChrome() {
  const [title, sub] = TITLES[state.tab];
  const online = navigator.onLine;
  $('#topbar').innerHTML = `
    <div>
      <h1>${esc(title)}</h1>
      <div class="sub">${esc(sub)}</div>
    </div>
    <div class="topbar-actions">
      <span class="offline-pill ${online ? '' : 'off'}" title="离线也可正常使用">
        <span class="dot"></span>${online ? '在线' : '离线'}
      </span>
      <button class="icon-btn" data-act="about" title="关于">ℹ️</button>
    </div>`;
  $('#tabbar').innerHTML = TABS.map((t) => `
    <button class="tab ${state.tab === t.id ? 'active' : ''}" data-act="tab" data-id="${t.id}">
      <span class="tab-ico">${t.icon}</span><span>${t.label}</span>
    </button>`).join('');
}

/* ---------------- 页面：记录 ---------------- */
function quickButton(type, sub = false) {
  const t = TYPES[type];
  return `<button class="quick-item" data-act="record" data-type="${type}">
    <span class="quick-ico" style="background:${t.color}22;color:${t.color}">${t.icon}</span>
    <span>${t.short}</span>
  </button>`;
}
function eventRow(ev, gapMs = null) {
  const t = TYPES[ev.type] || TYPES.note;
  const detail = summary(ev) || (ev.note ? esc(ev.note) : t.name);
  const gapHtml = (gapMs != null && gapMs >= 0)
    ? `<span class="event-gap">⏱ 距上条${TYPES[ev.type]?.short || ''} ${fmtGap(gapMs)}</span>` : '';
  return `<button class="event-row" data-act="edit" data-id="${ev.id}" style="width:100%;text-align:left">
    <span class="event-ico" style="background:${t.color}22;color:${t.color}">${t.icon}</span>
    <span class="event-main">
      <span class="event-title">${esc(t.name)}</span>
      <span class="event-detail">${esc(detail)}</span>
      ${gapHtml}
    </span>
    <span class="event-time">${fmtTime(ev.timestamp)}</span>
  </button>`;
}
function renderHome() {
  const today = state.events.filter((e) => isToday(e.timestamp));
  const count = (types) => today.filter((e) => types.includes(e.type)).length;
  const ml = today.filter((e) => e.type === 'formula').reduce((s, e) => s + (Number(e.data?.amount) || 0), 0);
  const min = today.filter((e) => e.type === 'breast').reduce((s, e) => s + (Number(e.data?.duration) || 0), 0);
  const recent = state.events.slice(0, 5);
  const todayFeeds = today.filter(isFeed);
  const lastFeed = state.events.find(isFeed) || null;
  const sinceLast = lastFeed ? Date.now() - lastFeed.timestamp : null;
  const avgGapToday = avgFeedGap(today);
  $('#page').innerHTML = `
    <div class="baby-card">
      <div class="baby-avatar">👶</div>
      <div>
        <div class="name">${esc(state.settings.name || '宝宝')}</div>
        <div class="meta">${ageString(state.settings.birth)} · 今天 ${fmtDate(Date.now())}</div>
      </div>
      <button class="edit" data-act="baby">编辑</button>
    </div>

    ${(() => {
      const age = backupAgeDays();
      if (state.events.length && (age === null || age >= 3)) {
        return `<button class="backup-banner" data-act="tab" data-id="data">
          <span>💾</span><span>${age === null ? '还没备份过，建议导出一份' : `距上次备份已 ${age} 天，建议备份`}</span><span>›</span>
        </button>`;
      }
      return '';
    })()}

    <div class="card">
      <div class="card-title">快捷记录 <span class="more">轻点即可记录</span></div>
      <button class="voice-entry" data-act="voice">
        <span class="voice-ico">🎤</span>
        <span class="voice-txt"><b>语音速记</b><small>说一句「喝了120ml」，自动识别成记录</small></span>
        <span class="voice-arrow">›</span>
      </button>
      <div class="quick-grid">${coreTypes().map((t) => quickButton(t)).join('')}</div>
      <div class="section-label">更多记录</div>
      <div class="quick-sub" style="grid-template-columns:repeat(${extraTypes().length},1fr)">${extraTypes().map((t) => quickButton(t, true)).join('')}</div>
    </div>

    <div class="card">
      <div class="card-title">今日概览 <span class="more">${fmtDate(Date.now())}</span></div>
      <div class="stat-strip">
        ${state.settings.showBreast
          ? `<div class="stat-cell"><div class="v" style="color:${TYPES.breast.color}">${count(['breast'])}</div><div class="l">母乳 ${min}分</div></div>`
          : `<div class="stat-cell"><div class="v" style="color:${TYPES.solid.color}">${count(['solid'])}</div><div class="l">辅食 次</div></div>`}
        <div class="stat-cell"><div class="v" style="color:${TYPES.formula.color}">${ml}</div><div class="l">奶粉 ml</div></div>
        <div class="stat-cell"><div class="v" style="color:${TYPES.pee.color}">${count(['pee'])}</div><div class="l">尿尿</div></div>
        <div class="stat-cell"><div class="v" style="color:${TYPES.poop.color}">${count(['poop'])}</div><div class="l">臭臭</div></div>
      </div>
    </div>

    <div class="card feed-gap-card">
      <div class="card-title">喝奶间隔 <span class="more">${state.settings.showBreast ? '母乳 + 奶粉' : '奶粉'}</span></div>
      <div class="gap-hero">
        <div class="gap-big">${lastFeed && sinceLast != null && sinceLast >= 0 ? fmtGap(sinceLast) : '—'}</div>
        <div class="gap-sub">${lastFeed ? `距上次喝奶 · ${fmtTime(lastFeed.timestamp)} 记录` : '还没有喝奶记录'}</div>
      </div>
      <div class="gap-foot">
        <div><span>今日平均间隔</span><b>${avgGapToday != null ? fmtGap(avgGapToday) : '—'}</b></div>
        <div><span>今日已喂</span><b>${todayFeeds.length} 次</b></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">最近记录 <button class="more" data-act="tab" data-id="timeline">查看全部 ›</button></div>
      ${recent.length ? `<div class="event-list">${recent.map((ev, i) => eventRow(ev, sameTypeGapBefore(state.events, i))).join('')}</div>`
        : `<div class="empty"><div class="e-ico">🍼</div><p>还没有记录，点上面的按钮开始吧</p></div>`}
    </div>`;
}

/* ---------------- 页面：时间线 ---------------- */
function renderTimeline() {
  // 母乳隐藏时，若当前筛选是母乳则回退到全部（须在过滤前修正）
  const visibleTypeKeys = Object.keys(TYPES).filter((k) => state.settings.showBreast || k !== 'breast');
  if (!visibleTypeKeys.includes(state.timelineFilter)) state.timelineFilter = 'all';
  const f = state.timelineFilter;
  let list = state.events;
  if (f !== 'all') list = list.filter((e) => e.type === f);
  let html = '';
  let lastDay = '';
  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    const k = dayKey(ev.timestamp);
    if (k !== lastDay) {
      const label = isToday(ev.timestamp) ? '今天' : isYesterday(ev.timestamp) ? '昨天' : fmtDate(ev.timestamp);
      html += `<div class="day-group">${label}</div>`;
      lastDay = k;
    }
    html += eventRow(ev, sameTypeGapBefore(list, i));
  }
  const chips = [{ id: 'all', name: '全部' }].concat(visibleTypeKeys.map((k) => ({ id: k, name: TYPES[k].short })));
  $('#page').innerHTML = `
    <div class="card" style="padding:12px">
      <div class="chip-group">${chips.map((c) => `<button class="chip ${f === c.id ? 'active' : ''}" data-act="filter" data-id="${c.id}">${c.name}</button>`).join('')}</div>
    </div>
    <div class="card">
      <div class="card-title">共 ${list.length} 条记录</div>
      ${html || `<div class="empty"><div class="e-ico">📋</div><p>这个分类下还没有记录</p></div>`}
    </div>`;
}

/* ---------------- 图表（纯 SVG） ---------------- */
function lastDays(n) {
  const arr = [];
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base); d.setDate(d.getDate() - i);
    arr.push({ key: dayKey(d.getTime()), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  return arr;
}
function barChartSVG(days, groups, events) {
  const W = 340, H = 180, L = 26, R = 6, T = 10, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const data = days.map((d) => {
    const dayEvents = events.filter((e) => e && dayKey(e.timestamp) === d.key);
    return groups.map((g) => dayEvents.filter((e) => g.types.includes(e.type)).length);
  });
  const totals = data.map((row) => row.reduce((a, b) => a + b, 0));
  const max = Math.max(4, ...totals);
  const step = iw / days.length;
  const bw = Math.min(18, step * 0.68);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日记录趋势">`;
  for (let i = 0; i <= 3; i++) {
    const y = T + ih - (ih * i / 3);
    out += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
    out += `<text x="${L - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text-3)">${Math.round(max * i / 3)}</text>`;
  }
  days.forEach((d, i) => {
    const x = L + step * i + (step - bw) / 2;
    let y = T + ih;
    data[i].forEach((v, gi) => {
      if (!v) return;
      const h = ih * v / max; y -= h;
      out += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${groups[gi].color}" rx="2"><title>${d.label} ${groups[gi].name} ${v}次</title></rect>`;
    });
    const showLabel = days.length <= 10 || i % Math.ceil(days.length / 8) === 0 || i === days.length - 1;
    if (showLabel) out += `<text x="${L + step * i + step / 2}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--text-3)">${d.label}</text>`;
  });
  out += '</svg>';
  return out;
}
function lineChartSVG(days, values, color, unit) {
  const W = 340, H = 140, L = 28, R = 8, T = 12, B = 24;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => {
    const x = L + (days.length === 1 ? iw / 2 : iw * i / (days.length - 1));
    const y = T + ih - ih * v / max;
    return [x, y, v];
  });
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日趋势">`;
  for (let i = 0; i <= 2; i++) {
    const y = T + ih - ih * i / 2;
    out += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)"/>`;
    out += `<text x="${L - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text-3)">${Math.round(max * i / 2)}</text>`;
  }
  if (pts.length > 1) {
    out += `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  pts.forEach((p, i) => {
    if (days.length > 20 && i % 2) return;
    out += `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${color}"><title>${days[i].label}：${p[2]} ${unit}</title></circle>`;
    const showLabel = days.length <= 10 || i % Math.ceil(days.length / 8) === 0 || i === days.length - 1;
    if (showLabel) out += `<text x="${p[0]}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--text-3)">${days[i].label}</text>`;
  });
  out += '</svg>';
  return out;
}
function donutSVG(items) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return `<div class="chart-empty">暂无数据</div>`;
  const R = 50, C = 2 * Math.PI * R;
  let off = 0;
  let out = `<svg viewBox="0 0 150 150" style="max-width:190px;margin:0 auto" role="img" aria-label="记录分布">`;
  out += `<circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="18"/>`;
  items.forEach((it) => {
    if (!it.value) return;
    const len = C * it.value / total;
    out += `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${it.color}" stroke-width="18"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)">
      <title>${it.label} ${it.value}次</title></circle>`;
    off += len;
  });
  out += `<text x="75" y="72" text-anchor="middle" font-size="22" font-weight="800" fill="var(--text)">${total}</text>`;
  out += `<text x="75" y="90" text-anchor="middle" font-size="10" fill="var(--text-2)">条记录</text></svg>`;
  return out;
}
function hbarSVG(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return items.map((i) => `
    <div style="display:flex;align-items:center;gap:8px;margin:7px 0">
      <div style="width:52px;font-size:11px;color:var(--text-2)">${i.label}</div>
      <div style="flex:1;height:12px;background:var(--surface-2);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${Math.round(i.value / max * 100)}%;background:${i.color};border-radius:6px"></div>
      </div>
      <div style="width:24px;text-align:right;font-size:11px;color:var(--text-2)">${i.value}</div>
    </div>`).join('');
}

function renderStats() {
  const range = state.statsRange;
  let filtered = state.events;
  if (range !== 'all') {
    const from = Date.now() - range * 86400000;
    filtered = state.events.filter((e) => e.timestamp >= from);
  }
  let days;
  if (range === 'all') {
    const earliest = state.events.length ? Math.min(...state.events.map((e) => e.timestamp)) : Date.now();
    const span = Math.max(1, Math.ceil((Date.now() - earliest) / 86400000) + 1);
    days = lastDays(Math.min(120, span));
  } else days = lastDays(range);

  const n = days.length;
  const num = (types, field) => filtered.filter((e) => types.includes(e.type)).reduce((s, e) => s + (field ? (Number(e.data?.[field]) || 0) : 1), 0);
  const breastMin = num(['breast'], 'duration');
  const formulaMl = num(['formula'], 'amount');
  const feedCount = filtered.filter((e) => ['breast', 'formula'].includes(e.type)).length;
  const gapAvg = avgFeedGap(filtered);
  const diaperCount = filtered.filter((e) => ['pee', 'poop'].includes(e.type)).length;
  const sleepMin = num(['sleep'], 'duration');
  const avg = (v) => n ? Math.round(v / n * 10) / 10 : 0;

  const ranges = [{ id: 7, name: '近7天' }, { id: 30, name: '近30天' }, { id: 90, name: '近90天' }, { id: 'all', name: '全部' }];
  const dist = Object.keys(TYPES).map((k) => ({ label: TYPES[k].short, value: filtered.filter((e) => e.type === k).length, color: TYPES[k].color })).filter((i) => i.value > 0);
  const buckets = [
    { label: '凌晨 0-6', value: 0 }, { label: '早上 6-12', value: 0 },
    { label: '下午 12-18', value: 0 }, { label: '晚上 18-24', value: 0 }
  ];
  filtered.filter((e) => ['breast', 'formula'].includes(e.type)).forEach((e) => {
    const h = new Date(e.timestamp).getHours();
    buckets[h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3].value++;
  });
  buckets.forEach((b, i) => { b.color = ['#8fa9e8', '#f5cd57', '#f6ab62', '#b9a0d8'][i]; });

  $('#page').innerHTML = `
    <div class="card" style="padding:12px">
      <div class="segment">${ranges.map((r) => `<button class="${range === r.id ? 'active' : ''}" data-act="range" data-id="${r.id}">${r.name}</button>`).join('')}</div>
    </div>

    <div class="metric-grid">
      <div class="metric"><div class="m-label">记录总数</div><div class="m-value">${filtered.length}<span class="m-unit">条</span></div></div>
      <div class="metric"><div class="m-label">日均喂养</div><div class="m-value">${avg(feedCount)}<span class="m-unit">次/天</span></div></div>
      <div class="metric"><div class="m-label">日均尿布</div><div class="m-value">${avg(diaperCount)}<span class="m-unit">次/天</span></div></div>
      <div class="metric"><div class="m-label">日均睡眠</div><div class="m-value">${avg(sleepMin / 60)}<span class="m-unit">小时/天</span></div></div>
      <div class="metric" style="grid-column:span 2">
        <div class="m-label">平均喝奶间隔 <span style="font-weight:400">· 相邻两次${state.settings.showBreast ? '母乳或奶粉' : '奶粉'}</span></div>
        <div class="m-value">${gapAvg != null ? fmtGap(gapAvg) : '—'}</div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">每日记录趋势</div>
      <div class="chart-wrap">${barChartSVG(days, GROUPS, filtered)}</div>
      <div class="legend">${GROUPS.map((g) => `<span><i style="background:${g.color}"></i>${g.name}</span>`).join('')}</div>
    </div>

    <div class="card">
      ${state.settings.showBreast ? `<div class="card-title">母乳时长 <span class="more">共 ${fmtDuration(breastMin)}</span></div>
      <div class="chart-wrap">${lineChartSVG(days, days.map((d) => filtered.filter((e) => e.type === 'breast' && dayKey(e.timestamp) === d.key).reduce((s, e) => s + (Number(e.data?.duration) || 0), 0)), TYPES.breast.color, '分钟')}</div>` : ''}
      <div class="card-title"${state.settings.showBreast ? ' style="margin-top:12px"' : ''}>奶粉奶量 <span class="more">共 ${formulaMl} ml</span></div>
      <div class="chart-wrap">${lineChartSVG(days, days.map((d) => filtered.filter((e) => e.type === 'formula' && dayKey(e.timestamp) === d.key).reduce((s, e) => s + (Number(e.data?.amount) || 0), 0)), TYPES.formula.color, 'ml')}</div>
    </div>

    <div class="card">
      <div class="card-title">记录分布</div>
      ${donutSVG(dist)}
      <div class="legend">${dist.map((i) => `<span><i style="background:${i.color}"></i>${i.label} ${i.value}</span>`).join('')}</div>
    </div>

    <div class="card">
      <div class="card-title">喂养时段分布 <span class="more">了解宝宝的吃奶规律</span></div>
      ${hbarSVG(buckets)}
    </div>`;
}

/* ---------------- 页面：数据 ---------------- */
/* 文件保存策略（按优先级）：
   1) 已授权的目录句柄 → 直接写入用户选定的文件夹（安卓 Chrome/Edge）
   2) showSaveFilePicker → 弹出系统另存为，用户自选位置与文件名（安卓 Chrome/Edge）
   3) Web Share → 系统分享面板，可存到「文件」App（iPhone Safari）
   4) 普通下载 → 浏览器默认下载目录（兜底）                       */
const supportsPicker = () => typeof window.showSaveFilePicker === 'function';
const supportsDirPicker = () => typeof window.showDirectoryPicker === 'function';

async function verifyDirPermission(handle) {
  if (!handle) return false;
  try {
    let p = await handle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') p = await handle.requestPermission({ mode: 'readwrite' });
    return p === 'granted';
  } catch (e) { return false; }
}

async function saveFile(name, content, mime) {
  // 1) 用户选定的文件夹：直接写入
  if (state.backupHandle && await verifyDirPermission(state.backupHandle)) {
    try {
      const fh = await state.backupHandle.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
      return { ok: true, where: `已保存到文件夹「${state.settings.backupDirName}」` };
    } catch (e) { console.warn('目录写入失败，改用其他方式', e); }
  }
  // 2) 系统另存为（可选位置与文件名）
  if (supportsPicker()) {
    try {
      const ext = mime.includes('json') ? 'json' : 'csv';
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: ext === 'json' ? 'JSON 备份文件' : 'CSV 表格文件', accept: { [mime]: ['.' + ext] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { ok: true, where: '已保存到你选择的位置' };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, canceled: true };
      console.warn('另存为失败', e);
    }
  }
  // 3) 系统分享（iPhone 存到「文件」App）
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return { ok: true, where: '已存到系统文件' };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, canceled: true };
    }
  }
  // 4) 兜底下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, where: '已下载（可在浏览器下载管理中指定保存位置）' };
}

async function chooseBackupDir() {
  if (!supportsDirPicker()) { toast('当前浏览器不支持选择文件夹，将使用系统另存为'); return; }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    let p = await handle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') p = await handle.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') { toast('未获得文件夹写入权限'); return; }
    state.backupHandle = handle;
    state.settings.backupDirName = handle.name;
    await Store.setSetting('backupHandle', handle);
    await Store.setSetting('backupDirName', handle.name);
    render(); toast(`已选择文件夹「${handle.name}」`);
  } catch (e) {
    if (e.name !== 'AbortError') { console.error(e); toast('选择文件夹失败'); }
  }
}

async function markBackedUp() {
  state.settings.lastBackupAt = Date.now();
  await Store.setSetting('lastBackupAt', state.settings.lastBackupAt);
}

/* 自动备份：每次增删改记录后，把最新数据静默写入已授权的备份文件夹。
   这是真正落盘的文件，浏览器清缓存无法删除它。带防抖避免频繁写。 */
let autoBackupTimer = null;
function scheduleAutoBackup() {
  if (!state.settings.autoBackup || !state.backupHandle || !supportsDirPicker()) return;
  clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(async () => {
    try {
      if (!await verifyDirPermission(state.backupHandle)) return;
      const payload = {
        app: '宝宝成长记录', version: 1, exportedAt: new Date().toISOString(),
        auto: true, settings: state.settings, events: state.events
      };
      const fh = await state.backupHandle.getFileHandle('宝宝记录-自动备份.json', { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(payload, null, 2));
      await w.close();
      state.settings.lastBackupAt = Date.now();
      await Store.setSetting('lastBackupAt', state.settings.lastBackupAt);
      console.log('自动备份已写入文件夹');
    } catch (e) { console.warn('自动备份失败', e); }
  }, 600);
}

async function exportJSON() {
  const payload = {
    app: '宝宝成长记录', version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, events: state.events
  };
  const name = `宝宝记录备份-${dayKey(Date.now())}.json`;
  const r = await saveFile(name, JSON.stringify(payload, null, 2), 'application/json');
  if (r.ok) { await markBackedUp(); render(); toast(r.where); }
}
function exportCSV() {
  const rows = [['时间', '类型', '内容', '备注', '原始数据']];
  state.events.slice().reverse().forEach((e) => {
    rows.push([fmtFull(e.timestamp), TYPES[e.type]?.name || e.type, summary(e), e.note || '', JSON.stringify(e.data || {})]);
  });
  const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  saveFile(`宝宝记录-${dayKey(Date.now())}.csv`, csv, 'text/csv;charset=utf-8').then((r) => { if (r.ok) toast(r.where); });
}
function renderData() {
  const bytes = new Blob([JSON.stringify(state.events)]).size;
  const first = state.events.length ? Math.min(...state.events.map((e) => e.timestamp)) : null;
  const age = backupAgeDays();
  const backupInfo = age === null ? '还没有备份过' : age === 0 ? '今天刚备份过' : age === 1 ? '昨天备份过' : `距上次备份 ${age} 天`;
  const needBackup = age === null || age >= 3;
  $('#page').innerHTML = `
    <div class="card" style="border-left:4px solid ${needBackup ? '#f6ab62' : 'var(--success)'}">
      <div class="card-title">备份状态 <span class="more" style="color:${needBackup ? '#f6ab62' : 'var(--success)'}">${backupInfo}</span></div>
      ${needBackup ? `<p class="about-text" style="color:#d98324">${state.events.length ? '已经一段时间没备份了，建议现在导出一份，防止数据丢失。' : '导出一份备份，养成好习惯。'}</p>` : `<p class="about-text">数据已备份，继续保持就好。</p>`}
      ${state.settings.backupDirName ? `<div class="setting-row"><span class="sr-ico">📁</span><span class="sr-body"><span class="sr-title">备份文件夹</span><span class="sr-desc">${esc(state.settings.backupDirName)}</span></span><button class="icon-btn" data-act="choose-dir" title="更换">✏️</button></div>` : ''}
    </div>

    <div class="card">
      <div class="card-title">导出备份 <span class="more">可自选保存位置</span></div>
      <p class="about-text">
        ${supportsDirPicker()
          ? '安卓 Chrome / Edge：可先指定一个备份文件夹，之后导出会自动存进去；也可每次弹窗自选位置。'
          : 'iPhone Safari：点导出后在系统分享面板选「存储到文件」，即可自选位置和文件名。'}
      </p>
      ${supportsDirPicker() ? `<button class="btn ghost" data-act="choose-dir" style="margin-top:12px">${state.backupHandle ? '更换备份文件夹' : '选择备份文件夹'}</button>` : ''}
      ${supportsDirPicker() && state.backupHandle ? `
      <div class="setting-row" style="margin-top:8px">
        <span class="sr-ico">🔄</span><span class="sr-body"><span class="sr-title">自动备份到文件夹</span><span class="sr-desc">每次增删改记录后自动写入「宝宝记录-自动备份.json」</span></span>
        <button class="switch ${state.settings.autoBackup ? 'on' : ''}" data-act="toggle-auto-backup" aria-label="自动备份开关"></button>
      </div>` : ''}
      <button class="btn" data-act="export-json" style="margin-top:10px">导出 JSON 完整备份</button>
      <button class="btn ghost" data-act="export-csv" style="margin-top:10px">导出 CSV 表格</button>
    </div>
    <div class="card">
      <div class="card-title">防丢失保护</div>
      <div class="setting-row"><span class="sr-ico">✅</span><span class="sr-body"><span class="sr-title">双份本地存储</span><span class="sr-desc">每条记录同时写入两个位置，一处被清另一处还在</span></span><span class="sr-val">已开启</span></div>
      <div class="setting-row"><span class="sr-ico">🔄</span><span class="sr-body"><span class="sr-title">启动自动修复</span><span class="sr-desc">下次打开时自动对比并补回丢失的记录</span></span><span class="sr-val">已开启</span></div>
      <div class="setting-row"><span class="sr-ico">📁</span><span class="sr-body"><span class="sr-title">自动写文件</span><span class="sr-desc">${state.settings.autoBackup && state.backupHandle ? '已开启 · 每次记录后写入文件夹' : supportsDirPicker() ? '未开启 · 选好文件夹后可开启' : '当前浏览器不支持，请用系统分享定期导出'}</span></span><span class="sr-val" style="color:${state.settings.autoBackup ? 'var(--success)' : 'var(--text-3)'}">${state.settings.autoBackup && state.backupHandle ? '开' : '关'}</span></div>
    </div>
    <div class="card">
      <div class="card-title">导入数据</div>
      <p class="about-text">选择之前导出的 JSON 备份文件，按记录 ID 合并，不会覆盖已有记录。</p>
      <button class="btn ghost" data-act="import" style="margin-top:12px">选择 JSON 文件导入</button>
      <input type="file" id="import-file" accept="application/json,.json" style="display:none">
    </div>
    <div class="card">
      <div class="card-title">存储情况</div>
      <div class="setting-row"><div class="sr-body"><div class="sr-title">记录数量</div><div class="sr-desc">日常数据保存在本机数据库中</div></div><div class="sr-val">${state.events.length} 条</div></div>
      <div class="setting-row"><div class="sr-body"><div class="sr-title">占用空间</div></div><div class="sr-val">${(bytes / 1024).toFixed(1)} KB</div></div>
      <div class="setting-row"><div class="sr-body"><div class="sr-title">最早记录</div></div><div class="sr-val">${first ? fmtDate(first) : '—'}</div></div>
      <button class="link-danger" data-act="clear">清空所有记录</button>
    </div>
    <div class="card">
      <div class="card-title">换手机怎么办？</div>
      <p class="about-text">在旧手机导出 JSON 备份，把文件传到新手机，再在新手机打开本应用并导入即可。添加到桌面后即可完全离线使用。</p>
    </div>`;
}

/* ---------------- 页面：设置 ---------------- */
function renderSettings() {
  const s = state.settings;
  $('#page').innerHTML = `
    <div class="card">
      <div class="card-title">宝宝信息</div>
      <button class="setting-row" data-act="baby" style="width:100%;text-align:left">
        <span class="sr-ico">👶</span><span class="sr-body"><span class="sr-title">名字与生日</span><span class="sr-desc">${esc(s.name || '宝宝')} · ${s.birth || '未设置生日'}</span></span><span class="sr-val">›</span>
      </button>
    </div>
    <div class="card">
      <div class="card-title">使用偏好</div>
      <div class="setting-row">
        <span class="sr-ico">⚡</span><span class="sr-body"><span class="sr-title">尿尿 / 臭臭一键记录</span><span class="sr-desc">轻点按钮直接记录中等量，无需填写表单</span></span>
        <button class="switch ${s.quickAdd ? 'on' : ''}" data-act="toggle-quick" aria-label="一键记录开关"></button>
      </div>
      <div class="setting-row">
        <span class="sr-ico">🤱</span><span class="sr-body"><span class="sr-title">显示母乳记录</span><span class="sr-desc">默认关闭，母乳入口不显示；开启后回到快捷区，已有记录一直保留</span></span>
        <button class="switch ${s.showBreast ? 'on' : ''}" data-act="toggle-breast" aria-label="母乳记录开关"></button>
      </div>
      <div class="setting-row">
        <span class="sr-ico">🌙</span><span class="sr-body"><span class="sr-title">深色模式</span><span class="sr-desc">夜间查看更护眼</span></span>
        <button class="switch ${s.theme === 'dark' ? 'on' : ''}" data-act="toggle-theme" aria-label="深色模式开关"></button>
      </div>
      <button class="setting-row" data-act="edit-default-ml" style="width:100%;text-align:left">
        <span class="sr-ico">🍼</span><span class="sr-body"><span class="sr-title">奶粉默认设置</span><span class="sr-desc">每次记奶粉时预填奶量和品牌，可随时改</span></span><span class="sr-val">${s.defaultMl || 120} ml${s.defaultBrand ? ' · ' + esc(s.defaultBrand) : ''} ›</span>
      </button>
    </div>
    <div class="card">
      <div class="card-title">安装到桌面</div>
      <p class="about-text" style="margin-bottom:10px">添加到桌面后，用起来和 App 一样，可离线打开（单文件版只需从文件打开，不依赖网络）。</p>
      ${deferredPrompt ? `<button class="btn" data-act="install" style="margin-bottom:12px">📲 一键添加到桌面</button>` : ''}
      ${openGuideButtonHTML()}
    </div>
    <div class="card">
      <div class="card-title">检查更新</div>
      <p class="about-text" style="margin-bottom:10px">如果界面还是旧的、或想加载最新版本，点这里强制更新。你的记录不会丢失。</p>
      <button class="btn ghost" data-act="force-update" style="width:100%">🔄 强制更新到最新版</button>
    </div>
    <div class="card">
      <div class="card-title">关于</div>
      <p class="about-text">宝宝成长记录 v1.1 · 完全离线 · 无账号 · 不上传任何数据。<br>记录的每一件小事，都是长大的证据。</p>
    </div>`;
}

/* ---------------- 强制更新（不删记录数据） ---------------- */
async function forceUpdateApp() {
  openConfirm(
    '检查更新',
    '这会清除旧版本缓存并重新加载最新版本。你的所有记录都会完整保留（记录存在独立数据库中，不会被清除）。如果已经是最新版，点一下也没有影响。',
    async () => {
      try {
        // 1) 清掉所有 Cache Storage 缓存（只清 SW 资源缓存，不碰 IndexedDB/localStorage）
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        // 2) 清掉自动刷新标记，允许新 SW 接管后刷新一次
        sessionStorage.removeItem('bl_autoreload');
        // 3) 注销所有旧 Service Worker，让下次加载装全新的
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        // 4) 去掉原有查询参数和 hash，用干净的 URL 带上新时间戳重载
        const base = location.href.split('?')[0].split('#')[0];
        location.replace(base + '?_fv=' + Date.now());
      } catch (err) {
        console.warn('强制更新失败', err);
        toast('更新失败，请稍后重试');
      }
    }
  );
}

/* ---------------- 安装引导 ---------------- */
function isWechat() { return /MicroMessenger/i.test(navigator.userAgent); }
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
// 识别国内常见安卓浏览器，给出对应菜单位置
function browserHint() {
  const ua = navigator.userAgent;
  if (/Quark/i.test(ua)) return { name: '夸克浏览器', menu: '点底部「三」菜单 → 工具箱/更多 → 找「添加到桌面」或「添加到主屏幕」' };
  if (/UCBrowser|UC Browser/i.test(ua)) return { name: 'UC 浏览器', menu: '点底部「≡」菜单 → 设置 → 通用 → 「添加到主屏幕」' };
  if (/MQQBrowser|QQBrowser/i.test(ua)) return { name: 'QQ 浏览器', menu: '点右上角「⋮」→ 找「添加到桌面」或「创建网站应用」' };
  if (/baidubrowser|BaiduHD|baiduboxapp/i.test(ua)) return { name: '百度浏览器', menu: '点右上角「⋮」→ 「添加到主屏幕」' };
  if (/MiuiBrowser/i.test(ua)) return { name: '小米浏览器', menu: '点底部菜单 → 找「添加到桌面」' };
  if (/Edg/i.test(ua)) return { name: 'Edge 浏览器', menu: '点右上角「⋮」→ 「添加到主屏幕」' };
  if (/Chrome/i.test(ua)) return { name: 'Chrome 浏览器', menu: '点右上角「⋮」→ 「安装应用」或「添加到主屏幕」' };
  return { name: '当前浏览器', menu: '在浏览器菜单里找「添加到桌面」「添加到主屏幕」或「创建网站应用」' };
}
function openGuideButtonHTML() {
  return `<button class="btn ghost" data-act="install-guide">${isWechat() ? '⚠️ 微信里打开？看这里' : '查看添加到桌面步骤'}</button>`;
}
// 国产安卓系统创建快捷方式的权限说明
const CN_PERMISSION_TIP = `<p class="about-text" style="margin-top:10px;color:#d98324">
  <b>⚠️ 华为 / 小米 / OPPO / vivo 用户注意：</b>如果点了没反应或提示失败，去手机「设置 → 应用管理 → 找到你的浏览器 → 权限」里，把<b>「创建桌面快捷方式」</b>设为允许，再回来试一次。这是国产系统的常见限制，不是应用的问题。
</p>`;
function openInstallGuide() {
  const wechat = isWechat();
  const ios = isIOS();
  const b = browserHint();
  let steps;
  if (wechat) {
    steps = `
      <p class="about-text" style="color:#d98324"><b>你现在是在微信里打开的，微信内置浏览器无法添加到桌面。</b></p>
      <p class="about-text">
        <b>第一步 · 用手机浏览器打开</b><br>
        点右上角「···」→ 选择「${ios ? '在 Safari 中打开' : '在浏览器中打开'}」。如果菜单里没有，先点「保存到文件 / 下载」，再用${ios ? '「文件」App 长按文件 → 共享 → Safari' : '夸克 / 百度 / UC / QQ 浏览器等'}打开这个文件。
      </p>
      <p class="about-text" style="margin-top:10px">
        <b>第二步 · 添加到桌面</b><br>
        ${ios
          ? '在 Safari 里点底部「分享」按钮 → 向下找到并点「添加到主屏幕」→ 确认。'
          : '在浏览器菜单里找「添加到桌面」「添加到主屏幕」或「创建网站应用」→ 确认。'}
      </p>
      ${ios ? '' : CN_PERMISSION_TIP}`;
  } else {
    steps = `
      <p class="about-text">
        <b>${ios ? 'iPhone · Safari' : `安卓 · ${b.name}`}</b><br>
        ${ios
          ? '点底部「分享」按钮 → 向下滑动找到「添加到主屏幕」→ 点右上角「添加」。之后从桌面图标打开，和 App 一样。'
          : `${b.menu} → 确认即可。`}
      </p>
      ${deferredPrompt ? `<button class="btn" data-act="install" style="margin-top:12px">📲 直接添加到桌面</button>` : ''}
      ${ios
        ? `<p class="about-text" style="margin-top:10px">当前浏览器：iPhone / iPad。若菜单里找不到「添加到主屏幕」，请用 Safari 打开本页。</p>`
        : `<p class="about-text" style="margin-top:10px">当前识别：<b>${b.name}</b>。不同浏览器菜单位置不同，找不到的就在菜单里翻翻「添加到桌面 / 添加到主屏幕 / 创建网站应用」。</p>${CN_PERMISSION_TIP}`}`;
  }
  openSheet(`<div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sh-ico" style="background:#8fa9e822;color:#8fa9e8">📲</span><h2>添加到桌面</h2><button class="close" data-act="close-overlay">✕</button></div>
    ${steps}
    <p class="about-text" style="margin-top:12px;color:var(--text-3)">提示：请把这个文件保存在固定位置，别逐条从聊天记录里重新打开，否则数据可能对不上。</p>
    <button class="btn ghost" data-act="close-overlay" style="margin-top:14px">知道了</button>`);
}
function openEditDefaultMl() {
  const cur = state.settings.defaultBrand || '';
  const presets = ['飞鹤1段', '飞鹤2段', '飞鹤3段', '美赞臣1段', '美素佳儿1段', 'a2 1段', '爱他美1段'];
  openSheet(`<div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sh-ico" style="background:#f6ab6222;color:#f6ab62">🍼</span><h2>奶粉默认设置</h2><button class="close" data-act="close-overlay">✕</button></div>
    <form id="ml-form">
      ${formField('默认奶量（ml）', `<input type="number" name="ml" inputmode="numeric" min="1" max="500" value="${state.settings.defaultMl || 120}">`)}
      ${formField('默认奶粉品牌 / 段数', `<input type="text" name="brand" id="default-brand-input" value="${esc(cur)}" placeholder="例如：飞鹤1段，留空则不预填">`)}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 14px">
        ${presets.map((p) => `<button type="button" class="chip ${cur === p ? 'active' : ''}" data-act="preset-brand" data-brand="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <button type="submit" class="btn" style="margin-top:6px">保存</button>
    </form>`);
  // 快捷品牌点选：填入输入框并高亮
  document.querySelectorAll('[data-act="preset-brand"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#default-brand-input').value = btn.dataset.brand;
      document.querySelectorAll('[data-act="preset-brand"]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
  $('#ml-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ml = clamp(Number(e.target.elements.ml.value) || 120, 1, 500);
    const brand = e.target.elements.brand.value.trim();
    state.settings.defaultMl = ml;
    state.settings.defaultBrand = brand;
    await Store.setSetting('defaultMl', ml);
    await Store.setSetting('defaultBrand', brand);
    closeSheet(); render(); toast(`默认设置已保存：${ml} ml${brand ? ' · ' + brand : ''}`);
  });
}

/* ---------------- 渲染入口 ---------------- */
function render() {
  renderChrome();
  ({ home: renderHome, timeline: renderTimeline, stats: renderStats, data: renderData, settings: renderSettings })[state.tab]();
}

/* ---------------- 弹层：记录表单 ---------------- */
function chipField(name, options, value) {
  return `<div class="chip-group" data-chip="${name}">${options.map((o) => `<button type="button" class="chip ${value === o ? 'active' : ''}" data-act="chip" data-name="${name}" data-value="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
}
function formField(label, inner) { return `<div class="field"><label>${label}</label>${inner}</div>`; }
function timeField(value) { return `<input type="datetime-local" name="time" value="${toLocalInput(value)}">`; }

function recordForm(type, ev) {
  const d = ev?.data || {};
  const t = ev?.timestamp || Date.now();
  let body = '';
  let note = ev?.note || '';
  switch (type) {
    case 'breast':
      body = formField('开始时间', timeField(t)) +
        formField('喂奶侧别', chipField('side', ['左侧', '右侧', '双侧'], d.side || '双侧')) +
        formField('时长（分钟）', `<div class="stepper"><button type="button" data-act="step" data-d="-5">−</button><input type="number" name="duration" inputmode="numeric" min="1" max="180" value="${d.duration || 15}"><button type="button" data-act="step" data-d="5">＋</button></div>`);
      break;
    case 'formula':
      body = formField('时间', timeField(t)) +
        formField('奶量（ml）', `<div class="stepper"><button type="button" data-act="ml-step" data-d="-10">−</button><input type="number" name="amount" inputmode="numeric" min="1" max="500" value="${d.amount || state.settings.defaultMl || 120}"><button type="button" data-act="ml-step" data-d="10">＋</button></div>`) +
        formField('奶粉品牌 / 段数（选填）', `<input type="text" name="brand" value="${esc(d.brand || state.settings.defaultBrand || '')}" placeholder="例如：飞鹤1段">`);
      break;
    case 'poop':
      body = formField('时间', timeField(t)) +
        formField('性状', chipField('texture', ['糊状', '稀水', '成型', '颗粒', '泡沫'], d.texture)) +
        formField('颜色', chipField('color', ['黄色', '金黄色', '绿色', '棕色', '黑色', '灰白'], d.color)) +
        formField('量', chipField('amount', ['少量', '中等', '较多'], d.amount || '中等'));
      break;
    case 'pee':
      body = formField('时间', timeField(t)) +
        formField('量', chipField('amount', ['少量', '中等', '较多'], d.amount || '中等'));
      break;
    case 'sleep':
      body = formField('入睡时间', timeField(t)) +
        formField('时长（分钟）', `<input type="number" name="duration" inputmode="numeric" min="1" max="1200" value="${d.duration || 120}">`) +
        formField('睡眠质量', chipField('quality', ['很好', '一般', '不安稳'], d.quality));
      break;
    case 'solid': {
      const commonFoods = ['米粉', '果泥', '蛋黄', '蔬菜泥', '肉泥', '粥', '面条', '米饭'];
      body = formField('时间', timeField(t)) +
        formField('餐次', chipField('meal', ['早餐', '午餐', '晚餐', '加餐'], d.meal)) +
        formField('食物', `<input type="text" name="food" value="${esc(d.food || '')}" placeholder="例如：米粉 / 苹果泥">`) +
        `<div class="food-presets">${commonFoods.map((f) => `<button type="button" class="chip" data-act="food-preset" data-food="${esc(f)}">${esc(f)}</button>`).join('')}</div>` +
        formField('吃了多少', `<input type="text" name="amount" value="${esc(d.amount || '')}" placeholder="例如：半碗">`) +
        formField('接受度', chipField('accept', ['吃得香', '一般', '不爱吃'], d.accept));
      break;
    }
    case 'health':
      body = formField('时间', timeField(t)) +
        formField('体温（℃）', `<input type="number" name="temp" inputmode="decimal" step="0.1" value="${d.temp || ''}" placeholder="例如：37.2">`) +
        formField('症状', `<input type="text" name="symptom" value="${esc(d.symptom || '')}" placeholder="例如：轻微咳嗽">`) +
        formField('用药', `<input type="text" name="medicine" value="${esc(d.medicine || '')}" placeholder="例如：退烧药 2ml">`);
      break;
    case 'growth':
      body = formField('测量日期', `<input type="date" name="date" value="${d.date || dayKey(t)}">`) +
        `<div class="field-row">` +
        formField('体重（kg）', `<input type="number" name="weight" inputmode="decimal" step="0.01" value="${d.weight || ''}">`) +
        formField('身长（cm）', `<input type="number" name="height" inputmode="decimal" step="0.1" value="${d.height || ''}">`) +
        `</div>` + formField('头围（cm）', `<input type="number" name="head" inputmode="decimal" step="0.1" value="${d.head || ''}">`);
      break;
    case 'note':
      body = formField('时间', timeField(t)) +
        formField('想记下的事', `<textarea name="text" placeholder="今天宝宝学会了翻身…">${esc(d.text || '')}</textarea>`);
      break;
  }
  body += formField('备注（选填）', `<textarea name="note" placeholder="其他想补充的…">${esc(note)}</textarea>`);
  return body;
}

function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="overlay" data-act="close-overlay"><div class="sheet" id="sheet">${html}</div></div>`;
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }
function sheetHead(type, title) {
  const t = TYPES[type];
  return `<div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sh-ico" style="background:${t.color}22;color:${t.color}">${t.icon}</span><h2>${title}</h2><button class="close" data-act="close-overlay">✕</button></div>`;
}
function openRecord(type, id) {
  const ev = id ? state.events.find((e) => e.id === id) : null;
  const t = TYPES[type];
  const html = sheetHead(type, (ev ? '编辑' : '记录') + t.name) +
    `<form id="record-form">${recordForm(type, ev)}` +
    `<div class="btn-row"><button type="button" class="btn ghost" data-act="close-overlay">取消</button><button type="submit" class="btn">保存记录</button></div>` +
    (ev ? `<button type="button" class="link-danger" data-act="delete" data-id="${ev.id}">删除这条记录</button>` : '') +
    `</form>`;
  openSheet(html);
  $('#record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const get = (n) => form.elements[n]?.value?.trim() || '';
    const num = (n) => Number(get(n)) || 0;
    const data = {};
    for (const el of form.querySelectorAll('[data-chip]')) {
      data[el.dataset.chip] = el.querySelector('.chip.active')?.dataset.value || '';
    }
    let timestamp = get('time') ? fromLocalInput(get('time')) : Date.now();
    if (type === 'growth') {
      const date = get('date') || dayKey(Date.now());
      data.date = date;
      timestamp = new Date(date + 'T12:00').getTime();
    }
    const fields = {
      breast: ['duration'], formula: ['amount', 'brand'], poop: [], pee: [],
      sleep: ['duration', 'quality'], solid: ['food', 'amount'],
      health: ['temp', 'symptom', 'medicine'], growth: ['weight', 'height', 'head'], note: ['text']
    }[type] || [];
    fields.forEach((f) => { data[f] = get(f); });
    const numberFields = {
      breast: ['duration'], formula: ['amount'], sleep: ['duration'],
      health: ['temp'], growth: ['weight', 'height', 'head']
    }[type] || [];
    numberFields.forEach((f) => { if (data[f] !== '') data[f] = num(f); });

    const record = ev ? { ...ev } : { id: uid(), createdAt: Date.now() };
    record.type = type; record.timestamp = timestamp; record.data = data;
    record.note = get('note'); record.updatedAt = Date.now();
    await Store.save(record);
    const idx = state.events.findIndex((x) => x.id === record.id);
    if (idx >= 0) state.events[idx] = record; else state.events.push(record);
    state.events.sort((a, b) => b.timestamp - a.timestamp);
    scheduleAutoBackup();
    closeSheet(); render(); toast(ev ? '已更新记录' : '已保存记录');
  });
}
/* ---------------- 语音速记（本地智能解析，不上传） ---------------- */
// 从中文口语里解析出记录意图：类型 / 数值 / 品牌 / 时间
function parseVoiceText(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const r = { type: 'note', data: {}, amount: null, duration: null, temp: null, brand: '', note: text, conf: 0 };

  // —— 类型识别（按优先级，先匹配更具体的）——
  const typeRules = [
    { type: 'formula', re: /(奶粉|冲奶|喂奶粉|奶粉|喝奶|吃奶|配方奶|飞鹤|美赞臣|美素|a2|爱他美|金领冠|君乐宝|伊利|雀巢)/i },
    { type: 'breast',  re: /(母乳|亲喂|喂奶|吸奶|左边|右边|左侧喂|右侧喂| Mastitis)/i },
    { type: 'poop',    re: /(大便|臭臭|拉屎|便便|拉了|拉臭|屎)/ },
    { type: 'pee',     re: /(尿尿|小便|嘘嘘|尿了|尿布|撒尿)/ },
    { type: 'sleep',   re: /(睡觉|睡着了|入睡|睡眠|午睡|睡了.*小时|夜觉)/ },
    { type: 'solid',   re: /(辅食|米粉|果泥|蛋黄|蔬菜泥|肉泥|面条|吃.*泥|添加辅食|吃辅食)/ },
    { type: 'health',  re: /(体温|发烧|发热|温度|吃药|退烧|咳嗽|感冒|用药)/ },
    { type: 'growth',  re: /(身高|体重|身长|头围|量了.*斤|公斤)/ }
  ];
  for (const rule of typeRules) {
    // 母乳隐藏时跳过母乳识别，避免生成入口不可见的记录
    if (rule.type === 'breast' && !state.settings.showBreast) continue;
    if (rule.re.test(text)) { r.type = rule.type; r.conf = 1; break; }
  }

  // —— 数值 + 单位 ——
  // 奶量：120ml / 120 毫升 / 喝了120
  const ml = text.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|ML|mL)/i) || text.match(/(?:喝|吃|喂|冲)\s*(\d{2,3})\b/);
  if (ml) {
    r.amount = Number(ml[1]);
    // 有奶量(ml)且无母乳专属词时，判为奶粉（覆盖「喝了120ml」「喂奶120ml」等说法）
    const breastWord = /(母乳|亲喂|左边|右边|左侧|右侧|吸奶)/.test(text);
    if (!breastWord && (r.type === 'note' || r.type === 'breast')) { r.type = 'formula'; r.conf = 1; }
  }
  // 时长：15分钟 / 半小时 / 2小时
  const min = text.match(/(\d+(?:\.\d+)?)\s*(分钟|分|min)/i);
  const hr = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*小时/);
  const half = /半小时/.test(text);
  if (min) r.duration = Math.round(Number(min[1]));
  else if (hr) r.duration = Math.round(Number(hr[1]) * 60);
  else if (half) r.duration = 30;
  // 体温：37.2度 / 37.5℃
  const tp = text.match(/(\d{2}(?:\.\d+)?)\s*(度|℃|°c|C)/i);
  if (tp) r.temp = Number(tp[1]);
  // 体重：6.5kg / 13斤
  const kg = text.match(/(\d+(?:\.\d+)?)\s*(kg|公斤|千克)/i);
  const jin = text.match(/(\d+(?:\.\d+)?)\s*斤/);
  if (kg) r.data.weight = Number(kg[1]);
  else if (jin) r.data.weight = Math.round(Number(jin[1]) * 0.5 * 100) / 100;

  // —— 品牌/段数：优先默认品牌，再从话里提取 ——
  const brandM = text.match(/(飞鹤|美赞臣|美素佳儿|美素|a2|爱他美|金领冠|君乐宝|伊利|雀巢|合生元|惠氏|雅培|荷兰牛栏|新西兰)|(\d)\s*段/i);
  if (r.type === 'formula') {
    let brand = state.settings.defaultBrand || '';
    // 若话里明确说了品牌或段数，用它覆盖
    if (brandM) {
      const bn = brandM[1] || '';
      const stage = brandM[2] ? brandM[2] + '段' : '';
      brand = (bn + stage).trim() || brand;
    }
    r.brand = brand;
  }

  // —— 时间词（相对当前时间）——
  let ts = Date.now();
  if (/昨天/.test(text)) ts -= 86400000;
  const clock = text.match(/(?:(\d{1,2})[点:：](\d{1,2})?)/);
  if (clock) {
    const d = new Date(ts);
    d.setHours(Math.min(23, Number(clock[1])), Number(clock[2] || 0), 0, 0);
    ts = d.getTime();
  }
  r.timestamp = ts;
  return r;
}

let voiceRecognition = null;
function openVoiceSheet() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  openSheet(`<div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sh-ico" style="background:#8fa9e822;color:#8fa9e8">🎤</span><h2>语音速记</h2><button class="close" data-act="close-overlay">✕</button></div>
    <p class="about-text" style="margin:0 0 12px">在下面输入或说出你要记的事，比如「喝了120ml飞鹤」「宝宝尿尿了」「体温37.5」。点识别后会自动填好表单，确认即可。</p>
    ${SR ? `<button type="button" class="btn ghost" data-act="voice-start" style="width:100%;margin-bottom:10px">🎙️ 点这里直接说话（应用内识别）</button>` : ''}
    <form id="voice-form">
      ${formField('说 / 输入内容', `<textarea name="text" id="voice-text" rows="3" placeholder="例如：喝了120ml飞鹤1段&#10;（点输入框调出键盘后，可用输入法的麦克风说话）"></textarea>`)}
      <button type="submit" class="btn" style="margin-top:6px;width:100%">✨ 识别并填写</button>
    </form>`);

  // 应用内语音（若浏览器支持）
  const startBtn = document.querySelector('[data-act="voice-start"]');
  if (startBtn && SR) {
    startBtn.addEventListener('click', () => {
      try {
        if (voiceRecognition) { voiceRecognition.stop(); return; }
        const rec = new SR();
        rec.lang = 'zh-CN'; rec.interimResults = false; rec.continuous = false;
        startBtn.textContent = '🔴 正在听…说完点此停止';
        rec.onresult = (ev) => {
          const txt = Array.from(ev.results).map((x) => x[0].transcript).join('');
          const box = $('#voice-text'); if (box) box.value = txt;
        };
        rec.onerror = (ev) => { toast('语音识别失败：' + (ev.error || '未知')); };
        rec.onend = () => { voiceRecognition = null; startBtn.textContent = '🎙️ 点这里直接说话（应用内识别）'; };
        voiceRecognition = rec; rec.start();
      } catch (err) { toast('此浏览器无法使用应用内语音，请用输入法麦克风'); }
    });
  }

  $('#voice-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = e.target.elements.text.value.trim();
    const parsed = parseVoiceText(text);
    if (!parsed) { toast('请先说点什么'); return; }
    openVoiceConfirm(parsed);
  });
}

// 把解析结果填进对应的记录表单，让用户确认/编辑后保存
function openVoiceConfirm(p) {
  const type = p.type;
  const t = TYPES[type];
  const d = p.data || {};
  if (type === 'formula') { d.amount = p.amount || state.settings.defaultMl || 120; d.brand = p.brand || ''; }
  if (type === 'breast') d.duration = p.duration || 15;
  if (type === 'sleep') d.duration = p.duration || 120;
  if (type === 'health') d.temp = p.temp || '';
  const html = sheetHead(type, '确认记录 · ' + t.name) +
    `<div class="voice-parsed">已从「${esc(p.note)}」识别：</div>` +
    `<form id="record-form">${recordForm(type, { timestamp: p.timestamp, data: d, note: '' })}` +
    `<div class="btn-row"><button type="button" class="btn ghost" data-act="voice-back">重新说</button><button type="submit" class="btn">确认保存</button></div></form>`;
  openSheet(html);
  $('#record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const get = (n) => form.elements[n]?.value?.trim() || '';
    const num = (n) => Number(get(n)) || 0;
    const data = {};
    for (const el of form.querySelectorAll('[data-chip]')) data[el.dataset.chip] = el.querySelector('.chip.active')?.dataset.value || '';
    let timestamp = get('time') ? fromLocalInput(get('time')) : Date.now();
    if (type === 'growth') { const date = get('date') || dayKey(Date.now()); data.date = date; timestamp = new Date(date + 'T12:00').getTime(); }
    const fields = { breast: ['duration'], formula: ['amount', 'brand'], poop: [], pee: [], sleep: ['duration', 'quality'], solid: ['food', 'amount'], health: ['temp', 'symptom', 'medicine'], growth: ['weight', 'height', 'head'], note: ['text'] }[type] || [];
    fields.forEach((f) => { data[f] = get(f); });
    const numberFields = { breast: ['duration'], formula: ['amount'], sleep: ['duration'], health: ['temp'], growth: ['weight', 'height', 'head'] }[type] || [];
    numberFields.forEach((f) => { if (data[f] !== '') data[f] = num(f); });
    const record = { id: uid(), type, timestamp, data, note: get('note'), createdAt: Date.now(), updatedAt: Date.now() };
    await Store.save(record);
    state.events.push(record); state.events.sort((a, b) => b.timestamp - a.timestamp);
    scheduleAutoBackup(); closeSheet(); render(); toast('语音记录已保存');
  });
}

function openBaby() {
  const s = state.settings;
  openSheet(`<div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sh-ico" style="background:#ff8fa322;color:#ff8fa3">👶</span><h2>宝宝信息</h2><button class="close" data-act="close-overlay">✕</button></div>
    <form id="baby-form">
      ${formField('宝宝名字', `<input type="text" name="name" value="${esc(s.name || '')}" placeholder="例如：小橘子">`)}
      ${formField('出生日期', `<input type="date" name="birth" value="${esc(s.birth || '')}">`)}
      <button type="submit" class="btn" style="margin-top:6px">保存</button>
    </form>`);
  $('#baby-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    state.settings.name = e.target.elements.name.value.trim() || '宝宝';
    state.settings.birth = e.target.elements.birth.value;
    await Store.setSetting('name', state.settings.name);
    await Store.setSetting('birth', state.settings.birth);
    closeSheet(); render(); toast('已保存宝宝信息');
  });
}
function openConfirm(title, msg, onOk) {
  state.confirmFn = onOk;
  $('#dialog-root').innerHTML = `<div class="overlay" data-act="close-dialog">
    <div class="sheet" style="max-width:400px;align-self:center;border-radius:20px;margin:20px" id="confirm-sheet">
      <div class="sheet-handle"></div>
      <h2 style="margin:6px 0 8px;font-size:17px">${esc(title)}</h2>
      <p class="about-text" style="margin:0 0 18px">${esc(msg)}</p>
      <div class="btn-row"><button class="btn ghost" data-act="close-dialog">取消</button><button class="btn danger" data-act="confirm-ok">确定</button></div>
    </div></div>`;
}
function openAbout() {
  openSheet(`<div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sh-ico" style="background:#ff8fa322;color:#ff8fa3">ℹ️</span><h2>关于这个应用</h2><button class="close" data-act="close-overlay">✕</button></div>
    <p class="about-text">
      <b>宝宝成长记录 v1.0</b><br><br>
      所有数据都保存在你的手机本地，不需要注册账号，也不会上传到任何服务器。<br><br>
      添加到桌面后即可完全离线使用。换手机或清理浏览器数据前，请记得在「数据」页导出 JSON 备份。<br><br>
      记录内容：母乳、奶粉、尿尿、臭臭、睡眠、辅食、健康、成长、记事。
    </p>
    <button class="btn ghost" data-act="close-overlay" style="margin-top:14px">知道了</button>`);
}

/* ---------------- 交互 ---------------- */
async function quickRecord(type) {
  if (state.settings.quickAdd && (type === 'pee' || type === 'poop')) {
    const ev = { id: uid(), type, timestamp: Date.now(), data: { amount: '中等' }, note: '', createdAt: Date.now() };
    await Store.save(ev);
    scheduleAutoBackup();
    state.events.unshift(ev); render(); toast(`已快速记录${TYPES[type].short}`);
  } else openRecord(type);
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  try {
    switch (act) {
      case 'tab': state.tab = el.dataset.id; window.scrollTo(0, 0); render(); break;
      case 'record': quickRecord(el.dataset.type); break;
      case 'edit': openRecord(state.events.find((x) => x.id === el.dataset.id)?.type || 'note', el.dataset.id); break;
      case 'filter': state.timelineFilter = el.dataset.id; render(); break;
      case 'range': state.statsRange = el.dataset.id === 'all' ? 'all' : Number(el.dataset.id); render(); break;
      case 'baby': openBaby(); break;
      case 'about': openAbout(); break;
      case 'close-overlay':
        // 只有点到遮罩本身或明确的关闭按钮才关闭；点表单内部不关闭
        if (el.classList.contains('overlay') && e.target !== el) break;
        closeSheet(); break;
      case 'close-dialog':
        if (el.classList.contains('overlay') && e.target !== el) break;
        $('#dialog-root').innerHTML = ''; state.confirmFn = null; break;
      case 'confirm-ok':
        { const fn = state.confirmFn; $('#dialog-root').innerHTML = ''; state.confirmFn = null; if (fn) await fn(); }
        break;
      case 'chip':
        el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        el.classList.add('active'); break;
      case 'food-preset':
        { const input = $('#record-form')?.elements?.food; if (input) { input.value = el.dataset.food; input.focus(); } }
        break;
      case 'step':
        { const input = el.parentElement.querySelector('input'); input.value = Math.max(1, (Number(input.value) || 0) + Number(el.dataset.d)); }
        break;
      case 'delete':
        { const id = el.dataset.id;
          openConfirm('删除记录', '删除后无法恢复，确定删除吗？', async () => {
            await Store.remove(id);
            state.events = state.events.filter((x) => x.id !== id);
            scheduleAutoBackup();
            closeSheet(); render(); toast('已删除');
          });
        }
        break;
      case 'toggle-quick':
        state.settings.quickAdd = !state.settings.quickAdd;
        await Store.setSetting('quickAdd', state.settings.quickAdd); render(); break;
      case 'toggle-breast':
        state.settings.showBreast = !state.settings.showBreast;
        await Store.setSetting('showBreast', state.settings.showBreast); render(); break;
      case 'toggle-theme':
        state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = state.settings.theme;
        await Store.setSetting('theme', state.settings.theme); render(); break;
      case 'export-json': await exportJSON(); break;
      case 'export-csv': exportCSV(); break;
      case 'choose-dir': await chooseBackupDir(); break;
      case 'toggle-auto-backup':
        state.settings.autoBackup = !state.settings.autoBackup;
        await Store.setSetting('autoBackup', state.settings.autoBackup);
        render();
        toast(state.settings.autoBackup ? '已开启自动备份，每次记录后自动存文件' : '已关闭自动备份');
        if (state.settings.autoBackup) scheduleAutoBackup();
        break;
      case 'install-guide': openInstallGuide(); break;
      case 'force-update': forceUpdateApp(); break;
      case 'voice': openVoiceSheet(); break;
      case 'voice-back': if (voiceRecognition) { voiceRecognition.stop(); } openVoiceSheet(); break;
      case 'edit-default-ml': openEditDefaultMl(); break;
      case 'ml-step':
        { const input = el.parentElement.querySelector('input'); input.value = Math.max(1, (Number(input.value) || 0) + Number(el.dataset.d)); }
        break;
      case 'install':
        if (deferredPrompt) {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null; closeSheet(); render();
        }
        break;
      case 'import': $('#import-file')?.click(); break;
      case 'clear':
        openConfirm('清空所有记录', '这会删除本机全部记录，建议先导出备份。确定继续吗？', async () => {
          await Store.replaceAll([]); state.events = []; scheduleAutoBackup(); render(); toast('已清空');
        });
        break;
    }
  } catch (err) {
    console.error(err); toast('操作失败，请重试');
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file') return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    const incoming = Array.isArray(obj) ? obj : obj.events;
    if (!Array.isArray(incoming)) throw new Error('格式不正确');
    const existing = new Set(state.events.map((x) => x.id));
    let added = 0;
    for (const ev of incoming) {
      if (!ev || !ev.id || !ev.type) continue;
      if (existing.has(ev.id)) continue;
      await Store.save(ev); existing.add(ev.id); added++;
    }
    if (obj.settings) {
      for (const k of ['name', 'birth', 'quickAdd', 'theme', 'defaultMl', 'defaultBrand', 'autoBackup', 'showBreast']) {
        if (obj.settings[k] !== undefined) { state.settings[k] = obj.settings[k]; await Store.setSetting(k, obj.settings[k]); }
      }
    }
    state.events = (await Store.all()).sort((a, b) => b.timestamp - a.timestamp);
    document.documentElement.dataset.theme = state.settings.theme === 'dark' ? 'dark' : 'light';
    scheduleAutoBackup();
    render(); toast(`导入成功，新增 ${added} 条`);
  } catch (err) {
    console.error(err); toast('导入失败：文件格式不正确');
  }
  e.target.value = '';
});

window.addEventListener('online', renderChrome);
window.addEventListener('offline', renderChrome);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); $('#dialog-root').innerHTML = ''; } });

/* ---------------- 启动 ---------------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (state.tab === 'settings') render();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('已添加到桌面'); });

(async function start() {
  await loadData();
  render();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        // 主动检查服务器是否有新版本
        reg.update().catch(() => {});
        // 发现新 SW 安装完成，让它跳过等待立即接管
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        // 新版本接管后自动刷新一次页面（用 sessionStorage 防止循环刷新）
        let reloaded = sessionStorage.getItem('bl_autoreload');
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = '1';
          sessionStorage.setItem('bl_autoreload', '1');
          window.location.reload();
        });
      } catch (err) { console.warn('SW 注册失败', err); }
    });
  }
})();
