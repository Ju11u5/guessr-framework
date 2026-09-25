/**
 * 生成一个端到端测试页：把交互脚本注入到 friberg-assistant.html 里，
 * 用无头 Chrome 跑完再把结果写进 document.title。
 *
 * 跑法：
 *   node tests/make-ui-test.js
 *   chrome --headless=new --dump-dom file:///.../tests/ui-test.html | grep RESULT::
 */
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'friberg-assistant.html');
let html = fs.readFileSync(appPath, 'utf8');

/* 先清空 localStorage，保证每次都是从零开始的初始态 */
html = html.replace('<script>', '<script>try{localStorage.clear()}catch(e){}</script>\n<script>');

const testScript = `
<script>
setTimeout(function () {
  window.confirm = function () { return true; };
  window.alert = function () {};
  var log = [];
  function L(k, v) { log.push(k + '=' + v); }
  function txt(id) { var e = document.getElementById(id); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : '(缺失)'; }
  function count(sel) { return document.querySelectorAll(sel).length; }
  function setVal(id, v) { var e = document.getElementById(id); if (!e) { L('缺元素', id); return; } e.value = v; }
  function cyc(id) { return document.querySelector('#guess-fb .cyc[data-key="' + id + '"]'); }
  function setGreen(id) { cyc(id).click(); }
  function setYellow(id) { cyc(id).click(); cyc(id).click(); }
  function setDir(id) { document.querySelector('#guess-fb .dirbtn[data-key="' + id + '"]').click(); }

  try {
    /* ---------- 0. 内置数据库 ---------- */
    L('0.内置库信息', txt('builtin-meta'));
    L('0.首次打开自动载入', txt('pool-count'));
    L('0.说明文字', txt('builtin-desc').slice(0, 60));
    var adv = [].slice.call(document.querySelectorAll('#advice-guess .advice')).slice(0, 3).map(function (el) {
      return el.querySelector('.who').textContent.replace(/^\\d+\\.\\s*/, '') + ' ' + el.querySelector('.num').textContent;
    });
    L('0.开局(646人)推荐前三条', adv.join(' / '));
    L('0.开局候选人数', txt('cand-count'));
    setVal('sel-diff', 'easy');
    document.getElementById('sel-diff').dispatchEvent(new Event('change'));
    L('0.切简单版后的难度池', txt('cand-count'));
    setVal('sel-diff', 'normal');
    document.getElementById('sel-diff').dispatchEvent(new Event('change'));
    L('0.切回完整版', txt('cand-count'));
    setVal('pool-search', 'Zywoo');
    document.getElementById('pool-search').dispatchEvent(new Event('input'));
    L('0.搜索 zywoo（宽松匹配）', txt('pool-count2'));
    var editBtn = document.querySelector('#pool-body button[data-editp]');
    editBtn.click();
    L('0.点「改」后的表单', document.getElementById('pv-name').value + ' / 年龄' + document.getElementById('pv-age').value);
    document.getElementById('btn-add-blank').click();
    setVal('pool-search', '');
    document.getElementById('pool-search').dispatchEvent(new Event('input'));

    /* ---------- 1. 清空后用手工数据跑一遍完整推理 ---------- */
    document.getElementById('btn-pool-clear').click();
    L('1.清空后池', txt('pool-count'));
    setVal('pool-paste', 'A\\tMOUZ\\t瑞典\\t24\\t狙击手\\t1\\t6\\t现役\\nB\\tNAVI\\t乌克兰\\t29\\t狙击手\\t1\\t11\\t现役\\nC\\tMOUZ\\t巴西\\t21\\t步枪手\\t0\\t3\\t现役');
    document.getElementById('btn-paste-import').click();
    L('1.导入后池', txt('pool-count'));
    L('1.初始候选', txt('cand-count'));

    setVal('g-name', 'A');                       /* 用池里已有名字 → 属性应自动填入 */
    document.getElementById('g-name').dispatchEvent(new Event('input'));
    L('1.自动回填（年龄/队伍/位置）', document.getElementById('gv-age').value + '/' + document.getElementById('gv-team').value + '/' + document.getElementById('gv-role').value);

    /* 换成另一个选手 X 录入一次猜测：X 自己 22 岁，反馈说「答案比 X 大」→ 应只剩 24 岁的 A */
    setVal('g-name', 'X');
    setVal('gv-team', 'MOUZ'); setVal('gv-country', '瑞典'); setVal('gv-age', '22');
    setVal('gv-role', 'awper'); setVal('gv-majorWins', '1'); setVal('gv-majorApps', '6'); setVal('gv-status', 'active');
    L('1.提交前表单值', [document.getElementById('gv-team').value, document.getElementById('gv-country').value, document.getElementById('gv-age').value].join(','));
    setGreen('team'); setGreen('country'); setGreen('role');
    setGreen('majorWins'); setGreen('majorApps'); setGreen('status');
    setYellow('age'); setDir('age');
    document.getElementById('btn-add-guess').click();
    L('1.记录数', txt('rec-count'));
    L('1.过滤后候选', txt('cand-count'));
    L('1.建议', txt('advice-guess'));
    L('1.表单已清空', document.getElementById('g-name').value === '');
    L('1.线索行数', count('#rec-body tr'));

    /* ---------- 2. 删掉线索 + 切海龟汤 ---------- */
    document.querySelector('#rec-body button[data-del]').click();
    L('2.删除后记录', txt('rec-count') === '' ? '0(空)' : txt('rec-count'));
    L('2.删除后候选', txt('cand-count'));
    document.querySelector('#seg-mode button[data-mode="soup"]').click();
    L('2.提问建议条数', count('#advice-ask .advice'));
    L('2.首条提问建议', (document.querySelector('#advice-ask .advice .who') || {}).textContent || '(无)');
    var fillAsk = document.querySelector('#advice-ask button[data-fillask]');
    if (fillAsk) {
      fillAsk.click();
      L('2.一键填入提问', document.getElementById('a-field').value + '=' + document.getElementById('a-value').value);
    }
    setVal('a-field', 'country'); setVal('a-value', '瑞典'); setVal('a-result', 'yes');
    document.getElementById('btn-add-ask').click();
    L('2.提问后候选', txt('cand-count'));
    L('2.进度', txt('progress'));

    /* ---------- 3. 一键重置 / 清空 / 撤销 / 折叠区 ---------- */
    document.getElementById('btn-clear-rec').click();
    L('3.清空全部后记录', txt('rec-count') === '' ? '0(空)' : txt('rec-count'));
    L('3.清空后的提示条', (document.querySelector('.toast span') || {}).textContent || '(无)');
    var tb = document.querySelector('.toast button');
    if (tb) tb.click();
    L('3.点提示里的撤销后记录', txt('rec-count'));

    document.getElementById('btn-newgame').click();
    L('3.新一局后记录', txt('rec-count') === '' ? '0(空)' : txt('rec-count'));
    L('3.新一局后候选', txt('cand-count'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    L('3.Ctrl+Z 之后记录', txt('rec-count'));
    L('3.撤销按钮状态', document.getElementById('btn-undo').disabled ? '已到底(禁用)' : '可用');

    setVal('g-name', 'ZywOo');
    document.getElementById('g-name').dispatchEvent(new Event('input'));
    document.getElementById('btn-add-guess').click();
    L('3.一格颜色都没点就记录', ((document.querySelector('.toast span') || {}).textContent || '(无提示)') + ' / 记录数=' + (txt('rec-count') || '0(空)'));

    setVal('g-name', '池外的某人');
    document.getElementById('g-name').dispatchEvent(new Event('input'));
    L('3.池外选手自动展开属性区', document.getElementById('fold-values').open);
    document.getElementById('gv-age').value = '24';
    document.getElementById('guess-values').dispatchEvent(new Event('input'));
    L('3.折叠区摘要', document.getElementById('fold-preview').textContent.replace(/\\s+/g, ' ').trim());

    setVal('g-name', 'ZywOo');
    document.getElementById('g-name').dispatchEvent(new Event('input'));
    document.querySelector('#guess-fb .cyc[data-key="country"]').click();
    document.getElementById('g-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    L('3.输入框回车即记录', txt('rec-count'));

    /* ---------- 4. 存档与查询 ---------- */
    L('4.存档池大小', JSON.parse(localStorage.getItem('friberg_helper_pool_v1') || '[]').length);
    var lp = document.getElementById('country-lookup');
    lp.value = '塞尔维亚科索沃'; lp.dispatchEvent(new Event('input'));
    L('4.赛区查询', txt('lookup-result').slice(0, 26));
  } catch (e) {
    L('运行异常', (e && e.message) || String(e));
  }
  document.title = 'RESULT::' + log.join(' || ');
}, 500);
</script>
`;
html = html.replace('</body>', testScript + '</body>');

const out = path.join(__dirname, 'ui-test.html');
fs.writeFileSync(out, html);

/* 测试页在 tests/ 下，需要同目录的 players.js 才能自动载入数据库 */
const playersJs = path.join(__dirname, '..', 'players.js');
const hasData = fs.existsSync(playersJs);
if (hasData) fs.copyFileSync(playersJs, path.join(__dirname, 'players.js'));

console.log('生成 ' + out + '（' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB）' +
  (hasData ? '，并带上 players.js' : '，注意：没有 players.js，数据库为空'));
