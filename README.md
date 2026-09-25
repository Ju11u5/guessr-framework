# 弗一把 · 本地推理助手

给 CS 职业选手竞猜小游戏「[弗一把](https://shnlfriberg.online/)」（BLAST Counter-Strikle 的中文社区玩法）做的一个**本地推理板**：你在游戏里点，把看到的反馈录进来，它替你算还剩谁、下一步猜谁 / 问什么。

**它不是一个自动答题的脚本。** 整个工具不联网、不调用任何游戏接口、不绕过任何验证、不代替你提交任何东西 —— 纯粹的纸笔加强版。

> 非官方作品，与游戏作者无关。

## 它做什么

两种模式都支持：

| 模式 | 玩法 | 工具帮你算 |
| --- | --- | --- |
| 普通模式 | 8 次猜名，反馈有颜色 + 大小箭头 | 每次猜完剩余哪些人可能、下一个猜谁最划算 |
| 海龟汤 | 18 次属性提问，每次提问解锁一次猜名 | 下一个**该问哪个属性的哪个值**最划算 |

判定逻辑严格按官方公开规则实现：

- 绿 = 完全正确；灰 = 不匹配
- 黄 = 队伍命中答案的历史队伍 / 同赛区不同国家 / 年龄差 ≤ 3 / Major 数差 ≤ 1
- 箭头 = 答案的年龄或 Major 数比你所猜的更大还是更小

推荐算法是**最小化期望剩余人数**：对每个候选算一遍「如果猜他，各种反馈会把人分成几堆」，取分堆最均匀的那个。所以开局第一个猜测通常就能把几百人的池子切到个位数。

## 快速开始

### 方式一：直接用（推荐）

双击 `friberg-assistant.html` 就行。单文件、零依赖、离线可用。

### 方式二：打包成 exe

```bash
python app/build.py          # 需要 pip install pyinstaller
```

产物 `dist/弗一把助手.exe` 是一个约 7 MB 的单文件程序：双击后用系统里的 Chrome / Edge 以「应用模式」打开一个没有地址栏的独立窗口，数据存在程序旁边的 `profile/` 目录里，和你平时浏览器的数据完全隔离。

常用参数：

```bash
弗一把助手.exe --dry-run         # 只打印路径与实际启动命令，不启动（排查用）
弗一把助手.exe --shortcut        # 启动并在桌面建快捷方式
弗一把助手.exe --shortcut-only   # 只建快捷方式
弗一把助手.exe --print-dir       # 打印数据目录
```

## 选手数据从哪来

**本仓库不包含任何选手数据**（原因见下方「为什么数据不在仓库里」）。打开工具后候选池是空的，你有三条路补上：

1. **游戏内查选手页**：打开游戏的「查选手」页，把名字（或整行数据）复制下来，粘到「候选池」页的导入框里，选对列顺序即可。只导入昵称也能用 —— 属性会在你每次猜到他时自动补全。
2. **自己写一份 `players.js`**：放在 `friberg-assistant.html` 同目录，格式如下，页面会自动载入：

   ```js
   window.FRIBERG_DATA_EXT = {
     meta: { count: 1, source: '自己整理', generatedAt: '2026-01-01', baseYear: 2026 },
     raw: [
       // [昵称, 国家/地区, 赛区, 队伍, 出生年, 位置, Major冠军数, Major参赛数, 是否现役, 是否简单版]
       ['ZywOo', '法国', 'europe', 'Vitality', 2000, 'awper', 3, 11, 1, 1]
     ],
     officialRegion: { '法国': '欧洲' }   // 可选：国家 → 赛区，用来判断「同赛区」的黄色
   };
   ```

   赛区键名固定为：`europe` `cis` `asia` `oceania` `northAmerica` `southAmerica` `africaIsrael`。
   位置键名固定为：`rifler` `awper` `coach`。

3. **导出 / 导入存档**：工具里录过的选手会自动进池，随时可以用「候选池 → 导出 JSON」备份，换台机器再导入。

## 为什么数据不在仓库里

这份游戏/网页的源码是公开的（[shnlfriberg/csgofriberg](https://github.com/shnlfriberg/csgofriberg)），但它的许可证是 **AGPL-3.0** —— 一旦把来自它的编译数据放进本仓库再分发，整个仓库都得按 AGPL-3.0 走，连带源码公开等义务。

而且那份选手数据文件后来被作者**主动从版本控制里移除了**（`chore: stop tracking generated import files`），原始名单也一直在 `.gitignore` 里 —— 这个意图很清楚：不想让它作为项目文件被到处传。

所以本仓库只放代码。你要用内置数据库，自己按上面的方式准备数据源；如果你确实想基于上游数据分发，请遵守 AGPL-3.0，或者更稳妥地去问一下作者。

## 目录结构

```
friberg-assistant.html    工具本体（单文件，无数据）
players.js                选手数据（本地生成，不进仓库）
app/launcher.py           exe 启动器（纯标准库）
app/build.py              一键打包
app/make_icon.py          图标生成（纯标准库手写 PNG→ICO，不依赖 Pillow）
data/                     数据源与中间产物（不进仓库）
tests/                    
  engine.test.js          引擎断言（47~76 项，有数据时全跑）
  perf.test.js            推荐质量 + 快慢两条实现交叉验证（14 项）
  test-exe.py             exe 行为验证（15 项）
  make-ui-test.js         生成端到端测试页（无头 Chrome 跑）
  build-db.js             由数据源生成 players.js
```

## 开发

```bash
node tests/engine.test.js      # 引擎断言
node tests/perf.test.js        # 推荐质量与性能
node tests/make-ui-test.js     # 生成端到端测试页
# 然后用无头浏览器跑：chrome --headless=new --dump-dom tests/ui-test.html | grep RESULT::
python tests/test-exe.py       # 验证 exe（需要先 app/build.py）
```

改动 `friberg-assistant.html` 后重新打包 exe 即可，数据文件会被一起带上。

## 许可

代码本身以 **MIT** 协议发布（见 [LICENSE](LICENSE)）。

需要说明的是：玩法判定规则依据官方公开说明整理；工具不包含、也不分发上游项目的数据或代码。如果你要往仓库里加来自上游 AGPL 项目的内容，请先确认许可证兼容性。

## 免责

仅供个人学习与娱乐。多人模式请自己判断、别拿它做破坏对手体验的事；请勿把本工具改造成自动提交答案的脚本。
