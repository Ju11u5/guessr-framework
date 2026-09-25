# -*- coding: utf-8 -*-
"""一键重新打包 exe。

用法（必须用装了 pyinstaller 的那个 python）：
    C:\\Users\\wang\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe app/build.py

产物：dist/弗一把助手.exe（单文件，约十几 MB）
改完 friberg-assistant.html 后重跑一次即可，HTML 会被打进 exe 里。
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXE_NAME = "弗一把助手"


def step(args):
    print("$ " + " ".join(str(a) for a in args))
    subprocess.run([str(a) for a in args], cwd=str(ROOT), check=True)


def main():
    py = sys.executable
    step([py, "app/make_icon.py"])
    # 注意：--add-data / --icon / --version-file 的路径都按 spec 所在目录解析，
    # 所以这里一律用绝对路径，免得写到 build/ 里去找。
    html = ROOT / "friberg-assistant.html"
    icon = ROOT / "app" / "icons" / "app.ico"
    vinfo = ROOT / "app" / "version_info.txt"
    script = ROOT / "app" / "launcher.py"
    players = ROOT / "players.js"          # 选手数据，可选（仓库里不打包）
    add_data = ["%s%s." % (html, os.pathsep)]
    if players.exists():
        add_data += ["%s%s." % (players, os.pathsep)]
        print("· 带上选手数据 players.js（%.1f KB）" % (players.stat().st_size / 1024))
    else:
        print("· 没有 players.js，exe 将以空候选池启动（可在程序里导入存档）")

    args = [py, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--noconsole",
            "--name", EXE_NAME,
            "--icon", icon,
            "--version-file", vinfo]
    for item in add_data:
        args += ["--add-data", item]
    args += ["--distpath", ROOT / "dist", "--workpath", ROOT / "build",
             "--specpath", ROOT / "build", script]
    step(args)
    exe = ROOT / "dist" / (EXE_NAME + ".exe")
    print("\n完成：%s（%.1f MB）" % (exe, exe.stat().st_size / 1024 / 1024))


if __name__ == "__main__":
    main()
