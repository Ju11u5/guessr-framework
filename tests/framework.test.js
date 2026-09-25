/**
 * 通用框架引擎测试：规则类型、导入解析、过滤、推荐，以及「模拟整局对局」。
 * 用法：node tests/framework.test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'guessr-framework.html'), 'utf8');
const s = html.indexOf('ENGINE_START'), e = html.indexOf('ENGINE_END');
const block = html.slice(html.indexOf('*/', s) + 2, html.lastIndexOf('/*', e));
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(block, sandbox);
const E = sandbox.module.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const eq = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++; else { fail++; console.log('  FAIL', m, '\n    实际:', x, '\n    期望:', y); }
};

/* ---------- 通用小工具 ---------- */
function mkFields(list) {
  return list.map((f) => Object.assign({ key: f.k, label: f.k, rule: f.r, tol: f.tol === undefined ? null : f.tol,
    link: f.link || '', primary: !!f.p, hidden: !!f.h }, f));
}
function dsOf(fields, rows) {
  return E.buildDataset({
    name: 't', fields: fields.map((f) => Object.assign({ tol: null, link: '', primary: false, hidden: false }, f)), rows
  });
}
function codeOf(ds, fi, guessRaw, candIdx) {
  const f = ds.fields[fi];
  return E.relCode(f, E.guessNorm(f, guessRaw), ds.rows[candIdx].n, ds.ctx);
}

console.log('— 1. 导入解析');
const csv = E.parseAny('名称,年龄,标签\n甲,25,a/b\n乙,30,c');
eq(csv.columns, ['名称', '年龄', '标签'], '逗号 CSV 表头');
eq(csv.rows.length, 2, '两行数据');
eq(csv.rows[0]['标签'], 'a/b', '取值正确');
const tsv = E.parseAny('名称\t年龄\n甲\t25');
eq(tsv.columns, ['名称', '年龄'], '自动识别制表符');
const quoted = E.parseAny('名称,备注\n"甲, 一号","说 ""你好"""');
eq(quoted.rows[0]['名称'], '甲, 一号', '引号内的逗号');
eq(quoted.rows[0]['备注'], '说 "你好"', '转义引号');
const js = E.parseAny('[{"名称":"甲","年龄":25},{"名称":"乙","年龄":30}]');
eq(js.columns, ['名称', '年龄'], 'JSON 对象数组');
ok(E.parseAny('').error, '空内容报错');
ok(E.parseAny('只有一行表头').error, '只有表头报错');

console.log('— 2. 字段类型推断');
const f1 = E.inferFields(['名称', '年龄', '标签', '队伍'], [
  { 名称: '甲', 年龄: '25', 标签: 'a/b', 队伍: 'MOUZ' },
  { 名称: '乙', 年龄: '30', 标签: 'c/d', 队伍: 'NAVI' }
], '');
eq(f1[0].rule, 'text', '文本列 → 文本宽松');
eq(f1[1].rule, 'number', '纯数字列 → 数值接近');
eq(f1[1].tol, 3, '数值列默认容差 3');
eq(f1[2].rule, 'setOverlap', '多值列 → 集合有交集');
ok(f1[0].primary === true || f1.some((f) => f.primary), '至少有一个主键');
const f2 = E.inferFields(['name', 'team', 'teamHistory', 'country', 'age', 'role', 'majorApps', 'status'], [
  { name: 'x', team: 'MOUZ', teamHistory: 'FaZe/NAVI', country: '瑞典', age: '25', role: 'awper', majorApps: '6', status: 'active' }
], 'cs');
eq(f2[0].rule, 'exact', 'CS 预设：昵称=完全相同');
eq(f2[0].primary, true, 'CS 预设：昵称是主键');
eq(f2[1].rule, 'listHit', 'CS 预设：队伍=命中列表');
eq(f2[1].link, 'teamHistory', 'CS 预设：队伍关联历史队伍列');
eq(f2[3].rule, 'group', 'CS 预设：国家=同组接近');
eq(f2[4].tol, 3, 'CS 预设：年龄容差 3');
eq(f2[6].tol, 1, 'CS 预设：Major 容差 1');

console.log('— 3. 六种比较规则');
const ds1 = dsOf(mkFields([
  { k: 'name', r: 'exact', p: true },
  { k: 'sym', r: 'text' },
  { k: 'num', r: 'number', tol: 3 },
  { k: 'ctry', r: 'group', link: 'reg' },
  { k: 'reg', r: 'exact', h: true },
  { k: 'team', r: 'listHit', link: 'hist' },
  { k: 'hist', r: 'exact', h: true },
  { k: 'tags', r: 'setOverlap' }
]), [
  { name: 'A', sym: 'Ab', num: 10, ctry: '法国', reg: '欧洲', team: 'MOUZ', hist: 'FaZe/NAVI', tags: 'x/y' },
  { name: 'B', sym: 'Ab', num: 12, ctry: '瑞典', reg: '欧洲', team: 'NAVI', hist: 'G2', tags: 'x/z' },
  { name: 'C', sym: 'Cc', num: 20, ctry: '巴西', reg: '南美', team: 'MOUZ', hist: 'FaZe', tags: 'q' }
]);
eq(E.colorOf(codeOf(ds1, 0, 'A', 0)), 'green', 'exact：相同=绿');
eq(E.colorOf(codeOf(ds1, 0, 'a', 1)), 'gray', 'exact：只是大小写不同也算灰（exact 严格）');
eq(E.colorOf(codeOf(ds1, 1, 'ab', 0)), 'green', 'text：忽略大小写');
eq(E.colorOf(codeOf(ds1, 2, 10, 0)), 'green', 'number：相同=绿');
eq(E.colorOf(codeOf(ds1, 2, 10, 1)), 'yellow', 'number：差 2 ≤ 容差 → 黄');
eq(E.dirOf(codeOf(ds1, 2, 10, 1)), 'up', 'number：目标更大 → ↑');
eq(E.colorOf(codeOf(ds1, 2, 10, 2)), 'gray', 'number：差 10 → 灰');
eq(E.dirOf(codeOf(ds1, 2, 20, 0)), 'down', 'number：目标更小 → ↓');
eq(E.colorOf(codeOf(ds1, 3, '法国', 1)), 'yellow', 'group：同组（欧洲）→ 黄');
eq(E.colorOf(codeOf(ds1, 3, '法国', 2)), 'gray', 'group：不同组 → 灰');
eq(E.colorOf(codeOf(ds1, 5, 'FaZe', 0)), 'yellow', 'listHit：命中历史列 → 黄');
eq(E.colorOf(codeOf(ds1, 5, 'FaZe', 1)), 'gray', 'listHit：历史列没有 → 灰');
eq(E.colorOf(codeOf(ds1, 5, 'MOUZ', 0)), 'green', 'listHit：当前值相同 → 绿');
eq(E.colorOf(codeOf(ds1, 7, 'x/y', 0)), 'green', 'setOverlap：集合相同 → 绿');
eq(E.colorOf(codeOf(ds1, 7, 'x/m', 1)), 'yellow', 'setOverlap：有交集 → 黄');
eq(E.colorOf(codeOf(ds1, 7, 'x/m', 2)), 'gray', 'setOverlap：无交集 → 灰');
eq(codeOf(ds1, 2, '', 0), 0, '空值 → 无法判定');

console.log('— 4. 线索过滤');
const rec1 = { kind: 'guess', raw: { name: 'A', num: 10 }, fb: { num: { color: 'yellow', dir: 'up' } } };
eq(E.filterCandidates(ds1, [rec1]).kept, [1], '猜 10 黄↑ → 只剩 12 的 B');
const rec2 = { kind: 'ask', field: 'ctry', value: '法国', result: 'close' };
eq(E.filterCandidates(ds1, [rec2]).kept, [1], '问「国家=法国」是也不是 → 只剩同组的 B');
const rec3 = { kind: 'ask', field: 'tags', value: 'q', result: 'no' };
eq(E.filterCandidates(ds1, [rec3]).kept, [0, 1], '问集合无交集 → 排除 C');
ok(!E.matchGuess(ds1, { kind: 'guess', raw: { num: 10 }, fb: { num: { color: 'green' } } }, 1).ok, '矛盾线索会被识别');

console.log('— 5. 推荐与锁定');
const rank1 = E.rankGuesses(ds1, [0, 1, 2]);
eq(rank1.length, 3, '给出 3 个候选建议');
ok(rank1[0].expected <= rank1[2].expected, '按期望剩余升序');
const asks1 = E.rankAsks(ds1, [0, 1, 2]);
ok(asks1.length > 0, '有提问建议（' + asks1.length + ' 条）');
const L1 = E.lockText(ds1.fields[2], [rec1]);
eq(L1.text, '11 ~ 13', '锁定：黄色给区间 + 箭头给下界 → 收窄成 11~13');
const L2 = E.lockText(ds1.fields[0], [{ kind: 'guess', raw: { name: 'A' }, fb: { name: { color: 'green' } } }]);
eq(L2.text, '= A', '锁定：精确值');

console.log('— 6. 示例数据集（元素周期表）');
const ex = E.EXAMPLE_ELEMENT;
eq(ex.rows.length, 36, '36 行');
eq(ex.fields.length, 8, '8 个字段');
const exDs = E.buildDataset({ name: ex.name, fields: ex.fields, rows: ex.rows.map((r) => {
  const o = {}; ex.columns.forEach((c, i) => { o[c] = r[i]; }); return o;
}), groups: {} });
eq(exDs.primary.key, '名称', '主键是元素名称');
eq(exDs.rows[0].n['原子序数'], 1, '氢的原子序数归一成数字');
eq(E.colorOf(E.relCode(exDs.fields[2], 1, exDs.rows[10].n, exDs.ctx)), 'gray', '序数 1 vs 11 差 10，超容差 2 → 灰');
ok(E.colorOf(E.relCode(exDs.fields[2], 10, exDs.rows[11].n, {})) === 'yellow', '序数 10 vs 12 差 2 → 黄');
ok(E.colorOf(E.relCode(exDs.fields[4], '稀有气体', exDs.rows[1].n, exDs.ctx)) === 'green', '氦=稀有气体 → 绿');

console.log('— 7. 模拟整局对局（本地出题 + 只用建议的第一选择）');
let games = 0, wins = 0, totalGuesses = 0, worst = 0;
const seeds = [];
for (let g = 0; g < 40; g++) {
  const secret = (g * 17 + 3) % exDs.rows.length;
  const records = [];
  let solved = false, steps = 0;
  for (let turn = 1; turn <= 8; turn++) {
    const set = E.filterCandidates(exDs, records).kept;
    if (!set.length) break;
    const pick = set.length === 1 ? set[0] : E.rankGuesses(exDs, set)[0].idx;
    const pickName = exDs.rows[pick].row['名称'];
    const gNorms = {};
    exDs.fields.forEach((f) => { gNorms[f.key] = exDs.rows[pick].n[f.key]; });
    const fb = E.feedbackAgainst(exDs, gNorms, secret);
    records.push({ kind: 'guess', raw: exDs.rows[pick].row, guessNorm: gNorms, fb: fb });
    steps++;
    if (pick === secret) { solved = true; break; }
  }
  games++; if (solved) { wins++; totalGuesses += steps; worst = Math.max(worst, steps); }
  else seeds.push(g);
}
eq(wins, games, '40 局全部在 8 步内猜中（失败局：' + seeds.join(',') + '）');
console.log('   平均 ' + (totalGuesses / games).toFixed(2) + ' 步，最差 ' + worst + ' 步');

console.log('— 8. 海龟汤式提问也能收敛');
let askWins = 0;
for (let g = 0; g < 15; g++) {
  const secret = (g * 11 + 5) % exDs.rows.length;
  const records = [];
  let solved = false;
  for (let turn = 1; turn <= 12; turn++) {
    const set = E.filterCandidates(exDs, records).kept;
    if (!set.length) break;
    if (set.length === 1) { solved = (set[0] === secret); break; }
    const ask = E.rankAsks(exDs, set)[0];
    if (!ask) { solved = set.indexOf(secret) >= 0 && set.length === 1; break; }
    const code = E.relCode(ask.field, E.guessNorm(ask.field, ask.value), exDs.rows[secret].n, {});
    const result = !code ? 'no' : (E.colorOf(code) === 'green' ? 'yes' : (E.colorOf(code) === 'yellow' ? 'close' : 'no'));
    records.push({ kind: 'ask', field: ask.field.key, value: ask.value, result: result });
    if (E.filterCandidates(exDs, records).kept.length === 1) { solved = E.filterCandidates(exDs, records).kept[0] === secret; break; }
  }
  if (solved) askWins++;
}
eq(askWins, 15, '15 局提问模式全部在 12 问内收敛到正确答案');

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
