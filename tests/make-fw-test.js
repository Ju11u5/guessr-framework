/**
 * 框架 UI 端到端测试：注入脚本模拟真实操作，用无头 Chrome 跑完读 document.title。
 *   node tests/make-fw-test.js
 *   chrome --headless=new --dump-dom tests/fw-test.html | grep RESULT::
 */
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'guessr-framework.html');
let html = fs.readFileSync(appPath, 'utf8');
html = html.replace('<script>', '<script>try{localStorage.clear()}catch(e){}</script>\n<script>');

const testScript = `
<script>
setTimeout(function () {
  window.confirm = function () { return true; };
  window.alert = function () {};
  window.prompt = function () { return '新列'; };
  var log = [];
  function L(k, v) { log.push(k + '=' + v); }
  function txt(id) { var e = document.getElementById(id); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : '(缺失)'; }
  function count(sel) { return document.querySelectorAll(sel).length; }
  function recs() { return count('#rec-body tr') - (document.querySelector('#rec-body .empty') ? 1 : 0); }
  function setVal(id, v) { var e = document.getElementById(id); if (!e) { L('缺元素', id); return; } e.value = v; }
  function tab(name) { document.querySelector('nav.tabs button[data-tab=' + name + ']').click(); }

  try {
    L('0.初始提示', txt('advice').slice(0, 20));
    L('0.数据集下拉', document.getElementById('sel-dataset').options.length + ' 项');

    /* ---- 1. 载入示例数据 → 解析 → 保存 ---- */
    tab('data');
    document.getElementById('btn-example').click();
    L('1.示例数据行数', document.getElementById('imp-text').value.split('\\n').length);
    document.getElementById('btn-parse').click();
    L('1.预览信息', txt('preview-meta'));
    L('1.预览字段行数', count('#field-body tr'));
    L('1.推断出的规则', [].slice.call(document.querySelectorAll('#field-body select[data-k=rule]')).map(function (s) { return s.value; }).join(','));
    document.getElementById('btn-save-ds').click();
    L('1.已保存数据集', count('#ds-body tr') + ' 行 | ' + txt('ds-meta'));
    L('1.已选中', txt('sel-dataset'));

    /* ---- 2. 对局：本地出题，按建议连猜 ---- */
    tab('play');
    L('2.候选总数', txt('cand-count'));
    L('2.首条建议', (document.querySelector('#advice .advice .who') || {}).textContent || '(无)');
    var turns = 0, won = false;
    for (var t = 0; t < 8 && !won; t++) {
      var fill = document.querySelector('#advice button[data-fill]');
      if (!fill) break;
      fill.click();
      document.getElementById('btn-guess').click();
      turns++;
      var recCount = document.querySelectorAll('#rec-body tr').length;
      if (document.querySelector('#rec-body .chip.green') && txt('advice').indexOf('只剩一个可能') < 0 && /命中/.test(txt('rec-body'))) won = true;
      if (/猜中了/.test(txt('body'))) won = true;
    }
    var ok2 = document.querySelector('#advice .okbox');
    if (!won && ok2) {
      var m = ok2.textContent.match(/只剩一个可能：(.+)$/);
      if (m) { setVal('g-name', m[1].trim()); document.getElementById('btn-guess').click(); turns++; }
    }
    L('2.连猜轮数', turns);
    L('2.是否命中', /命中/.test(txt('rec-body')) ? '是' : '否（' + txt('advice').slice(0, 30) + '）');
    L('2.线索条数', recs());
    L('2.进度', txt('progress'));

    /* ---- 3. 新一局后测属性提问（本地自动回答） ---- */
    document.getElementById('btn-newgame').click();
    L('3.新一局后线索数', recs());
    document.querySelector('#seg-mode button[data-mode=ask]').click();
    L('3.提问建议条数', count('#advice .advice'));
    var fa = document.querySelector('#advice button[data-fillask]');
    if (fa) { fa.click(); L('3.一键填入提问', document.getElementById('a-field').value + '=' + document.getElementById('a-value').value); }
    else { setVal('a-field', '类别'); setVal('a-value', '稀有气体'); }
    var before = recs();
    document.getElementById('btn-ask').click();
    L('3.提问后线索数', before + ' → ' + recs());
    L('3.提问反馈', txt('rec-body').slice(0, 40));

    /* ---- 4. 撤销 ---- */
    document.getElementById('btn-undo').click();
    L('4.撤销后线索数', recs());
    L('4.撤销按钮', document.getElementById('btn-undo').disabled ? '已到底' : '可用');

    /* ---- 5. 外部裁判模式：手工录反馈 ---- */
    document.querySelector('#seg-mode button[data-mode=guess]').click();
    document.querySelector('#seg-src button[data-src=manual]').click();
    L('5.反馈区是否出现', document.getElementById('fb-wrap').style.display !== 'none');
    L('5.回答选择框是否出现', document.getElementById('a-result').closest('div').style.display !== 'none');
    L('5.反馈格数量', count('#guess-fb .cyc'));
    L('5.反馈格键名', [].slice.call(document.querySelectorAll('#guess-fb .cyc')).map(function (c) { return c.dataset.key; }).join('|').slice(0, 60));
    var cyc = document.querySelector('#guess-fb .cyc');
    if (cyc) { cyc.click(); L('5.点一下变绿', cyc.textContent); }
    else L('5.反馈格', '拿不到');
    setVal('g-name', '氢');
    document.getElementById('btn-guess').click();
    L('5.手工录反馈后线索数', recs());

    /* ---- 6. 字段编辑器改规则 ---- */
    tab('data');
    var sel = document.querySelector('#field-body2 select[data-k=rule]');
    L('6.当前规则', sel.value);
    sel.value = 'exact';
    sel.dispatchEvent(new Event('change'));
    L('6.改成 exact 后无异常', count('#field-body2 tr') + ' 行');
    tab('play');
    L('6.改规则后候选', txt('cand-count'));

    /* ---- 7. 存档 ---- */
    L('7.存档键', Object.keys(localStorage).filter(function (k) { return k.indexOf('guessr') === 0; }).sort().join(','));
    L('7.数据集个数', JSON.parse(localStorage.getItem('guessr_datasets_v1') || '[]').length);
  } catch (e) {
    L('运行异常', (e && e.message) || String(e));
  }
  document.title = 'RESULT::' + log.join(' || ');
}, 600);
</script>
`;
html = html.replace('</body>', testScript + '</body>');
const out = path.join(__dirname, 'fw-test.html');
fs.writeFileSync(out, html);
console.log('生成 ' + out);
