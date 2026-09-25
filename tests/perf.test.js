/**
 * 性能与一致性测试：
 *  1) 快速路径（profileOf + relCodeFast）与逐字段判定（fieldRelation）必须给出完全相同的反馈
 *  2) 全池推荐的耗时必须在可接受范围内
 *  3) 推荐质量：开局第一猜必须真的把 646 人切小，而不是退化成一个组
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'friberg-assistant.html'), 'utf8');
const s = html.indexOf('ENGINE_START'), e = html.indexOf('ENGINE_END');
const block = html.slice(html.indexOf('*/', s) + 2, html.lastIndexOf('/*', e));
const playersJs = path.join(__dirname, '..', 'players.js');
const HAS_DATA = fs.existsSync(playersJs);
const sandbox = { module: { exports: {} }, console, window: {} };
vm.createContext(sandbox);
if (HAS_DATA) vm.runInContext(fs.readFileSync(playersJs, 'utf8'), sandbox);
vm.runInContext(block, sandbox);
const E = sandbox.module.exports;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const eqLog = (a, b, m) => { if (a === b) { pass++; console.log('   · ' + m); } else { fail++; console.log('  FAIL', m, '(实际 ' + a + '，期望 ' + b + ')'); } };

const pool = E.builtinPlayers(2026);
if (!pool.length) {
  console.log('（未找到 players.js —— 仓库默认不含选手数据，本测试跳过）');
  process.exit(0);
}

console.log('— 1. 快慢两条路径一致性（6000 组随机配对 × 7 字段）');
let mismatch = 0, checked = 0;
for (let i = 0; i < 6000; i++) {
  const g = pool[(i * 37) % pool.length];
  const c = pool[(i * 91 + 13) % pool.length];
  const gp = E.profileOf(g), cp = E.profileOf(c);
  const slow = E.feedbackFor({ values: E.playerAsGuessValues(g) }, c);
  for (const f of E.FIELDS) {
    const dec = E.decodeRel(E.relCodeFast(f, gp, cp)) || { color: '', dir: '' };
    const sl = slow[f.key];
    checked++;
    if (dec.color !== (sl.color || '') || dec.dir !== (sl.dir || '')) {
      mismatch++;
      if (mismatch <= 3) console.log('   不一致', f.key, JSON.stringify(dec), JSON.stringify(sl));
    }
  }
}
ok(mismatch === 0, `快慢路径判定一致（检查 ${checked} 处，不一致 ${mismatch} 处）`);

console.log('— 2. 推荐质量');
const ranked = E.rankGuesses(pool);
ok(ranked.length > 0, '有推荐结果');
ok(ranked[0].expected < pool.length * 0.05,
  '首猜把 646 人切到期望剩余 ' + ranked[0].expected.toFixed(1) + ' 人（应远小于 646）');
ok(ranked[0].expected <= ranked[ranked.length - 1].expected, '按期望剩余升序');
const profileCount = new Set(pool.map((p) => E.profileSignature(E.profileOf(p)))).size;
console.log('   选手 ' + pool.length + ' 人 → 属性互不相同的猜测 ' + profileCount + ' 个（去重后要评估的猜测数）');

console.log('— 3. 整数矩阵快路径 vs 参考实现（400 个猜测逐一比对分布）');
const P = E.compilePool(pool);
const profiles = pool.map(E.profileOf);
let distMismatch = 0;
for (let k = 0; k < 400; k++) {
  const gi = (k * 137 + 7) % pool.length;
  const fast = E.partitionCompiled(P, gi);
  const ref = E.partitionProfiles(E.profileOf(pool[gi]), profiles);
  const a = [...fast.sizes].sort((x, y) => x - y).join(',');
  const b = [...ref.sizes].sort((x, y) => x - y).join(',');
  if (a !== b || Math.abs(fast.expected - ref.expected) > 1e-9) distMismatch++;
}
ok(distMismatch === 0, `两种情况分布完全一致（不一致 ${distMismatch} 处）`);
ok(P.teamCount > 50, '队伍被正确 intern（' + P.teamCount + ' 支）');

console.log('— 3b. 历史队伍（队伍列黄色）');
const histKnownBuiltin = P.histKnown.reduce((a, b) => a + b, 0);
eqLog(histKnownBuiltin, 0, '内置数据不含历史队伍（导入源没有该字段），队伍黄色无法自动利用');
const withHistory = [
  E.normalizePlayer({ name: 'T1', team: 'MOUZ', country: '瑞典', age: 26, role: 'rifler', majorWins: 1, majorApps: 6, status: 'active', teamHistory: ['FaZe', 'NAVI'] }),
  E.normalizePlayer({ name: 'T2', team: 'MOUZ', country: '瑞典', age: 26, role: 'rifler', majorWins: 1, majorApps: 6, status: 'active', teamHistory: ['G2'] }),
  E.normalizePlayer({ name: 'T3', team: 'MOUZ', country: '瑞典', age: 26, role: 'rifler', majorWins: 1, majorApps: 6, status: 'active' })
];
const histRec = {
  kind: 'guess', name: 'X',
  values: { team: 'FaZe' },
  fb: { team: { color: 'yellow' } }
};
const histKept = E.filterCandidates(withHistory, [histRec]).kept.map((p) => p.name);
ok(histKept.indexOf('T1') >= 0 && histKept.indexOf('T2') < 0,
  '有人填了历史队伍后，队伍黄色能正确筛人（留下 ' + histKept.join('/') + '）');
ok(histKept.indexOf('T3') >= 0, '历史未知的选手不会被错误剔除');

console.log('— 4. 耗时（Node）');
let t = Date.now();
E.rankGuesses(pool);
const guessMs = Date.now() - t;
t = Date.now();
E.rankAsks(pool);
const askMs = Date.now() - t;
console.log('   猜名推荐 ' + guessMs + ' ms · 提问推荐 ' + askMs + ' ms');
ok(guessMs < 300, '猜名推荐在 300ms 内（' + guessMs + ' ms）—— 每次点击重算也不会卡');
ok(askMs < 800, '提问推荐在 800ms 内（' + askMs + ' ms）');

console.log('— 5. 剪枝后仍保持正确性');
const recs = [{
  kind: 'guess', name: 'refrezh',
  values: { country: '丹麦', age: 26 },
  fb: { country: { color: 'green' }, age: { color: 'yellow', dir: 'up' } }
}];
const narrowed = E.filterCandidates(pool, recs).kept;
ok(narrowed.length > 1 && narrowed.every((p) => p.country === '丹麦' && p.age >= 27 && p.age <= 29),
  '丹麦籍且年龄 27~29 的候选 ' + narrowed.length + ' 人');
const r2 = E.rankGuesses(narrowed);
ok(r2[0].expected <= narrowed.length, '收敛集上的推荐合理（期望剩余 ' + r2[0].expected.toFixed(1) + '/' + narrowed.length + '）');
ok(r2[0].expected < E.rankGuesses(pool)[0].expected * narrowed.length / pool.length + 1,
  '候选集变小时推荐确实更"锋利"');

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
