/**
 * 生成运行期选手数据文件 players.js（与 friberg-assistant.html 同目录）。
 *
 * 为什么数据不放在仓库里：
 *   数据来自上游项目（AGPL-3.0）的编译产物，本仓库不打包任何选手数据。
 *   你要用内置数据库，得自己准备数据源，见 README「选手数据从哪来」。
 *
 * 需要两个输入文件（都不在仓库里）：
 *   data/players-origin.json  选手数据（含 nickname/nationality/region/team/birth_year/
 *                             role/major_championships/major_appearances/is_active/is_easy）
 *   data/region-map.json      国家 → 赛区 对照表
 *
 * 用法：node tests/build-db.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const playersFile = path.join(root, 'data', 'players-origin.json');
const regionFile = path.join(root, 'data', 'region-map.json');

if (!fs.existsSync(playersFile)) {
  console.error('✘ 缺 %s\n  这个文件不在仓库里，请按 README「选手数据从哪来」自行获取。', playersFile);
  process.exit(1);
}

const playersRaw = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
const regionMap = fs.existsSync(regionFile) ? JSON.parse(fs.readFileSync(regionFile, 'utf8')) : {};

const REGION_KEYS = {
  '欧洲': 'europe', '独联体': 'cis', '亚洲': 'asia', '大洋洲': 'oceania',
  '北美': 'northAmerica', '南美': 'southAmerica', '非洲与以色列': 'africaIsrael'
};
const ROLE_KEYS = { Rifler: 'rifler', AWPer: 'awper', Coach: 'coach' };

const baseYear = new Date().getFullYear();
const problems = [];

/* 列顺序：[昵称, 国家/地区, 赛区, 队伍, 出生年, 位置, Major冠军, Major参赛, 现役?, 简单版?] */
const rows = playersRaw.map((p) => {
  const region = REGION_KEYS[p.region];
  const role = ROLE_KEYS[p.role];
  if (!region) problems.push('未知赛区: ' + p.region + ' (' + p.nickname + ')');
  if (!role) problems.push('未知位置: ' + p.role + ' (' + p.nickname + ')');
  if (!p.birth_year) problems.push('缺出生年: ' + p.nickname);
  return [
    p.nickname,
    p.nationality,
    region || '',
    p.team,
    p.birth_year || 0,
    role || '',
    p.major_championships,
    p.major_appearances,
    p.is_active ? 1 : 0,
    p.is_easy ? 1 : 0
  ];
});

const officialSorted = {};
Object.keys(regionMap).sort().forEach((k) => { officialSorted[k] = regionMap[k]; });

const generatedAt = new Date().toISOString().slice(0, 10);
const payload = {
  meta: {
    count: rows.length,
    easyCount: rows.filter((r) => r[9]).length,
    source: process.env.FRIBERG_DATA_SOURCE || '本地数据源（未在仓库中分发）',
    generatedAt: generatedAt,
    baseYear: baseYear
  },
  columns: ['name', 'country', 'region', 'team', 'birthYear', 'role', 'majorWins', 'majorApps', 'active', 'easy'],
  officialRegion: officialSorted,
  raw: rows
};

const js = '/* 自动生成，请勿手改：node tests/build-db.js */\n' +
  'window.FRIBERG_DATA_EXT = ' + JSON.stringify(payload) + ';\n';
const outJs = path.join(root, 'players.js');
fs.writeFileSync(outJs, js, 'utf8');

/* 同时也导出一份可直接「导入存档」的 JSON */
const poolJson = rows.map((r) => {
  const o = {
    name: r[0], country: r[1], region: r[2], team: r[3],
    age: r[4] ? baseYear - r[4] : null,
    role: r[5], majorWins: r[6], majorApps: r[7],
    status: r[8] ? 'active' : 'retired',
    tiers: r[9] ? ['normal', 'easy'] : ['normal']
  };
  if (r[4]) o.ageFromBirth = r[4];
  return o;
});
fs.writeFileSync(path.join(root, 'data', 'players-646.json'), JSON.stringify(poolJson, null, 1));

console.log('✔ 已生成 players.js：' + rows.length + ' 名选手（简单版 ' +
  payload.meta.easyCount + ' 人），' + (js.length / 1024).toFixed(1) + ' KB');
console.log('✔ 官方赛区表 ' + Object.keys(officialSorted).length + ' 条');
console.log('✔ 已导出 data/players-646.json（可直接导入存档）');
if (problems.length) console.log('⚠ 数据问题 ' + problems.length + ' 条：\n  ' + problems.slice(0, 5).join('\n  '));
else console.log('✔ 数据自检：无缺字段/未知枚举');
