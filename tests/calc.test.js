import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';

const rec = (o) => ({
  id: o.id,
  date: o.date ?? '2026-10-14',
  machine: o.machine ?? 'リゼロ2',
  store: o.store ?? '',
  rate: o.rate ?? 4,
  kind: C.kindOfRate(o.rate ?? 4),
  investment: o.investment ?? null,
  payout: o.payout ?? null,
  startSpin: o.startSpin ?? null,
  spinCheck: o.spinCheck ?? null,
  startedAt: o.startedAt ?? '2026-10-14T01:00:00.000Z',
  createdAt: o.startedAt ?? '2026-10-14T01:00:00.000Z',
  updatedAt: o.startedAt ?? '2026-10-14T01:00:00.000Z',
});

test('レートと種別', () => {
  assert.equal(C.kindOfRate(4), 'pachinko');
  assert.equal(C.kindOfRate(2), 'pachinko');
  assert.equal(C.kindOfRate(1), 'pachinko');
  assert.equal(C.kindOfRate(20), 'slot');
  assert.equal(C.kindOfRate(10), 'slot');
  assert.equal(C.kindOfRate(5), 'slot');
  assert.equal(C.kindOfRate(3), null);
  assert.equal(C.rateLabel(4), '4円パチンコ');
  assert.equal(C.rateLabel(20), '20円スロット');
  assert.equal(C.DEFAULT_RATE, 4);
});

test('日付：週は月曜始まり', () => {
  assert.equal(C.weekStart('2026-10-14'), '2026-10-12'); // 水 → 月
  assert.equal(C.weekStart('2026-10-12'), '2026-10-12'); // 月
  assert.equal(C.weekStart('2026-10-18'), '2026-10-12'); // 日
  assert.equal(C.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(C.addMonths('2026-12-15', 1), '2027-01-01');
  assert.equal(C.formatMD('2026-10-14'), '10/14（水）');
  assert.equal(C.isValidDate('2026-02-30'), false);
  assert.equal(C.isValidDate('2026-02-28'), true);
});

test('金額の表示と入力', () => {
  assert.equal(C.formatYen(12500, { sign: true }), '+12,500円');
  assert.equal(C.formatYen(-8000, { sign: true }), '−8,000円');
  assert.equal(C.formatYen(0, { sign: true }), '±0円');
  assert.equal(C.formatYen(1234567), '1,234,567円');
  assert.equal(C.parseAmount('15,000'), 15000);
  assert.equal(C.parseAmount('１５０００'), 15000);
  assert.equal(C.parseAmount('500円'), 500);
  assert.equal(C.parseAmount(''), null);
  assert.ok(Number.isNaN(C.parseAmount('1.5')));
  assert.ok(Number.isNaN(C.parseAmount('-100')));
});

test('記録の状態と収支', () => {
  const playing = rec({ id: 'a' });
  const waiting = rec({ id: 'b', investment: 5000 });
  const done = rec({ id: 'c', investment: 5000, payout: 12000 });
  assert.equal(C.statusOf(playing), 'playing');
  assert.equal(C.statusOf(waiting), 'waiting');
  assert.equal(C.statusOf(done), 'done');
  assert.equal(C.profitOf(done), 7000);
  assert.equal(C.profitOf(waiting), null);
  assert.equal(C.isOverdue(waiting, '2026-10-15'), true);
  assert.equal(C.isOverdue(waiting, '2026-10-14'), false);
  assert.equal(C.isOverdue(done, '2026-10-15'), false);
  // 回収0円も確定扱い
  assert.equal(C.profitOf(rec({ id: 'd', investment: 8500, payout: 0 })), -8500);
});

test('台番：同じ日・同じ機種が2件以上のときだけ打ち始め順に番号', () => {
  const list = [
    rec({ id: 'r2', machine: 'リゼロ2', startedAt: '2026-10-14T05:00:00.000Z' }),
    rec({ id: 'r1', machine: 'リゼロ2', startedAt: '2026-10-14T02:00:00.000Z' }),
    rec({ id: 'u1', machine: '海物語', startedAt: '2026-10-14T03:00:00.000Z' }),
    rec({ id: 'x1', machine: 'リゼロ2', date: '2026-10-13' }),
  ];
  const nums = C.unitNumbers(list);
  assert.equal(nums.get('r1'), 1);
  assert.equal(nums.get('r2'), 2);
  assert.equal(nums.has('u1'), false);
  assert.equal(nums.has('x1'), false);
  // 削除すると詰まる
  assert.equal(C.unitNumbers(list.filter((r) => r.id !== 'r1')).has('r2'), false);
});

test('回転率：現金', () => {
  const r = C.calcCashSpinRate({ startSpin: 120, currentSpin: 175, investment: 3000 });
  assert.deepEqual(r, { ok: true, value: 18.3, spins: 55 });
  assert.equal(C.calcCashSpinRate({ startSpin: 0, currentSpin: 90, investment: 5000 }).value, 18);
  assert.equal(C.calcCashSpinRate({ startSpin: 175, currentSpin: 120, investment: 3000 }).ok, false);
  assert.equal(C.calcCashSpinRate({ startSpin: 120, currentSpin: 175, investment: 0 }).ok, false);
  assert.equal(C.calcCashSpinRate({ startSpin: null, currentSpin: 175, investment: 3000 }).ok, false);
});

test('回転率：持ち玉（レートで千円分の玉数が変わる）', () => {
  assert.equal(C.calcBallsSpinRate({ rate: 4, startBalls: 2000, currentBalls: 650, spins: 100 }).value, 18.5);
  assert.equal(C.calcBallsSpinRate({ rate: 1, startBalls: 5000, currentBalls: 0, spins: 100 }).value, 20);
  assert.equal(C.calcBallsSpinRate({ rate: 2, startBalls: 1000, currentBalls: 500, spins: 20 }).value, 20);
  assert.equal(C.calcBallsSpinRate({ rate: 4, startBalls: 500, currentBalls: 600, spins: 100 }).ok, false);
  assert.equal(C.calcBallsSpinRate({ rate: 20, startBalls: 2000, currentBalls: 650, spins: 100 }).ok, false);
  assert.equal(C.describeSpinCheck({ mode: 'cash', startSpin: 120, currentSpin: 175, investment: 3000 }), '3,000円で55回転');
});

test('入力候補：ひらがな/カタカナ・全角/半角・大小を区別せず、前方一致を優先', () => {
  const list = [
    rec({ id: '1', machine: 'リゼロ2', startedAt: '2026-10-12T00:00:00.000Z' }),
    rec({ id: '2', machine: 'Pフィーバーリゼロ', startedAt: '2026-10-13T00:00:00.000Z' }),
    rec({ id: '3', machine: '海物語', startedAt: '2026-10-14T00:00:00.000Z' }),
    rec({ id: '4', machine: 'ｴｳﾞｧ15', startedAt: '2026-10-11T00:00:00.000Z' }),
  ];
  assert.deepEqual(C.suggest(list, 'machine', 'り'), ['リゼロ2', 'Pフィーバーリゼロ']);
  assert.deepEqual(C.suggest(list, 'machine', 'ﾘｾﾞ'), ['リゼロ2', 'Pフィーバーリゼロ']);
  assert.deepEqual(C.suggest(list, 'machine', 'えゔぁ'), ['ｴｳﾞｧ15']);
  assert.deepEqual(C.suggest(list, 'machine', 'p'), ['Pフィーバーリゼロ']);
  assert.deepEqual(C.suggest(list, 'machine', '海'), ['海物語']);
  assert.deepEqual(C.suggest(list, 'machine', 'う'), []); // 読みは扱わない
  assert.deepEqual(C.suggest(list, 'machine', 'リゼロ2'), []); // 入力済みと同じものは出さない
  assert.deepEqual(C.suggest(list, 'machine', ''), ['海物語', 'Pフィーバーリゼロ', 'リゼロ2', 'ｴｳﾞｧ15']);
  assert.deepEqual(C.suggest(list, 'store', ''), []);
});

test('集計：確定分のみ、勝ち負け日数は日の合計で判定', () => {
  const list = [
    rec({ id: '1', date: '2026-10-14', investment: 15000, payout: 32000 }),
    rec({ id: '2', date: '2026-10-14', investment: 8500, payout: 0 }),
    rec({ id: '3', date: '2026-10-14' }), // 遊技中
    rec({ id: '4', date: '2026-10-12', investment: 12000, payout: 0 }),
  ];
  const s = C.summarize(list);
  assert.equal(s.profit, -3500);
  assert.equal(s.investment, 35500);
  assert.equal(s.payout, 32000);
  assert.equal(s.count, 3);
  assert.equal(s.unconfirmed, 1);
  assert.equal(s.activeDays, 2);
  assert.equal(s.winDays, 1);
  assert.equal(s.loseDays, 1);
  const days = C.groupByDate(list);
  assert.deepEqual(days.map((d) => [d.date, d.profit]), [['2026-10-14', 8500], ['2026-10-12', -12000]]);
  const months = C.byMonth(list, 2026);
  assert.equal(months[9].profit, -3500);
  assert.equal(months[0].count, 0);
});

test('内訳：機種別・店舗別・レート別', () => {
  const list = [
    rec({ id: '1', machine: '海物語', store: 'A店', investment: 10000, payout: 31500 }),
    rec({ id: '2', machine: '海物語', store: '', investment: 8500, payout: 0 }),
    rec({ id: '3', machine: 'リゼロ2', rate: 20, store: 'A店', investment: 15000, payout: 32000 }),
    rec({ id: '4', machine: 'リゼロ2', rate: 20 }), // 未確定は含めない
  ];
  const m = C.breakdown(list, 'machine');
  assert.deepEqual(m.map((x) => [x.label, x.profit, x.count, x.average]), [
    ['リゼロ2', 17000, 1, 17000],
    ['海物語', 13000, 2, 6500],
  ]);
  const s = C.breakdown(list, 'store');
  assert.deepEqual(s.map((x) => x.label), ['A店', '店舗なし']);
  const r = C.breakdown(list, 'rate');
  assert.deepEqual(r.map((x) => x.label), ['20円スロット', '4円パチンコ']);
});

test('記録の作成：スロットは開始回転数を持たない', () => {
  const now = '2026-10-14T01:00:00.000Z';
  const p = C.newRecord({ id: 'a', date: '2026-10-14', rate: 4, machine: ' 海物語 ', store: 'A店', startSpin: 120 }, now);
  assert.equal(p.machine, '海物語');
  assert.equal(p.kind, 'pachinko');
  assert.equal(p.startSpin, 120);
  assert.equal(p.investment, null);
  const s = C.newRecord({ id: 'b', date: '2026-10-14', rate: 20, machine: 'リゼロ2', store: '', startSpin: 120 }, now);
  assert.equal(s.kind, 'slot');
  assert.equal(s.startSpin, null);
});

test('バックアップ：書き出し→読み込みで元に戻る、不正なファイルは拒否', () => {
  const list = [rec({ id: '1', investment: 1000, payout: 0 }), rec({ id: '2' })];
  const json = JSON.stringify(C.makeBackup(list, '2026-10-14T00:00:00.000Z'));
  assert.deepEqual(C.parseBackup(json), list);
  assert.throws(() => C.parseBackup('not json'));
  assert.throws(() => C.parseBackup('{"foo":1}'));
  assert.throws(() => C.parseBackup(JSON.stringify({ records: [{ ...list[0], rate: 3 }] })));
  assert.throws(() => C.parseBackup(JSON.stringify({ records: [list[0], list[0]] })));
});

test('回転率の直接入力', () => {
  assert.equal(C.parseSpinRate('18.5'), 18.5);
  assert.equal(C.parseSpinRate('１９'), 19);
  assert.equal(C.parseSpinRate(' 20 '), 20);
  assert.equal(C.parseSpinRate(''), null);
  assert.ok(Number.isNaN(C.parseSpinRate('18.55')));
  assert.ok(Number.isNaN(C.parseSpinRate('abc')));
  assert.equal(C.describeSpinCheck({ mode: 'manual', value: 18.5 }), '直接入力');
});

test('過去の記録：投資・回収・回転率を作成時に入れられる（空欄も可）', () => {
  const now = '2026-10-14T03:00:00.000Z';
  const p = C.newRecord(
    { id: 'p', date: '2026-10-01', rate: 4, machine: '海物語', store: 'A店', investment: 12000, payout: 30000, spinRate: 18.5 },
    now,
  );
  assert.equal(C.profitOf(p), 18000);
  assert.deepEqual(p.spinCheck, { mode: 'manual', value: 18.5, at: now });
  const blank = C.newRecord({ id: 'b', date: '2026-10-01', rate: 4, machine: '海物語', store: '' }, now);
  assert.equal(blank.investment, null);
  assert.equal(blank.payout, null);
  assert.equal(blank.spinCheck, null);
  // スロットには回転率を持たせない
  const s = C.newRecord({ id: 's', date: '2026-10-01', rate: 20, machine: 'リゼロ2', store: '', spinRate: 18.5 }, now);
  assert.equal(s.spinCheck, null);
  // バックアップで直接入力の回転率も戻る
  assert.deepEqual(C.parseBackup(JSON.stringify(C.makeBackup([p], now))), [p]);
});
