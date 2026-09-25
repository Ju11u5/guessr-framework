# -*- coding: utf-8 -*-
"""弗一把 · 本地推理助手 —— Windows 启动器

做的事（很薄，没有任何网络行为）：
  1. 把内置的 friberg-assistant.html（以及可选的 players.js 选手数据）释放到程序所在目录，
     内容一致就不重写
  2. 用 Chromium 内核浏览器的「应用模式」打开它 —— 没有地址栏/标签页，就是个独立窗口
  3. 用专属 profile 目录存数据，不碰你平时浏览器的任何东西，也不会被"清理浏览数据"波及

可用的命令行参数：
  --dry-run        只打印将要做什么，不启动浏览器（用来排查问题）
  --shortcut       启动后在桌面建一个快捷方式
  --shortcut-only  只建快捷方式，不启动
  --print-dir      只打印数据目录路径
"""
import ctypes
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APP_NAME = "FribergHelper"
HTML_NAME = "friberg-assistant.html"
DATA_NAME = "players.js"          # 选手数据，可选：仓库版没有，打包版才带
PROFILE_DIR = "profile"
WINDOW_TITLE = "弗一把 · 本地推理助手"
WINDOW_SIZE = "1340,940"

BROWSER_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe",
]


def log(msg):
    print(msg)


def is_writable(folder: Path) -> bool:
    try:
        probe = folder / ".write-probe.tmp"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except Exception:
        return False


def app_root() -> Path:
    """便携优先：exe 所在目录可写就用它，否则退回 %LOCALAPPDATA%"""
    exe_dir = Path(sys.executable).resolve().parent
    if is_writable(exe_dir):
        return exe_dir
    fallback = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / APP_NAME
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def bundled(name: str):
    """打包后从 _MEIPASS 取；直接跑 .py 时取同目录。找不到返回 None"""
    meipass = getattr(sys, "_MEIPASS", None)
    candidates = []
    if meipass:
        candidates.append(Path(meipass) / name)
    here = Path(__file__).resolve().parent
    candidates += [here / name, here.parent / name,
                   Path(sys.executable).resolve().parent / name]
    for c in candidates:
        if c.exists():
            return c
    return None


def bundled_html() -> Path:
    found = bundled(HTML_NAME)
    if not found:
        raise FileNotFoundError("找不到内置的 %s" % HTML_NAME)
    return found


def sync_html(src: Path, dest: Path):
    """返回 'created' / 'updated' / 'same'"""
    data = src.read_bytes()
    if dest.exists():
        try:
            if dest.read_bytes() == data:
                return "same"
        except Exception:
            pass
        dest.write_bytes(data)
        return "updated"
    dest.write_bytes(data)
    return "created"


def find_browser():
    for raw in BROWSER_CANDIDATES:
        p = Path(os.path.expandvars(raw))
        if p.exists():
            return p
    for name in ("chrome.exe", "msedge.exe", "brave.exe", "chromium.exe"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def build_args(browser: Path, html: Path, profile: Path):
    url = html.as_uri()
    return [
        str(browser),
        "--app=%s" % url,
        "--user-data-dir=%s" % profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--disable-features=Translate,MediaRouter",
        "--window-size=%s" % WINDOW_SIZE,
    ]


# 让浏览器完全脱离本进程：不共享控制台/管道，父进程退出也不会把它带走
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


def spawn_detached(args):
    devnull = open(os.devnull, "wb")
    try:
        return subprocess.Popen(
            args,
            stdin=devnull,
            stdout=devnull,
            stderr=devnull,
            close_fds=True,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        )
    finally:
        devnull.close()


def message_box(text, title=WINDOW_TITLE):
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x40)
    except Exception:
        pass


def make_shortcut() -> Path:
    desktop = Path(os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"))
    if not desktop.exists():
        desktop = Path(os.environ.get("USERPROFILE", tempfile.gettempdir()))
    lnk = desktop / "弗一把助手.lnk"
    target = Path(sys.executable).resolve()
    ps = (
        "$w=New-Object -ComObject WScript.Shell;"
        "$s=$w.CreateShortcut('%s');"
        "$s.TargetPath='%s';"
        "$s.WorkingDirectory='%s';"
        "$s.IconLocation='%s,0';"
        "$s.Description='弗一把 · 本地推理助手';"
        "$s.Save()" % (lnk, target, target.parent, target)
    )
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return lnk


def main():
    argv = set(sys.argv[1:])
    root = app_root()
    html_path = root / HTML_NAME
    profile = root / PROFILE_DIR

    if "--print-dir" in argv:
        log(str(root))
        return 0

    src = bundled_html()
    state = sync_html(src, html_path)
    profile.mkdir(parents=True, exist_ok=True)

    data_src = bundled(DATA_NAME)
    data_state = sync_html(data_src, root / DATA_NAME) if data_src else "missing"

    browser = find_browser()
    plan = [
        "程序目录 : %s" % root,
        "页面文件 : %s (%s, %.1f KB)" % (html_path, state, html_path.stat().st_size / 1024),
        "选手数据 : %s" % (("%s (%s, %.1f KB)" % (root / DATA_NAME, data_state, (root / DATA_NAME).stat().st_size / 1024))
                          if data_src else "无（本版本未打包数据，可在程序里导入存档）"),
        "数据目录 : %s" % profile,
        "浏览器   : %s" % (browser or "未找到 Chromium 内核，将用系统默认浏览器"),
    ]

    if browser:
        args = build_args(browser, html_path, profile)
        plan.append("启动命令 : %s" % " ".join('"%s"' % a if " " in a else a for a in args))
    else:
        plan.append("启动方式 : 系统默认浏览器打开 %s" % html_path)

    if "--dry-run" in argv:
        log("\n".join(plan))
        log("（dry-run：没有真的启动）")
        return 0

    try:
        if browser and "--shortcut-only" not in argv:
            spawn_detached(build_args(browser, html_path, profile))
        elif not browser and "--shortcut-only" not in argv:
            os.startfile(str(html_path))  # noqa: S606 - Windows 专用
        if "--shortcut" in argv or "--shortcut-only" in argv:
            lnk = make_shortcut()
            log("已创建桌面快捷方式：%s" % lnk)
    except Exception as exc:  # 不弹控制台，用消息框告诉用户
        message_box("启动失败：%s\n\n可以手动双击这个文件：\n%s" % (exc, html_path))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
