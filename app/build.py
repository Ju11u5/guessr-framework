# -*- coding: utf-8 -*-
"""一键打包 exe（支持多个小工具，共用同一个启动器）。

用法（必须用装了 pyinstaller 的那个 python）：
    python app/build.py                 # 两个都打
    python app/build.py guessr          # 只打通用竞猜框架
    python app/build.py friberg         # 只打 CS 助手

产物：dist/猜一猜.exe、dist/弗一把助手.exe（各约 7 MB 单文件）
改完 HTML 后重跑一次即可，页面和数据会被一起打进 exe。
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# Windows 上控制台编码可能是 cp1252 / cp936，统一按 UTF-8 输出，避免中文把脚本打崩
for _stream in ("stdout", "stderr"):
    try:
        getattr(sys, _stream).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent

TARGETS = {
    'friberg': {
        'exe': '弗一把助手',
        'title': '弗一把 · 本地推理助手',
        'html': 'friberg-assistant.html',
        'data': ['players.js'],          # 可选：有就带上
        'shortcut': '弗一把助手',
        'window': '1340,940',
    },
    'guessr': {
        'exe': '猜一猜',
        'title': '猜一猜 · 通用竞猜框架',
        'html': 'guessr-framework.html',
        'data': [],
        'shortcut': '猜一猜',
        'window': '1360,960',
    },
}

VERSION_TEMPLATE = """VSVersionInfo(
  ffi=FixedFileInfo(filevers=(1, 0, 0, 0), prodvers=(1, 0, 0, 0), mask=0x3f, flags=0x0,
    OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([
      StringTable('080404B0', [
        StringStruct('CompanyName', '本地工具'),
        StringStruct('FileDescription', '{title}'),
        StringStruct('FileVersion', '1.0.0.0'),
        StringStruct('InternalName', '{internal}'),
        StringStruct('LegalCopyright', '仅供个人本地使用'),
        StringStruct('OriginalFilename', '{exe}.exe'),
        StringStruct('ProductName', '{title}'),
        StringStruct('ProductVersion', '1.0.0.0')
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [2052, 1200])])
  ]
)
"""


def step(args):
    print("$ " + " ".join(str(a) for a in args))
    subprocess.run([str(a) for a in args], cwd=str(ROOT), check=True)


def build(key):
    cfg = TARGETS[key]
    py = sys.executable
    build_dir = ROOT / 'build'
    build_dir.mkdir(exist_ok=True)

    html = ROOT / cfg['html']
    if not html.exists():
        print('✘ 找不到 %s' % html)
        return False

    # 清单：启动器靠它知道开哪个页面、带哪些数据
    # 注意：必须叫 app.json（打进包里就是这个文件名，启动器按这个名字找）
    manifest = {
        'title': cfg['title'],
        'html': cfg['html'],
        'data': cfg['data'],
        'profile': 'profile',
        'shortcut': cfg['shortcut'],
        'window': cfg['window'],
    }
    mf = build_dir / 'app.json'
    mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')

    vinfo = build_dir / ('version.%s.txt' % key)
    vinfo.write_text(VERSION_TEMPLATE.format(title=cfg['title'], exe=cfg['exe'],
                                             internal=''.join(x for x in cfg['exe'] if x.isascii()) or 'App'),
                     encoding='utf-8')

    add_data = ['%s%s.' % (mf, os.pathsep), '%s%s.' % (html, os.pathsep)]
    for name in cfg['data']:
        p = ROOT / name
        if p.exists():
            add_data.append('%s%s.' % (p, os.pathsep))
            print('· %s：带上 %s（%.1f KB）' % (cfg['exe'], name, p.stat().st_size / 1024))
        else:
            print('· %s：没有 %s，跳过' % (cfg['exe'], name))

    args = [py, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--noconsole',
            '--name', cfg['exe'],
            '--icon', ROOT / 'app' / 'icons' / 'app.ico',
            '--version-file', vinfo]
    for item in add_data:
        args += ['--add-data', item]
    args += ['--distpath', ROOT / 'dist', '--workpath', ROOT / 'build' / key,
             '--specpath', ROOT / 'build', ROOT / 'app' / 'launcher.py']
    print('\n=== 打包 %s ===' % cfg['title'])
    step(args)
    exe = ROOT / 'dist' / (cfg['exe'] + '.exe')
    print('✔ %s（%.1f MB）\n' % (exe, exe.stat().st_size / 1024 / 1024))
    return True


def main():
    step([sys.executable, 'app/make_icon.py'])
    keys = sys.argv[1:] or list(TARGETS.keys())
    for k in keys:
        if k not in TARGETS:
            print('未知目标：%s（可选 %s）' % (k, '/'.join(TARGETS)))
            return 1
        build(k)
    print('全部完成，成品在 dist/ 目录。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
