// pachi-memo 計算ロジック（画面・保存から独立。tests/calc.test.js でテスト）

// ---------- レート ----------
export const RATES = [
  { value: 4, kind: 'pachinko' },
  { value: 2, kind: 'pachinko' },
  { value: 1, kind: 'pachinko' },
  { value: 20, kind: 'slot' },
  { value: 10, kind: 'slot' },
  { value: 5, kind: 'slot' },
];
export const DEFAULT_RATE = 4;
export const KIND_LABEL = { pachinko: 'パチンコ', slot: 'スロット' };

export function kindOfRate(rate) {
  const r = RATES.find((x) => x.value === rate);
  return r ? r.kind : null;
}

export function rateLabel(rate) {
  const kind = kindOfRate(rate);
  return kind ? `${rate}円${KIND_LABEL[kind]}` : `${rate}円`;
}

// ---------- 日付（端末のローカル日付。文字列 YYYY-MM-DD で扱う） ----------
const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(str, n) {
  const d = parseDate(str);
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** 週の開始日（月曜始まり） */
export function weekStart(str) {
  const day = (parseDate(str).getDay() + 6) % 7; // 月=0 … 日=6
  return addDays(str, -day);
}

export function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return toDateStr(parseDate(str)) === str;
}

const WEEKDAYS = '日月火水木金土';
export function weekdayJa(str) {
  return WEEKDAYS[parseDate(str).getDay()];
}

/** 10/14（水） */
export function formatMD(str) {
  const d = parseDate(str);
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdayJa(str)}）`;
}

/** 10月14日（水） */
export function formatMDLong(str) {
  const d = parseDate(str);
  return `${d.getMonth() + 1}月${d.getDate()}日（${weekdayJa(str)}）`;
}

// ---------- 数値 ----------
const MINUS = '−';

export function formatNumber(n) {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** sign=true: +12,500 / −8,000 / ±0 */
export function formatYen(n, { sign = false, unit = '円' } = {}) {
  const body = formatNumber(n) + unit;
  if (sign) {
    if (n > 0) return '+' + body;
    if (n < 0) return MINUS + body;
    return '±' + body;
  }
  return (n < 0 ? MINUS : '') + body;
}

/** 入力文字列を整数に。空なら null、不正なら NaN */
export function parseAmount(input) {
  if (input == null) return null;
  const s = String(input).normalize('NFKC').replace(/[,\s円玉回]/g, '');
  if (s === '') return null;
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

export function signClass(n) {
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'zero';
}

// ---------- 記録の状態 ----------
export function isConfirmed(r) {
  return r.investment != null && r.payout != null;
}

/** playing: 投資未入力 / waiting: 回収未入力 / done: 確定 */
export function statusOf(r) {
  if (r.investment == null) return 'playing';
  if (r.payout == null) return 'waiting';
  return 'done';
}

/** 回収額が未入力のまま日付が過ぎた記録 */
export function isOverdue(r, today) {
  return !isConfirmed(r) && r.date < today;
}

export function profitOf(r) {
  return isConfirmed(r) ? r.payout - r.investment : null;
}

function startKey(r) {
  return `${r.startedAt || r.createdAt || ''}\u0000${r.id}`;
}

export function sortByStart(records) {
  return [...records].sort((a, b) => (startKey(a) < startKey(b) ? -1 : startKey(a) > startKey(b) ? 1 : 0));
}

/**
 * 台番（同じ日・同じ機種の何台目か）。2件以上ある場合のみ番号を付ける。
 * @returns Map<id, number>
 */
export function unitNumbers(records) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.date}\u0000${r.machine}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const result = new Map();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    sortByStart(list).forEach((r, i) => result.set(r.id, i + 1));
  }
  return result;
}

// ---------- 回転率（パチンコのみ） ----------
const round1 = (x) => Math.round(x * 10) / 10;
const isNonNegInt = (n) => Number.isInteger(n) && n >= 0;

export function ballsPer1000(rate) {
  return 1000 / rate;
}

/** 現金：(現在 − 開始) ÷ (投資 ÷ 1000) */
export function calcCashSpinRate({ startSpin, currentSpin, investment }) {
  if (!isNonNegInt(startSpin)) return { ok: false, error: '開始回転数を入力してください' };
  if (!isNonNegInt(currentSpin)) return { ok: false, error: '現在の回転数を入力してください' };
  if (!isNonNegInt(investment) || investment === 0) return { ok: false, error: 'ここまでの投資額を入力してください' };
  const spins = currentSpin - startSpin;
  if (spins <= 0) return { ok: false, error: '現在の回転数が開始回転数以下です' };
  return { ok: true, value: round1(spins / (investment / 1000)), spins };
}

/** 持ち玉：回転数 ÷ (使った玉数 ÷ 千円分の玉数) */
export function calcBallsSpinRate({ rate, startBalls, currentBalls, spins }) {
  if (kindOfRate(rate) !== 'pachinko') return { ok: false, error: 'パチンコのレートではありません' };
  if (!isNonNegInt(startBalls)) return { ok: false, error: '開始時の持ち玉数を入力してください' };
  if (!isNonNegInt(currentBalls)) return { ok: false, error: '現在の持ち玉数を入力してください' };
  if (!isNonNegInt(spins) || spins === 0) return { ok: false, error: '回転数を入力してください' };
  const used = startBalls - currentBalls;
  if (used <= 0) return { ok: false, error: '現在の持ち玉数が開始時以上です' };
  return { ok: true, value: round1(spins / (used / ballsPer1000(rate))), used };
}

export function formatSpinRate(v) {
  return v.toFixed(1);
}

/** 回転率の計算条件の説明（例：3,000円で55回転 / 1,350玉で100回転） */
export function describeSpinCheck(c) {
  if (!c) return '';
  if (c.mode === 'cash') return `${formatNumber(c.investment)}円で${formatNumber(c.currentSpin - c.startSpin)}回転`;
  return `持ち玉 ${formatNumber(c.startBalls - c.currentBalls)}玉で${formatNumber(c.spins)}回転`;
}

// ---------- 入力候補 ----------
/** 照合用の正規化：全角/半角・大文字/小文字・ひらがな/カタカナの違いをなくす */
export function normalizeForMatch(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '');
}

/**
 * 過去の入力値から候補を返す。前方一致 → 部分一致、同順位は最近使ったもの順。
 * 入力が空のときは最近使ったもの順。
 */
export function suggest(records, field, input, limit = 5) {
  const latest = new Map();
  for (const r of records) {
    const v = r[field];
    if (!v) continue;
    const key = r.startedAt || r.createdAt || '';
    if (!latest.has(v) || latest.get(v) < key) latest.set(v, key);
  }
  const q = normalizeForMatch(input);
  const items = [];
  for (const [value, used] of latest) {
    const n = normalizeForMatch(value);
    let rank;
    if (!q) rank = 0;
    else if (n === q) continue;
    else if (n.startsWith(q)) rank = 0;
    else if (n.includes(q)) rank = 1;
    else continue;
    items.push({ value, rank, used });
  }
  items.sort((a, b) => a.rank - b.rank || (a.used < b.used ? 1 : a.used > b.used ? -1 : 0));
  return items.slice(0, limit).map((x) => x.value);
}

// ---------- 集計（確定した記録のみ） ----------
export function inRange(records, from, to) {
  return records.filter((r) => r.date >= from && r.date <= to);
}

export function summarize(records) {
  const confirmed = records.filter(isConfirmed);
  let investment = 0;
  let payout = 0;
  const dayTotals = new Map();
  for (const r of confirmed) {
    investment += r.investment;
    payout += r.payout;
    dayTotals.set(r.date, (dayTotals.get(r.date) || 0) + profitOf(r));
  }
  let winDays = 0;
  let loseDays = 0;
  for (const v of dayTotals.values()) {
    if (v > 0) winDays++;
    else if (v < 0) loseDays++;
  }
  return {
    investment,
    payout,
    profit: payout - investment,
    count: confirmed.length,
    unconfirmed: records.length - confirmed.length,
    activeDays: new Set(records.map((r) => r.date)).size,
    winDays,
    loseDays,
  };
}

/** 日ごとのまとまり（新しい日付が先、日の中は打ち始め順） */
export function groupByDate(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date).push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({ date, records: sortByStart(list), ...summarize(list) }));
}

export function byMonth(records, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const prefix = `${year}-${pad(i + 1)}-`;
    const list = records.filter((r) => r.date.startsWith(prefix));
    return { month: i + 1, ...summarize(list) };
  });
}

const BREAKDOWN_KEY = {
  machine: (r) => r.machine,
  store: (r) => r.store || '',
  rate: (r) => r.rate,
};

export function breakdownLabel(by, key) {
  if (by === 'store') return key === '' ? '店舗なし' : key;
  if (by === 'rate') return rateLabel(key);
  return key;
}

/** 機種別・店舗別・レート別（確定した記録のみ、収支の大きい順） */
export function breakdown(records, by) {
  const keyOf = BREAKDOWN_KEY[by];
  const map = new Map();
  for (const r of records.filter(isConfirmed)) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const s = summarize(list);
      const rates = [...new Set(list.map((r) => r.rate))].sort((a, b) => b - a);
      return {
        key,
        label: breakdownLabel(by, key),
        rates,
        count: list.length,
        investment: s.investment,
        payout: s.payout,
        profit: s.profit,
        average: Math.round(s.profit / list.length),
        records: [...list].sort((a, b) => (startKey(a) < startKey(b) ? 1 : -1)),
      };
    })
    .sort((a, b) => b.profit - a.profit || String(a.label).localeCompare(String(b.label), 'ja'));
}

// ---------- 記録の作成 ----------
export function newRecord({ id, date, rate, machine, store, startSpin }, nowIso) {
  return {
    id,
    date,
    machine: machine.trim(),
    store: (store || '').trim(),
    rate,
    kind: kindOfRate(rate),
    investment: null,
    payout: null,
    startSpin: kindOfRate(rate) === 'pachinko' && Number.isInteger(startSpin) ? startSpin : null,
    spinCheck: null,
    startedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ---------- バックアップ ----------
export function makeBackup(records, nowIso) {
  return { app: 'pachi-memo', version: 1, exportedAt: nowIso, records };
}

const nullableInt = (v) => v === null || v === undefined || isNonNegInt(v);

function checkRecord(r, i) {
  const where = `${i + 1}件目`;
  if (!r || typeof r !== 'object') throw new Error(`${where}の形式が正しくありません`);
  if (typeof r.id !== 'string' || !r.id) throw new Error(`${where}のIDがありません`);
  if (!isValidDate(r.date)) throw new Error(`${where}の日付が正しくありません`);
  if (typeof r.machine !== 'string' || !r.machine.trim()) throw new Error(`${where}の機種名がありません`);
  if (!kindOfRate(r.rate)) throw new Error(`${where}のレートが正しくありません`);
  if (!nullableInt(r.investment) || !nullableInt(r.payout) || !nullableInt(r.startSpin)) {
    throw new Error(`${where}の数値が正しくありません`);
  }
  if (r.spinCheck != null && (typeof r.spinCheck !== 'object' || typeof r.spinCheck.value !== 'number')) {
    throw new Error(`${where}の回転率が正しくありません`);
  }
  return {
    id: r.id,
    date: r.date,
    machine: r.machine,
    store: typeof r.store === 'string' ? r.store : '',
    rate: r.rate,
    kind: kindOfRate(r.rate),
    investment: r.investment ?? null,
    payout: r.payout ?? null,
    startSpin: r.startSpin ?? null,
    spinCheck: r.spinCheck ?? null,
    startedAt: r.startedAt || r.createdAt || `${r.date}T00:00:00.000Z`,
    createdAt: r.createdAt || r.startedAt || `${r.date}T00:00:00.000Z`,
    updatedAt: r.updatedAt || r.createdAt || `${r.date}T00:00:00.000Z`,
  };
}

/** 書き出したJSONを読み込み、検証済みの記録の配列を返す（不正なら例外） */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('pachi-memoのバックアップファイルではありません');
  }
  const list = Array.isArray(data) ? data : data && data.records;
  if (!Array.isArray(list)) throw new Error('pachi-memoのバックアップファイルではありません');
  const records = list.map(checkRecord);
  if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('IDが重複しています');
  return records;
}
