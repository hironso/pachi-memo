// pachi-memo 画面
import * as db from './db.js';
import * as C from './calc.js';

const APP_VERSION = '1.3.0';
const RETAIN_KEY = 'pachi-memo.retain';
const TABS = ['today', 'history', 'breakdown', 'settings'];

const $app = document.getElementById('app');
const $tabbar = document.getElementById('tabbar');
const $toast = document.getElementById('toast');
const $importFile = document.getElementById('import-file');

const state = {
  records: [],
  view: 'today',
  tab: 'today',
  history: { mode: 'month', anchor: null },
  breakdown: { by: 'machine', period: 'month', open: null },
  form: null, // 打ち始めの入力中データ
  edit: null, // 台の記録の入力中データ
  past: null, // 過去の記録の追加の入力中データ
};

// ---------- 小物 ----------
const today = () => C.toDateStr(new Date());
const nowIso = () => new Date().toISOString();
const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const num = (n) => C.formatNumber(n);
const signed = (n) => C.formatYen(n, { sign: true, unit: '' });
const signedYen = (n) => C.formatYen(n, { sign: true });
const amountStr = (n) => (n == null ? '' : num(n));

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};

const findRecord = (id) => state.records.find((r) => r.id === id);

function replaceRecord(rec) {
  const i = state.records.findIndex((r) => r.id === rec.id);
  if (i >= 0) state.records[i] = rec;
  else state.records.push(rec);
}

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 2200);
}

// ---------- 同じ日のうちは保持（レート・機種・店舗） ----------
function loadRetain() {
  const t = today();
  try {
    const v = JSON.parse(localStorage.getItem(RETAIN_KEY) || 'null');
    if (v && v.date === t) return { rate: C.DEFAULT_RATE, machine: '', store: '', ...v };
  } catch {
    /* 使えない環境では保持しない */
  }
  return { date: t, rate: C.DEFAULT_RATE, machine: '', store: '' };
}

function saveRetain(values) {
  try {
    localStorage.setItem(RETAIN_KEY, JSON.stringify({ ...loadRetain(), ...values, date: today() }));
  } catch {
    /* 無視 */
  }
}

// ---------- 画面遷移 ----------
function go(view) {
  state.view = view;
  if (TABS.includes(view)) state.tab = view;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const views = {
    today: renderToday,
    start: renderStart,
    record: renderRecord,
    past: renderPast,
    history: renderHistory,
    breakdown: renderBreakdown,
    settings: renderSettings,
  };
  $app.innerHTML = views[state.view]();
  const sub = !TABS.includes(state.view);
  $tabbar.hidden = sub;
  $app.classList.toggle('no-tabbar', sub);
  for (const t of $tabbar.querySelectorAll('.tab')) {
    if (!sub && t.dataset.view === state.tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  for (const input of $app.querySelectorAll('[data-combo]')) toggleClear(input);
  updateProfitPreview();
}

// ---------- 共通部品 ----------
function statusBadge(r, t) {
  if (C.isOverdue(r, t)) return '<span class="badge overdue">未確定</span>';
  const st = C.statusOf(r);
  if (st === 'playing') return '<span class="badge playing">遊技中</span>';
  if (st === 'waiting') return '<span class="badge waiting">換金待ち</span>';
  return '';
}

function spinText(r) {
  return r.kind === 'pachinko' && r.spinCheck ? `回転率 ${C.formatSpinRate(r.spinCheck.value)}` : '';
}

/** 今日・履歴（日）に並べる台のカード */
function recordCard(r, nums, t) {
  const st = C.statusOf(r);
  const n = nums.get(r.id);
  const unit = n ? `<span class="unit">${n}台目</span>` : '';
  const p = C.profitOf(r);
  const right = st === 'done' ? `<span class="amount ${C.signClass(p)}">${signed(p)}</span>` : statusBadge(r, t);
  const meta = [C.rateLabel(r.rate), spinText(r)].filter(Boolean).join(' ・ ');
  let detail;
  if (st === 'done') detail = `<span class="detail">投資 ${num(r.investment)} ／ 回収 ${num(r.payout)}</span>`;
  else if (st === 'waiting') detail = `<span class="hint">投資 ${num(r.investment)} ・ 回収を入力 ›</span>`;
  else detail = `<span class="hint">タップして入力 ›</span>`;
  const active = st === 'playing' && r.date === t ? ' active' : '';
  return `<button type="button" class="card rec-card${active}" data-action="open-record" data-id="${esc(r.id)}">
    <span class="row"><span><span class="name">${esc(r.machine)}</span>${unit}</span>${right}</span>
    <span class="row"><span class="detail">${esc(meta)}</span>${detail}</span>
  </button>`;
}

function rateGrid(selected, action) {
  const rows = [
    ['パチンコ', C.RATES.filter((r) => r.kind === 'pachinko')],
    ['スロット', C.RATES.filter((r) => r.kind === 'slot')],
  ];
  return `<div class="rate-grid" role="group" aria-label="レート">${rows
    .map(
      ([label, rates]) =>
        `<span class="kind">${label}</span>` +
        rates
          .map(
            (r) =>
              `<button type="button" data-action="${action}" data-rate="${r.value}" aria-pressed="${r.value === selected}">${r.value}円</button>`,
          )
          .join(''),
    )
    .join('')}</div>`;
}

/** 入力候補つきの入力欄（機種・店舗） */
function combo(scope, field, label, placeholder, value) {
  const id = `in-${scope}-${field}`;
  return `<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-box">
      <input id="${id}" data-bind="${scope}.${field}" data-combo="${field}" data-scope="${scope}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">
      <button type="button" class="clear" data-action="clear-combo" data-target="${id}" aria-label="${label}を消す">${ICON.x}</button>
    </div>
    <ul class="suggest" id="sg-${scope}-${field}" hidden></ul>
  </div>`;
}

function numberInput({ id, bind, value, placeholder = '', money = false }) {
  return `<input id="${id}" class="num" data-bind="${bind}"${money ? ' data-money' : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done">`;
}

/** 回転率（千円あたり）の直接入力欄 */
function spinRateField(id, bind, value) {
  return `<div class="field"><label for="${id}">回転率（直接入力・任意）</label>
    <div class="input-box"><input id="${id}" class="num" data-bind="${bind}" value="${esc(value)}" placeholder="例：18.5" inputmode="decimal" autocomplete="off" enterkeyhint="done"><span class="suffix">回／千円</span></div></div>`;
}

function miniField(id, label, bind, value) {
  return `<div class="mini-field"><label for="${id}">${label}</label>
    <input id="${id}" data-bind="${bind}" value="${esc(value)}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done"></div>`;
}

function pageHead(title, meta, action) {
  return `<div class="page-head">
    <button type="button" class="icon-btn" data-action="${action}" aria-label="戻る">${ICON.back}</button>
    <div><h1>${title}</h1>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
  </div>`;
}

// ---------- 今日 ----------
function renderToday() {
  const t = today();
  const todays = state.records.filter((r) => r.date === t);
  const list = C.sortByStart(todays).reverse();
  const nums = C.unitNumbers(todays);
  const s = C.summarize(todays);
  const store = loadRetain().store;

  const hero =
    s.count > 0
      ? `<div class="big ${C.signClass(s.profit)}">${esc(signedYen(s.profit))}</div>
         <div class="note">投資 ${num(s.investment)} ／ 回収 ${num(s.payout)}（確定分）</div>`
      : `<div class="big zero">±0円</div><div class="note">確定した記録はまだありません</div>`;

  const cards = list.length
    ? `<div class="stack">${list.map((r) => recordCard(r, nums, t)).join('')}</div>`
    : `<p class="empty">打ちたい台が決まったら<br>「台を打ち始める」から記録します</p>`;

  return `<div class="row today-head">
      <span class="date">${C.formatMDLong(t)}</span>
      ${store ? `<span class="store-chip">${esc(store)}</span>` : ''}
    </div>
    <div class="hero"><div class="label">今日の収支</div>${hero}</div>
    ${cards}
    <div class="start-btn"><button type="button" class="btn-primary" data-action="start">${ICON.plus}台を打ち始める</button></div>`;
}

// ---------- 台を打ち始める ----------
function openStart() {
  const ret = loadRetain();
  state.form = { rate: ret.rate, machine: ret.machine, store: ret.store, startSpin: '', error: '' };
  go('start');
}

function renderStart() {
  const f = state.form;
  const pachinko = C.kindOfRate(f.rate) === 'pachinko';
  return `${pageHead('台を打ち始める', '', 'back-today')}
    ${combo('form', 'store', '店舗', '任意', f.store)}
    <div class="field"><span class="field-label">レート</span>${rateGrid(f.rate, 'form-rate')}</div>
    ${combo('form', 'machine', '機種', '機種名', f.machine)}
    ${
      pachinko
        ? `<div class="field"><label for="in-start-spin">開始回転数（任意）</label>
            <div class="input-box">${numberInput({ id: 'in-start-spin', bind: 'form.startSpin', value: f.startSpin, placeholder: '台の今の回転数' })}<span class="suffix">回</span></div></div>`
        : ''
    }
    <p class="error">${esc(f.error)}</p>
    <button type="button" class="btn-primary" data-action="start-submit">打ち始める</button>`;
}

async function submitStart() {
  const f = state.form;
  const machine = f.machine.trim();
  const pachinko = C.kindOfRate(f.rate) === 'pachinko';
  const startSpin = pachinko ? C.parseAmount(f.startSpin) : null;
  if (!machine) f.error = '機種名を入力してください';
  else if (Number.isNaN(startSpin)) f.error = '開始回転数は数字で入力してください';
  else f.error = '';
  if (f.error) return render();

  const rec = C.newRecord(
    { id: uuid(), date: today(), rate: f.rate, machine, store: f.store, startSpin },
    nowIso(),
  );
  await db.put(rec);
  replaceRecord(rec);
  saveRetain({ rate: f.rate, machine, store: f.store.trim() });
  state.form = null;
  toast(`${machine} の記録を始めました`);
  go('today');
}

// ---------- 台の記録（回転率・投資・回収） ----------
function openRecord(id) {
  const r = findRecord(id);
  if (!r) return;
  const c = r.spinCheck || {};
  state.edit = {
    id,
    returnView: state.view,
    inv: amountStr(r.investment),
    pay: amountStr(r.payout),
    date: r.date,
    rate: r.rate,
    machine: r.machine,
    store: r.store,
    startSpin: r.startSpin == null ? '' : String(r.startSpin),
    mode: c.mode || 'cash',
    cur: c.mode === 'cash' ? String(c.currentSpin) : '',
    spinInv: c.mode === 'cash' ? num(c.investment) : '',
    startBalls: c.mode === 'balls' ? String(c.startBalls) : '',
    curBalls: c.mode === 'balls' ? String(c.currentBalls) : '',
    ballSpins: c.mode === 'balls' ? String(c.spins) : '',
    showStartInCard: r.startSpin == null,
    manualRate: r.spinCheck ? C.formatSpinRate(r.spinCheck.value) : '',
    origManualRate: r.spinCheck ? C.formatSpinRate(r.spinCheck.value) : '',
    detailsOpen: false,
    spinError: '',
    error: '',
  };
  go('record');
}

function spinCard(r, e) {
  const c = r.spinCheck;
  const value = c
    ? `<div class="spin-value">${C.formatSpinRate(c.value)}<span class="u"> 回／千円</span></div>`
    : `<div class="spin-value none">まだ計算していません</div>`;
  const fields =
    e.mode === 'cash'
      ? e.showStartInCard
        ? `<div class="grid3">${miniField('sp-start', '開始回転数', 'edit.startSpin', e.startSpin)}${miniField('sp-cur', '現在の回転数', 'edit.cur', e.cur)}${miniField('sp-inv', 'ここまでの投資', 'edit.spinInv', e.spinInv)}</div>`
        : `<div class="grid2">${miniField('sp-cur', '現在の回転数', 'edit.cur', e.cur)}${miniField('sp-inv', 'ここまでの投資（円）', 'edit.spinInv', e.spinInv)}</div>`
      : `<div class="grid3">${miniField('sp-sb', '開始の持ち玉', 'edit.startBalls', e.startBalls)}${miniField('sp-cb', '現在の持ち玉', 'edit.curBalls', e.curBalls)}${miniField('sp-bs', '回転数', 'edit.ballSpins', e.ballSpins)}</div>
         <p class="small sub">大当たり後、回転数0から打ち始めたときの持ち玉数と、そこからの回転数を入れます</p>`;
  return `<section class="card spin-card" aria-label="回転率">
    <div class="row-base"><span class="small sub">回転率</span><span class="small sub">${esc(C.describeSpinCheck(c))}</span></div>
    ${value}
    <div class="seg mini" role="group" aria-label="計測方法">
      <button type="button" data-action="spin-mode" data-mode="cash" aria-pressed="${e.mode === 'cash'}">現金</button>
      <button type="button" data-action="spin-mode" data-mode="balls" aria-pressed="${e.mode === 'balls'}">持ち玉</button>
    </div>
    ${fields}
    <p class="error">${esc(e.spinError)}</p>
    <div class="calc-row">
      <button type="button" class="btn-sub" data-action="spin-clear">クリア</button>
      <button type="button" class="calc-btn" data-action="spin-calc">計算する</button>
    </div>
  </section>`;
}

function renderRecord() {
  const e = state.edit;
  const r = findRecord(e.id);
  if (!r) return '<p class="empty">記録が見つかりません</p>';
  const sameDay = state.records.filter((x) => x.date === r.date);
  const n = C.unitNumbers(sameDay).get(r.id);
  const pachinkoNow = C.kindOfRate(e.rate) === 'pachinko';
  const metaParts = [C.rateLabel(r.rate), r.store || '店舗なし'];
  if (r.kind === 'pachinko' && r.startSpin != null) metaParts.push(`開始 ${num(r.startSpin)}回`);
  const title = `${esc(r.machine)}${n ? `<span class="unit">${n}台目</span>` : ''}`;
  const dateNote = r.date !== today() ? `${C.formatMD(r.date)} ・ ` : '';

  return `${pageHead(title, esc(dateNote + metaParts.join(' ・ ')), 'record-back')}
    ${pachinkoNow && r.kind === 'pachinko' ? spinCard(r, e) : ''}
    <div class="field">
      <label for="in-inv">投資額（打ち終わったら）</label>
      <div class="input-box">${numberInput({ id: 'in-inv', bind: 'edit.inv', value: e.inv, placeholder: '未入力', money: true })}<span class="suffix">円</span></div>
      <div class="grid2">
        <button type="button" class="btn-sub" data-action="add-inv" data-amount="1000">+1,000</button>
        <button type="button" class="btn-sub" data-action="add-inv" data-amount="10000">+10,000</button>
      </div>
    </div>
    <div class="field">
      <label for="in-pay">回収額（換金したら）</label>
      <div class="input-box">${numberInput({ id: 'in-pay', bind: 'edit.pay', value: e.pay, placeholder: 'あとで入力できます', money: true })}<span class="suffix">円</span></div>
    </div>
    <div class="card profit-row row-base"><span class="sub">収支</span><span class="v" id="profit-v">—</span></div>
    <details class="card"${e.detailsOpen ? ' open' : ''}>
      <summary data-action="details-toggle">日付・機種・店舗・レートを修正</summary>
      <div class="stack">
        <div class="field"><label for="in-date">日付</label>
          <div class="input-box"><input id="in-date" type="date" data-bind="edit.date" value="${esc(e.date)}"></div></div>
        <div class="field"><span class="field-label">レート</span>${rateGrid(e.rate, 'edit-rate')}</div>
        ${combo('edit', 'machine', '機種', '機種名', e.machine)}
        ${combo('edit', 'store', '店舗', '任意', e.store)}
        ${
          pachinkoNow
            ? `<div class="field"><label for="in-edit-start">開始回転数</label>
                <div class="input-box">${numberInput({ id: 'in-edit-start', bind: 'edit.startSpin', value: e.startSpin, placeholder: '未入力' })}<span class="suffix">回</span></div></div>`
            : ''
        }
        ${pachinkoNow && r.date < today() ? spinRateField('in-edit-rate', 'edit.manualRate', e.manualRate) : ''}
      </div>
    </details>
    <p class="error">${esc(e.error)}</p>
    <div class="stack" style="gap:4px">
      <button type="button" class="btn-primary" data-action="record-save">保存</button>
      <button type="button" class="btn-text btn-danger" data-action="record-delete">この記録を削除</button>
    </div>`;
}

function updateProfitPreview() {
  const el = document.getElementById('profit-v');
  const draft = state.view === 'past' ? state.past : state.edit;
  if (!el || !draft) return;
  const inv = C.parseAmount(draft.inv);
  const pay = C.parseAmount(draft.pay);
  if (Number.isInteger(inv) && Number.isInteger(pay)) {
    const p = pay - inv;
    el.textContent = signedYen(p);
    el.className = `v ${C.signClass(p)}`;
  } else {
    el.textContent = pay == null ? '換金後に確定' : '—';
    el.className = 'v sub';
  }
}

async function calcSpin() {
  const e = state.edit;
  const r = findRecord(e.id);
  let result;
  let check;
  if (e.mode === 'cash') {
    const startSpin = C.parseAmount(e.startSpin);
    const currentSpin = C.parseAmount(e.cur);
    const investment = C.parseAmount(e.spinInv);
    result = C.calcCashSpinRate({ startSpin, currentSpin, investment });
    if (result.ok) check = { mode: 'cash', startSpin, currentSpin, investment };
  } else {
    const startBalls = C.parseAmount(e.startBalls);
    const currentBalls = C.parseAmount(e.curBalls);
    const spins = C.parseAmount(e.ballSpins);
    result = C.calcBallsSpinRate({ rate: r.rate, startBalls, currentBalls, spins });
    if (result.ok) check = { mode: 'balls', startBalls, currentBalls, spins };
  }
  if (!result.ok) {
    e.spinError = result.error;
    return render();
  }
  e.spinError = '';
  const updated = {
    ...r,
    startSpin: e.mode === 'cash' ? check.startSpin : r.startSpin,
    spinCheck: { ...check, value: result.value, at: nowIso() },
    updatedAt: nowIso(),
  };
  await db.put(updated);
  replaceRecord(updated);
  if (e.mode === 'cash') e.showStartInCard = false;
  if (e.mode === 'cash') e.spinInv = num(check.investment);
  render();
  toast(`回転率 ${C.formatSpinRate(result.value)} 回／千円`);
}

async function saveRecord() {
  const e = state.edit;
  const r = findRecord(e.id);
  const inv = C.parseAmount(e.inv);
  const pay = C.parseAmount(e.pay);
  const machine = e.machine.trim();
  const kind = C.kindOfRate(e.rate);
  const startSpin = kind === 'pachinko' ? C.parseAmount(e.startSpin) : null;
  if (Number.isNaN(inv)) e.error = '投資額は数字で入力してください';
  else if (Number.isNaN(pay)) e.error = '回収額は数字で入力してください';
  else if (pay != null && inv == null) e.error = '回収額を入れるときは投資額も入力してください';
  else if (!machine) e.error = '機種名を入力してください';
  else if (!C.isValidDate(e.date)) e.error = '日付を正しく入力してください';
  else if (Number.isNaN(startSpin)) e.error = '開始回転数は数字で入力してください';
  else e.error = '';
  const manualChanged = kind === 'pachinko' && e.manualRate.trim() !== e.origManualRate;
  const manual = manualChanged ? C.parseSpinRate(e.manualRate) : null;
  if (!e.error && Number.isNaN(manual)) e.error = '回転率は数字で入力してください（例：18.5）';
  if (e.error) {
    e.detailsOpen = e.detailsOpen || /機種|日付|開始|回転率/.test(e.error);
    return render();
  }
  let spinCheck = kind === 'pachinko' ? r.spinCheck : null;
  if (manualChanged) spinCheck = manual == null ? null : C.manualSpinCheck(manual, nowIso());
  const updated = {
    ...r,
    date: e.date,
    rate: e.rate,
    kind,
    machine,
    store: e.store.trim(),
    investment: inv,
    payout: pay,
    startSpin,
    spinCheck,
    updatedAt: nowIso(),
  };
  await db.put(updated);
  replaceRecord(updated);
  toast('保存しました');
  leaveRecord();
}

async function deleteRecord() {
  const r = findRecord(state.edit.id);
  if (!confirm(`${r.machine}（${C.formatMD(r.date)}）の記録を削除しますか？\n元に戻せません。`)) return;
  await db.remove(r.id);
  state.records = state.records.filter((x) => x.id !== r.id);
  toast('削除しました');
  leaveRecord();
}

function leaveRecord() {
  const back = state.edit ? state.edit.returnView : 'today';
  state.edit = null;
  go(TABS.includes(back) ? back : 'today');
}

// ---------- 過去の記録の追加 ----------
function openPast(date) {
  const latest = C.sortByStart(state.records).pop();
  state.past = {
    date,
    rate: C.DEFAULT_RATE,
    machine: '',
    store: latest ? latest.store : '',
    inv: '',
    pay: '',
    spinRate: '',
    error: '',
  };
  go('past');
}

function renderPast() {
  const f = state.past;
  const pachinko = C.kindOfRate(f.rate) === 'pachinko';
  return `${pageHead('記録を追加', esc(C.formatMDLong(f.date)), 'past-back')}
    ${combo('past', 'store', '店舗', '任意', f.store)}
    <div class="field"><span class="field-label">レート</span>${rateGrid(f.rate, 'past-rate')}</div>
    ${combo('past', 'machine', '機種', '機種名', f.machine)}
    <div class="field"><label for="in-inv">投資額</label>
      <div class="input-box">${numberInput({ id: 'in-inv', bind: 'past.inv', value: f.inv, placeholder: '未入力', money: true })}<span class="suffix">円</span></div></div>
    <div class="field"><label for="in-pay">回収額</label>
      <div class="input-box">${numberInput({ id: 'in-pay', bind: 'past.pay', value: f.pay, placeholder: '未入力', money: true })}<span class="suffix">円</span></div></div>
    <div class="card profit-row row-base"><span class="sub">収支</span><span class="v" id="profit-v">—</span></div>
    ${pachinko ? spinRateField('in-past-rate', 'past.spinRate', f.spinRate) : ''}
    <p class="error">${esc(f.error)}</p>
    <button type="button" class="btn-primary" data-action="past-save">保存</button>`;
}

async function savePast() {
  const f = state.past;
  const machine = f.machine.trim();
  const inv = C.parseAmount(f.inv);
  const pay = C.parseAmount(f.pay);
  const pachinko = C.kindOfRate(f.rate) === 'pachinko';
  const spinRate = pachinko ? C.parseSpinRate(f.spinRate) : null;
  if (!machine) f.error = '機種名を入力してください';
  else if (Number.isNaN(inv)) f.error = '投資額は数字で入力してください';
  else if (Number.isNaN(pay)) f.error = '回収額は数字で入力してください';
  else if (pay != null && inv == null) f.error = '回収額を入れるときは投資額も入力してください';
  else if (Number.isNaN(spinRate)) f.error = '回転率は数字で入力してください（例：18.5）';
  else f.error = '';
  if (f.error) return render();

  const rec = C.newRecord(
    { id: uuid(), date: f.date, rate: f.rate, machine, store: f.store, investment: inv, payout: pay, spinRate },
    nowIso(),
  );
  await db.put(rec);
  replaceRecord(rec);
  toast(`${C.formatMD(f.date)} に ${machine} を追加しました`);
  state.past = null;
  state.history.mode = 'day';
  state.history.anchor = rec.date;
  go('history');
}

// ---------- 履歴 ----------
function historyPeriod(mode, anchor) {
  const [y, m] = anchor.split('-');
  if (mode === 'day') return { from: anchor, to: anchor, title: C.formatMDLong(anchor) };
  if (mode === 'week') {
    const ws = C.weekStart(anchor);
    const we = C.addDays(ws, 6);
    return { from: ws, to: we, title: `${C.formatMD(ws)} 〜 ${C.formatMD(we)}` };
  }
  if (mode === 'month') return { from: `${y}-${m}-01`, to: `${y}-${m}-31`, title: `${y}年${Number(m)}月` };
  return { from: `${y}-01-01`, to: `${y}-12-31`, title: `${y}年` };
}

function moveAnchor(mode, anchor, dir) {
  if (mode === 'day') return C.addDays(anchor, dir);
  if (mode === 'week') return C.addDays(anchor, dir * 7);
  if (mode === 'month') return C.addMonths(anchor, dir);
  return C.addMonths(anchor, dir * 12);
}

function dayLines(group, nums, t) {
  const head = group.count
    ? `<span class="v ${C.signClass(group.profit)}">${signed(group.profit)}</span>`
    : `<span class="v sub">—</span>`;
  const lines = group.records
    .map((r) => {
      const n = nums.get(r.id);
      const left = [`${r.machine}${n ? `　${n}台目` : ''}`, r.kind === 'pachinko' && r.spinCheck ? `${C.formatSpinRate(r.spinCheck.value)}回` : '']
        .filter(Boolean)
        .join(' ・ ');
      const p = C.profitOf(r);
      let right;
      if (p != null) right = `<span class="r ${C.signClass(p)}">${signed(p)}</span>`;
      else if (C.isOverdue(r, t)) right = `<span class="r badge overdue">未確定</span>`;
      else right = `<span class="r">${C.statusOf(r) === 'playing' ? '遊技中' : '換金待ち'}</span>`;
      return `<button type="button" class="line" data-action="open-record" data-id="${esc(r.id)}"><span>${esc(left)}</span>${right}</button>`;
    })
    .join('');
  return `<div class="day-group">
    <button type="button" class="day-head" data-action="hist-day" data-date="${group.date}"><span class="d">${C.formatMD(group.date)}</span>${head}</button>
    ${lines}</div>`;
}

function renderHistory() {
  const h = state.history;
  if (!h.anchor) h.anchor = today();
  const t = today();
  const { from, to, title } = historyPeriod(h.mode, h.anchor);
  const list = C.inRange(state.records, from, to);
  const s = C.summarize(list);
  const modes = [
    ['day', '日'],
    ['week', '週'],
    ['month', '月'],
    ['year', '年'],
  ];

  let note;
  if (h.mode === 'day') note = `投資 ${num(s.investment)} ／ 回収 ${num(s.payout)}`;
  else note = `稼働${s.activeDays}日 ・ 勝ち${s.winDays} 負け${s.loseDays}`;
  const overdue = list.filter((r) => C.isOverdue(r, t)).length;
  if (overdue) note += ` ・ 未確定${overdue}件`;

  let body;
  if (!list.length) {
    body = '<p class="empty">記録はありません</p>';
  } else if (h.mode === 'day') {
    const nums = C.unitNumbers(state.records.filter((r) => r.date === h.anchor));
    body = `<div class="stack">${C.sortByStart(list).map((r) => recordCard(r, nums, t)).join('')}</div>`;
  } else if (h.mode === 'year') {
    const y = h.anchor.slice(0, 4);
    const rows = C.byMonth(list, Number(y))
      .filter((m) => m.activeDays > 0)
      .map(
        (m) => `<button type="button" class="month-row" data-action="hist-month" data-month="${y}-${String(m.month).padStart(2, '0')}-01">
          <span><span class="m">${m.month}月</span><span class="s">稼働${m.activeDays}日</span></span>
          ${m.count ? `<span class="v ${C.signClass(m.profit)}">${signed(m.profit)}</span>` : '<span class="v sub">—</span>'}
        </button>`,
      )
      .join('');
    body = `<div class="card list">${rows}</div>`;
  } else {
    const groups = C.groupByDate(list);
    body = `<div class="card list">${groups
      .map((g) => dayLines(g, C.unitNumbers(state.records.filter((r) => r.date === g.date)), t))
      .join('')}</div>`;
  }

  return `<div class="seg" role="group" aria-label="期間の単位">${modes
    .map(([k, l]) => `<button type="button" data-action="hist-mode" data-mode="${k}" aria-pressed="${h.mode === k}">${l}</button>`)
    .join('')}</div>
    <div class="period-nav">
      <button type="button" class="icon-btn" data-action="hist-nav" data-dir="-1" aria-label="前へ">${ICON.back}</button>
      <span class="title">${esc(title)}</span>
      <button type="button" class="icon-btn" data-action="hist-nav" data-dir="1" aria-label="次へ">${ICON.next}</button>
    </div>
    <div class="hero center">
      <div class="big ${C.signClass(s.profit)}">${esc(signedYen(s.profit))}</div>
      <div class="note">${esc(note)}</div>
    </div>
    ${body}
    ${
      h.mode === 'day' && h.anchor < t
        ? `<button type="button" class="btn-sub add-past" data-action="past-add" data-date="${h.anchor}">＋ この日の記録を追加</button>`
        : ''
    }`;
}

// ---------- 内訳 ----------
function renderBreakdown() {
  const b = state.breakdown;
  const t = today();
  let list = state.records;
  if (b.period === 'month') list = C.inRange(list, `${t.slice(0, 7)}-01`, `${t.slice(0, 7)}-31`);
  else if (b.period === 'year') list = C.inRange(list, `${t.slice(0, 4)}-01-01`, `${t.slice(0, 4)}-12-31`);
  const items = C.breakdown(list, b.by);
  const bys = [
    ['machine', '機種別'],
    ['store', '店舗別'],
    ['rate', 'レート別'],
  ];
  const periods = [
    ['month', '今月'],
    ['year', '今年'],
    ['all', '全期間'],
  ];

  const body = items.length
    ? `<div class="stack">${items
        .map((it, i) => {
          const key = `${b.by}|${b.period}|${it.key}`;
          const open = b.open === key;
          const sub =
            b.by === 'machine' ? `${it.rates.map(C.rateLabel).join('・')} ・ ${it.count}回` : `${it.count}回`;
          const lines = open
            ? `<div class="bd-body">
                <div class="totals">投資 ${num(it.investment)} ／ 回収 ${num(it.payout)}</div>
                ${it.records
                  .map((r) => {
                    const p = C.profitOf(r);
                    const left = [
                      C.formatMD(r.date),
                      b.by === 'machine' ? r.store : r.machine,
                      r.kind === 'pachinko' && r.spinCheck ? `${C.formatSpinRate(r.spinCheck.value)}回` : '',
                    ]
                      .filter(Boolean)
                      .join(' ・ ');
                    return `<button type="button" class="line" data-action="open-record" data-id="${esc(r.id)}"><span>${esc(left)}</span><span class="r ${C.signClass(p)}">${signed(p)}</span></button>`;
                  })
                  .join('')}
              </div>`
            : '';
          return `<div class="card bd-item">
            <button type="button" class="bd-head" data-action="bd-toggle" data-index="${i}" aria-expanded="${open}">
              <span class="row"><span class="name">${esc(it.label)}</span><span class="v ${C.signClass(it.profit)}">${signed(it.profit)}</span></span>
              <span class="row small sub"><span>${esc(sub)}</span><span>平均 ${signed(it.average)}</span></span>
            </button>${lines}</div>`;
        })
        .join('')}</div>`
    : '<p class="empty">確定した記録はまだありません</p>';

  return `<div class="seg" role="group" aria-label="集計の切り口">${bys
    .map(([k, l]) => `<button type="button" data-action="bd-by" data-by="${k}" aria-pressed="${b.by === k}">${l}</button>`)
    .join('')}</div>
    <div class="chips" role="group" aria-label="期間">${periods
      .map(([k, l]) => `<button type="button" class="chip" data-action="bd-period" data-period="${k}" aria-pressed="${b.period === k}">${l}</button>`)
      .join('')}</div>
    ${body}`;
}

// ---------- 設定 ----------
function renderSettings() {
  return `<div class="settings stack" style="gap:16px">
    <h1>設定</h1>
    <section class="card set-item">
      <span class="t">書き出し</span>
      <span class="d">すべての記録をファイルに保存します。共有メニューの「"ファイル"に保存」→「iCloud Drive」を選ぶと、機種変更のときに読み込んで戻せます。</span>
      <button type="button" class="btn-sub" data-action="export">書き出す</button>
    </section>
    <section class="card set-item">
      <span class="t">読み込み</span>
      <span class="d">書き出したファイルから記録を戻します。今あるデータは、ファイルの内容に置き換わります。</span>
      <button type="button" class="btn-sub" data-action="import">ファイルを選ぶ</button>
    </section>
    <section class="card set-item">
      <span class="t">全データ削除</span>
      <span class="d">すべての記録を削除します。元に戻せません。</span>
      <button type="button" class="btn-sub btn-danger" data-action="delete-all">すべて削除する</button>
    </section>
    <p class="small sub" style="text-align:center">記録 ${state.records.length}件 ・ pachi-memo ${APP_VERSION}</p>
  </div>`;
}

async function exportData() {
  const records = C.sortByStart(state.records);
  const json = JSON.stringify(C.makeBackup(records, nowIso()), null, 2);
  const name = `pachi-memo-${today().replace(/-/g, '')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function importData(file) {
  let records;
  try {
    records = C.parseBackup(await file.text());
  } catch (err) {
    alert(`読み込めませんでした。\n${err.message}`);
    return;
  }
  const msg = `${records.length}件の記録を読み込みます。\n今あるデータ（${state.records.length}件）は置き換わります。よろしいですか？`;
  if (!confirm(msg)) return;
  await db.replaceAll(records);
  state.records = records;
  toast(`${records.length}件を読み込みました`);
  render();
}

async function deleteAll() {
  if (!state.records.length) return toast('記録はありません');
  if (!confirm(`すべての記録（${state.records.length}件）を削除しますか？\n元に戻せません。`)) return;
  await db.clear();
  state.records = [];
  toast('すべて削除しました');
  render();
}

// ---------- 入力候補 ----------
function toggleClear(input) {
  const btn = input.parentElement.querySelector('.clear');
  if (btn) btn.hidden = !input.value;
}

function updateSuggest(input) {
  const ul = document.getElementById(`sg-${input.dataset.scope}-${input.dataset.combo}`);
  if (!ul) return;
  const items = document.activeElement === input ? C.suggest(state.records, input.dataset.combo, input.value) : [];
  if (!items.length) {
    ul.hidden = true;
    ul.innerHTML = '';
    return;
  }
  ul.innerHTML = items
    .map(
      (v) =>
        `<li><button type="button" data-action="pick" data-target="${input.id}" data-value="${esc(v)}">${esc(v)}</button></li>`,
    )
    .join('');
  ul.hidden = false;
}

function hideSuggest(input) {
  if (document.activeElement === input) return;
  const ul = document.getElementById(`sg-${input.dataset.scope}-${input.dataset.combo}`);
  if (ul) ul.hidden = true;
}

function setBound(input, value) {
  const [scope, key] = input.dataset.bind.split('.');
  if (state[scope]) state[scope][key] = value;
}

// ---------- イベント ----------
const actions = {
  tab: (el) => go(el.dataset.view),
  start: () => openStart(),
  'back-today': () => {
    state.form = null;
    go('today');
  },
  'form-rate': (el) => {
    state.form.rate = Number(el.dataset.rate);
    render();
  },
  'clear-combo': (el) => {
    const input = document.getElementById(el.dataset.target);
    input.value = '';
    setBound(input, '');
    toggleClear(input);
    input.focus();
    updateSuggest(input);
  },
  pick: (el) => {
    const input = document.getElementById(el.dataset.target);
    input.value = el.dataset.value;
    setBound(input, el.dataset.value);
    toggleClear(input);
    input.blur();
    hideSuggest(input);
  },
  'start-submit': () => submitStart(),
  'open-record': (el) => openRecord(el.dataset.id),
  'record-back': () => leaveRecord(),
  'spin-mode': (el) => {
    state.edit.mode = el.dataset.mode;
    state.edit.spinError = '';
    render();
  },
  'spin-calc': () => calcSpin(),
  'spin-clear': () => {
    // 計算用の入力欄を空にして、そのまま次の数字を入力できるようにする（開始値・保存済みの回転率は残す）
    const e = state.edit;
    const [fields, focusId] =
      e.mode === 'cash'
        ? [[['cur', 'sp-cur'], ['spinInv', 'sp-inv']], 'sp-cur']
        : [[['curBalls', 'sp-cb'], ['ballSpins', 'sp-bs']], 'sp-cb'];
    for (const [key, id] of fields) {
      e[key] = '';
      const input = document.getElementById(id);
      if (input) input.value = '';
    }
    e.spinError = '';
    const err = document.querySelector('.spin-card .error');
    if (err) err.textContent = '';
    const target = document.getElementById(focusId);
    if (target) target.focus();
  },
  'add-inv': (el) => {
    const cur = C.parseAmount(state.edit.inv);
    const next = (Number.isInteger(cur) ? cur : 0) + Number(el.dataset.amount);
    state.edit.inv = num(next);
    const input = document.getElementById('in-inv');
    if (input) input.value = state.edit.inv;
    updateProfitPreview();
  },
  'details-toggle': (el) => {
    // ネイティブの開閉のあとに状態を記録
    setTimeout(() => (state.edit.detailsOpen = el.parentElement.open), 0);
  },
  'edit-rate': (el) => {
    state.edit.rate = Number(el.dataset.rate);
    state.edit.detailsOpen = true;
    render();
  },
  'record-save': () => saveRecord(),
  'past-add': (el) => openPast(el.dataset.date),
  'past-back': () => {
    state.past = null;
    go('history');
  },
  'past-rate': (el) => {
    state.past.rate = Number(el.dataset.rate);
    render();
  },
  'past-save': () => savePast(),
  'record-delete': () => deleteRecord(),
  'hist-mode': (el) => {
    state.history.mode = el.dataset.mode;
    render();
  },
  'hist-nav': (el) => {
    const h = state.history;
    h.anchor = moveAnchor(h.mode, h.anchor, Number(el.dataset.dir));
    render();
  },
  'hist-day': (el) => {
    state.history.mode = 'day';
    state.history.anchor = el.dataset.date;
    render();
    window.scrollTo(0, 0);
  },
  'hist-month': (el) => {
    state.history.mode = 'month';
    state.history.anchor = el.dataset.month;
    render();
    window.scrollTo(0, 0);
  },
  'bd-by': (el) => {
    state.breakdown.by = el.dataset.by;
    state.breakdown.open = null;
    render();
  },
  'bd-period': (el) => {
    state.breakdown.period = el.dataset.period;
    state.breakdown.open = null;
    render();
  },
  'bd-toggle': (el) => {
    const b = state.breakdown;
    const t = today();
    let list = state.records;
    if (b.period === 'month') list = C.inRange(list, `${t.slice(0, 7)}-01`, `${t.slice(0, 7)}-31`);
    else if (b.period === 'year') list = C.inRange(list, `${t.slice(0, 4)}-01-01`, `${t.slice(0, 4)}-12-31`);
    const it = C.breakdown(list, b.by)[Number(el.dataset.index)];
    const key = `${b.by}|${b.period}|${it.key}`;
    b.open = b.open === key ? null : key;
    render();
  },
  export: () => exportData(),
  import: () => $importFile.click(),
  'delete-all': () => deleteAll(),
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  Promise.resolve(actions[el.dataset.action](el)).catch((err) => {
    console.error(err);
    alert(`エラーが発生しました。\n${err && err.message ? err.message : err}`);
  });
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.bind) setBound(t, t.value);
  if (t.dataset && t.dataset.combo) {
    toggleClear(t);
    updateSuggest(t);
  }
  if (t.id === 'in-inv' || t.id === 'in-pay') updateProfitPreview();
});

document.addEventListener('focusin', (ev) => {
  if (ev.target.dataset && ev.target.dataset.combo) updateSuggest(ev.target);
});

document.addEventListener('focusout', (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.combo) setTimeout(() => hideSuggest(t), 250);
  if (t.dataset && 'money' in t.dataset) {
    const v = C.parseAmount(t.value);
    if (Number.isInteger(v)) {
      t.value = num(v);
      setBound(t, t.value);
    }
  }
});

// 候補をタップしたときに入力欄のフォーカスが外れないようにする
document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('.suggest button')) ev.preventDefault();
});

// Enterでキーボードを閉じる
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.target.blur();
});

$importFile.addEventListener('change', () => {
  const file = $importFile.files && $importFile.files[0];
  $importFile.value = '';
  if (file) importData(file);
});

// 履歴：横スワイプで期間を移動（右→左で次、左→右で前）。縦スクロール中は反応しない
const SWIPE_MIN_PX = 50;
let swipeStart = null;

document.addEventListener(
  'touchstart',
  (ev) => {
    if (state.view !== 'history' || ev.touches.length !== 1) {
      swipeStart = null;
      return;
    }
    const t = ev.touches[0];
    swipeStart = { x: t.clientX, y: t.clientY };
  },
  { passive: true },
);

document.addEventListener(
  'touchend',
  (ev) => {
    if (!swipeStart || state.view !== 'history') return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - swipeStart.x;
    const dy = t.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const dir = dx < 0 ? 1 : -1;
    const h = state.history;
    h.anchor = moveAnchor(h.mode, h.anchor, dir);
    render();
    $app.classList.remove('slide-next', 'slide-prev');
    void $app.offsetWidth; // アニメーションを毎回やり直す
    $app.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
  },
  { passive: true },
);

document.addEventListener('touchcancel', () => (swipeStart = null), { passive: true });

$app.addEventListener('animationend', () => $app.classList.remove('slide-next', 'slide-prev'));

// 日付が変わってから開いたときに「今日」を更新
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.view === 'today') render();
});

// ---------- 起動 ----------
async function init() {
  try {
    state.records = await db.getAll();
  } catch (err) {
    console.error(err);
    $app.innerHTML = '<p class="empty">データを読み込めませんでした。<br>アプリを開き直してください。</p>';
    return;
  }
  state.history.anchor = today();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
