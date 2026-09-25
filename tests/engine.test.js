const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/../friberg-assistant.html', 'utf8');
const start = html.indexOf('ENGINE_START');
const end = html.indexOf('ENGINE_END');
if (start < 0 || end < 0) { console.error('找不到 ENGINE 标记'); process.exit(1); }
const bodyStart = html.indexOf('*/', start) + 2;
const bodyEnd = html.lastIndexOf('/*', end);
const block = html.slice(bodyStart, bodyEnd);

/* 选手数据是可选的（仓库里不打包）：有 players.js 才跑数据相关断言 */
const playersJs = __dirname + '/../players.js';
const HAS_DATA = fs.existsSync(playersJs);

const sandbox = { module: { exports: {} }, console, window: {} };
vm.createContext(sandbox);
if (HAS_DATA) vm.runInContext(fs.readFileSync(playersJs, 'utf8'), sandbox);
vm.runInContext(block, sandbox);
const E = sandbox.module.exports;
if (!HAS_DATA) console.log('（未找到 players.js，跳过选手数据库相关断言 —— 这是仓库的默认状态）');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; }
  else { fail++; console.log('  FAIL', label, '\n    实际:', a, '\n    期望:', b); }
}
function ok(cond, label) { if (cond) pass++; else { fail++; console.log('  FAIL', label); } }
const filtered = (pool, recs) => E.filterCandidates(pool, recs);

console.log('— 数值关系（年龄容差 3）');
eq(E.numericRelation(25, 25, 3), { color: 'green', dir: '' }, '相同→绿');
eq(E.numericRelation(25, 27, 3), { color: 'yellow', dir: 'up' }, '答案大2→黄↑');
eq(E.numericRelation(25, 22, 3), { color: 'yellow', dir: 'down' }, '答案小3→黄↓');
eq(E.numericRelation(25, 29, 3), { color: 'gray', dir: 'up' }, '差4→灰↑');
eq(E.numericRelation(3, 4, 1), { color: 'yellow', dir: 'up' }, 'Major差1→黄');

console.log('— 国家/赛区（法国与瑞典同欧洲赛区）');
const fCountry = E.FIELD_BY_KEY.country;
eq(E.fieldRelation(fCountry, { country: '法国' }, { country: '法国' }), { color: 'green', dir: '' }, '同国→绿');
eq(E.fieldRelation(fCountry, { country: '法国' }, { country: '瑞典' }), { color: 'yellow', dir: '' }, '同赛区异国→黄');
eq(E.fieldRelation(fCountry, { country: '法国' }, { country: '巴西' }), { color: 'gray', dir: '' }, '异赛区→灰');
eq(E.fieldRelation(fCountry, { country: 'France' }, { country: 'Sweden' }), { color: 'yellow', dir: '' }, '英文同样判定');
eq(E.fieldRelation(fCountry, { country: '中国' }, { country: '韩国' }), { color: 'yellow', dir: '' }, '中日韩同亚太');
eq(E.fieldRelation(fCountry, { country: '以色列' }, { country: '中国' }), { color: 'gray', dir: '' }, '以色列≠亚太');
eq(E.fieldRelation(fCountry, { country: '中国台湾' }, { country: '中国香港' }), { color: 'yellow', dir: '' }, '中国台湾与中国香港同赛区');

console.log('— 队伍（历史队伍判定）');
const fTeam = E.FIELD_BY_KEY.team;
eq(E.fieldRelation(fTeam, { team: 'MOUZ' }, { team: 'MOUZ' }), { color: 'green', dir: '' }, '当前队相同→绿');
eq(E.fieldRelation(fTeam, { team: 'FaZe' }, { team: 'MOUZ', teamHistory: ['FaZe'] }), { color: 'yellow', dir: '' }, '曾在 FaZe→黄');
eq(E.fieldRelation(fTeam, { team: 'NAVI' }, { team: 'MOUZ', teamHistory: ['FaZe'] }), { color: 'gray', dir: '' }, '都没有→灰');
eq(E.fieldRelation(fTeam, { team: 'FaZe' }, { team: 'MOUZ', teamHistory: [] }), null, '历史未知→不判定');

console.log('— 位置 / 状态只有全对才绿');
eq(E.fieldRelation(E.FIELD_BY_KEY.role, { role: '狙击手' }, { role: '狙击手' }), { color: 'green', dir: '' }, '位置相同');
eq(E.fieldRelation(E.FIELD_BY_KEY.role, { role: '狙击手' }, { role: '步枪手' }), { color: 'gray', dir: '' }, '位置不同');
eq(E.fieldRelation(E.FIELD_BY_KEY.status, { status: '现役' }, { status: '退役' }), { color: 'gray', dir: '' }, '状态不同');

console.log('— 候选过滤');
const pool = [
  E.normalizePlayer({ name: 'A', team: 'MOUZ', country: '瑞典', age: 26, role: 'awper', majorWins: 1, majorApps: 6, status: 'active' }),
  E.normalizePlayer({ name: 'B', team: 'NAVI', country: '乌克兰', age: 29, role: 'awper', majorWins: 1, majorApps: 11, status: 'active' }),
  E.normalizePlayer({ name: 'C', team: 'MOUZ', country: '巴西', age: 21, role: 'rifler', majorWins: 0, majorApps: 3, status: 'active' })
];
const recSWE = {
  kind: 'guess', name: 'X',
  values: { team: 'MOUZ', country: '瑞典', age: 24, role: 'awper', majorWins: 1, majorApps: 6, status: 'active' },
  fb: { team: { color: 'green' }, country: { color: 'green' }, age: { color: 'yellow', dir: 'up' }, role: { color: 'green' }, majorWins: { color: 'green' }, majorApps: { color: 'green' }, status: { color: 'green' } }
};
let res = E.filterCandidates(pool, [recSWE]);
eq(res.kept.map(p => p.name), ['A'], 'MOUZ+瑞典 锁定 → 只剩 A');

const recRegion = {
  kind: 'guess', name: 'Y',
  values: { country: '巴西' },
  fb: { country: { color: 'gray' } }
};
res = E.filterCandidates(pool, [recRegion]);
eq(res.kept.map(p => p.name), ['A', 'B'], '猜巴西为灰 → 排除巴西人 C');

const recAgeArrow = {
  kind: 'guess', name: 'Z',
  values: { age: 26 },
  fb: { age: { color: 'gray', dir: 'down' } }
};
res = E.filterCandidates(pool, [recAgeArrow]);
eq(res.kept.map(p => p.name), ['C'], '答案比 26 小且差 >3 → 只剩 21 岁的 C');

console.log('— 海龟汤提问判定与推荐');
const fAge = E.FIELD_BY_KEY.age;
eq(E.askRelation(fAge, 26, { age: 26 }), 'yes', '同岁→是');
eq(E.askRelation(fAge, 26, { age: 28 }), 'close', '差2→是也不是');
eq(E.askRelation(fAge, 26, { age: 28 }), 'close', '差2→是也不是');
eq(E.askRelation(fAge, 26, { age: 33 }), 'no', '差7→不是');
eq(E.askRelation(fTeam, 'FaZe', { team: 'MOUZ', teamHistory: ['FaZe'] }), 'close', '曾效力→是也不是');
eq(E.askRelation(fCountry, '法国', { country: '瑞典' }), 'close', '同赛区→是也不是');

const asks = E.rankAsks(pool);
ok(asks.length > 0, '有提问建议');
ok(asks.every(a => a.expected >= 1), '期望剩余 ≥ 1');
const askDist = E.partitionByAsk(fCountry, '瑞典', pool);
eq(askDist.counts, { yes: 1, close: 1, no: 1 }, '问「你是瑞典人吗」把 3 人分成 1/1/1');

const ranked = E.rankGuesses(pool);
eq(ranked.length, 3, '给出 3 个猜名建议');
ok(ranked[0].expected <= ranked[2].expected, '按期望剩余升序');
const single = E.rankGuesses([pool[0]]);
ok(single[0].done === true, '只剩 1 人时标记可直接猜');

console.log('— 锁定信息');
const locks = E.describeLocks([
  { kind: 'guess', values: { country: '法国' }, fb: { country: { color: 'green' } } },
  { kind: 'guess', values: { age: 24 }, fb: { age: { color: 'gray', dir: 'up' } } },
  { kind: 'guess', values: { majorApps: 5 }, fb: { majorApps: { color: 'yellow' } } }
]);
eq(E.lockText(E.FIELD_BY_KEY.country, locks.country), '= 法国', '国家被锁定');
eq(E.lockText(E.FIELD_BY_KEY.age, locks.age), '≥ 25', '年龄有下界');
eq(E.lockText(E.FIELD_BY_KEY.majorApps, locks.majorApps), '4 ~ 6', 'Major 参赛成区间');
eq(E.lockText(E.FIELD_BY_KEY.team, locks.team), '未约束', '未涉及维度为未约束');

const locks2 = E.describeLocks([
  { kind: 'ask', field: 'age', value: 25, result: 'yes' }
]);
eq(E.lockText(E.FIELD_BY_KEY.age, locks2.age), '= 25', '提问答“是”直接锁年龄');

console.log('— 粘贴导入解析');
const parsed = E.parsePastedPlayers(
  [
    'ZywOo\tTeam Vitality\t法国\t25\t狙击手\t2\t8\t现役',
    '昵称\t队伍\t国家\t年龄\t位置\t冠军\t参赛\t状态',
    'ZywOo2\tTeam Vitality\t法国\tabc\t狙击手\t2\t8\t现役',
    ' s1mple | Team Falcons | 乌克兰 | 28 | 狙击手 | 2 | 11 | 现役',
    '# 这是注释'
  ].join('\n'),
  'name,team,country,age,role,majorWins,majorApps,status'
);
eq(parsed.players.length, 2, '导入 2 人（表头与坏行跳过）');
eq(parsed.bad.length, 1, '坏行计数 1');
eq(parsed.players[0].role, 'awper', '角色归一化为 awper');
eq(parsed.players[0].status, 'active', '状态归一化');
eq(parsed.players[1].country, '乌克兰', '竖线分隔也认');
eq(E.regionOf(parsed.players[1]), 'europe', '乌克兰归欧洲赛区（官方描述明确列入）');

const nameOnly = E.parsePastedPlayers('ZywOo\ns1mple\ndonk', 'name');
eq(nameOnly.players.map(p => p.name), ['ZywOo', 's1mple', 'donk'], '仅昵称模式');
eq(nameOnly.players[0].age, null, '仅昵称时属性为空而不是 0');

if (HAS_DATA) {
  console.log('— 内置数据库（官方开源仓库数据）');
  const builtin = E.builtinPlayers();
  eq(builtin.length, 646, '内置选手 646 人');
  eq(builtin.filter((p) => p.tiers.indexOf('easy') >= 0).length, 352, '简单版 352 人');
  eq(E.BUILTIN_META.count, 646, '元信息条数一致');
  eq(E.builtinPlayers(2026).find((p) => p.name === 's1mple').age, 29, 's1mple 年龄 = 2026-1997 = 29');
  eq(E.builtinPlayers(2026).find((p) => p.name === 'donk').age, 19, 'donk 年龄 = 2026-2007 = 19');
  const zw = E.builtinPlayers(2026).find((p) => p.name === 'ZywOo');
  eq([zw.country, zw.team, zw.role, zw.majorWins, zw.majorApps, zw.status], ['法国', 'Vitality', 'awper', 3, 11, 'active'], 'ZywOo 一行数据（注意 majorApps=11 是 2026-07-19 快照值，演示种子文件里写的是 8，两者不一致）');
  eq(builtin.filter((p) => p.status === 'retired').length, 129, '退役选手 129 人');
  eq(E.filterByTier(builtin, 'normal').length, 646, '完整版不过滤');
  eq(E.filterByTier(builtin, 'easy').length, 352, '简单版过滤到 352');
  eq(E.filterByTier(builtin, 'beginner').length, 352, '入门版用简单版近似');
  eq(E.filterByTier(builtin.concat([{ name: 'X', tiers: undefined }]), 'easy').length, 353, '手动添加的不受档位过滤');

  console.log('— 内置数据与国家→赛区覆盖');
  const natMiss = [];
  const seenNat = {};
  builtin.forEach((p) => {
    if (seenNat[p.country]) return;
    seenNat[p.country] = 1;
    if (!E.COUNTRY_TO_REGION[String(p.country).toLowerCase().replace(/\s+/g, '')]) natMiss.push(p.country);
  });
  eq(natMiss, [], '库里出现的每个国家都能查到赛区');
  eq(E.regionOf({ country: '乌克兰' }), 'europe', '乌克兰→欧洲（官方表）');
  eq(E.regionOf({ country: '土耳其' }), 'asia', '土耳其→亚洲（官方表）');
  eq(E.regionOf({ country: '南非' }), 'africaIsrael', '南非→非洲与以色列');
  eq(E.regionOf({ country: '塞尔维亚科索沃' }), 'europe', '塞尔维亚科索沃→欧洲（官方命名）');
  eq(E.OFFICIAL_COUNTRY_REGION['中国台湾'], '亚洲', '官方表含中国台湾且归亚洲');

  console.log('— 昵称消歧后缀与宽松匹配');
  eq(builtin.filter((p) => /[（(]/.test(p.name)).length, 12, '12 个昵称带消歧后缀');
  eq(E.nameKey('NiKo（波黑）'), E.nameKey('NiKo'), '带后缀与不带后缀视为同一键');
  eq(E.nameKey('GeT-RiGhT'), E.nameKey('GeT_RiGhT'), '连字符与下划线视为同一键');
  ok(E.nameKey('niko(丹麦)') !== E.nameKey('NiKo（波黑）') === false, '两个 niko 去后缀后确实撞键（需靠精确匹配兜底）');

  console.log('— 真实对局推演（用真实选手数据）');
  const g = builtin.find((p) => p.name === 'NiKo（波黑）');
  ok(!!g, '库里存在 NiKo（波黑）');
  const recNiko = {
    kind: 'guess', name: g.name,
    values: { team: g.team, country: g.country, age: g.age, role: g.role, majorWins: g.majorWins, majorApps: g.majorApps, status: g.status },
    fb: {
      team: { color: 'green' }, country: { color: 'green' }, age: { color: 'green' },
      role: { color: 'green' }, majorWins: { color: 'green' }, majorApps: { color: 'green' }, status: { color: 'green' }
    }
  };
  const niko = filtered(builtin, [recNiko]);
  eq(niko.kept.map((p) => p.name), ['NiKo（波黑）'], '整行全绿 → 唯一命中 NiKo（波黑）');

  const bosnians = builtin.filter((p) => p.country === '波黑');
  eq(bosnians.length, 3, '波黑共 3 名选手（pita / NiKo（波黑） / hunter）');

  const partial = {
    kind: 'guess', name: 'NiKo（波黑）',
    values: { team: 'Falcons', country: '波黑', age: 29, role: 'rifler', majorWins: 1, majorApps: 17, status: 'active' },
    fb: { country: { color: 'green' }, age: { color: 'yellow', dir: 'up' } }
  };
  const narrowed = filtered(builtin, [partial]);
  ok(narrowed.kept.length > 0 && narrowed.kept.length <= 3, '国家绿 + 年龄黄↑ → 候选收敛到 ' + narrowed.kept.length + ' 人');
  ok(narrowed.kept.every((p) => p.country === '波黑'), '收敛结果全是波黑籍');
  ok(narrowed.kept.every((p) => p.age >= 30 && p.age <= 32), '收敛结果年龄都在 30~32');

  console.log('— 难度切换影响推荐范围');
  const poolDont = builtin.filter((p) => ['donk', 'ZywOo', 's1mple'].indexOf(p.name) >= 0);
  const rankedReal = E.rankGuesses(poolDont);
  eq(rankedReal.length, 3, '三个真实选手都能给出建议');
  ok(rankedReal[0].expected <= 3 && rankedReal[0].expected >= 1, '期望剩余在合理区间');
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
