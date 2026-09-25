# -*- coding: utf-8 -*-
"""本地竞猜工具 —— Windows 启动器（通用版）

同一个启动器可以打包出不同的小工具，靠包内的 app.json 清单描述：
    { "title": "...", "html": "xxx.html", "data": ["yyy.js"], "profile": "profile" }
没有清单时按默认（弗一把助手）走。

做的事（很薄，没有任何网络行为）：
  1. 把清单里的页面文件（以及可选的数据文件）释放到程序所在目录，内容一致就不重写
  2. 用 Chromium 内核浏览器的「应用模式」打开它 —— 没有地址栏/标签页，就是个独立窗口
  3. 用专属 profile 目录存数据，不碰你平时浏览器的任何东西，也不会被"清理浏览数据"波及

可用的命令行参数：
  --dry-run        只打印将要做什么，不启动浏览器（用来排查问题）
  --shortcut       启动后在桌面建一个快捷方式
  --shortcut-only  只建快捷方式，不启动
  --print-dir      只打印数据目录路径
"""
import ctypes
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APP_NAME = "FribergHelper"
PROFILE_DIR = "profile"

DEFAULT_MANIFEST = {
    "title": "弗一把 · 本地推理助手",
    "html": "friberg-assistant.html",
    "data": ["players.js"],
    "profile": "profile",
    "shortcut": "弗一把助手",
    "window": "1340,940",
}

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


def load_manifest():
    m = dict(DEFAULT_MANIFEST)
    found = bundled("app.json")
    if found:
        try:
            m.update(json.loads(found.read_text(encoding="utf-8")))
        except Exception:
            pass
    return m


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


def bundled_html(manifest) -> Path:
    found = bundled(manifest["html"])
    if found:
        return found
    # 清单写错时的兜底：包里有什么页面就用什么，别直接崩
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        htmls = sorted(Path(meipass).glob("*.html"))
        if htmls:
            log("⚠ 清单里的 %s 不在包里，改用 %s" % (manifest["html"], htmls[0].name))
            return htmls[0]
    raise FileNotFoundError("包里找不到页面文件（清单写的是 %s）" % manifest["html"])


def write_log(text):
    try:
        path = app_root() / "launcher-error.log"
        with open(path, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), text))
        return path
    except Exception:
        return None


def fatal(text, title="本地竞猜工具"):
    """有控制台/管道时直接报错退出；纯双击（无 stdout）才弹框 —— 弹框会阻塞，别在测试里弹"""
    write_log(text)
    if sys.stdout is None and sys.stderr is None:
        message_box(text + "\n\n详细信息已写入程序目录的 launcher-error.log", title)
    else:
        print(text, file=sys.stderr)
    return 1


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


def build_args(browser: Path, html: Path, profile: Path, manifest):
    url = html.as_uri()
    return [
        str(browser),
        "--app=%s" % url,
        "--user-data-dir=%s" % profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--disable-features=Translate,MediaRouter",
        "--window-size=%s" % manifest.get("window", "1340,940"),
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


def message_box(text, title="本地竞猜工具"):
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x40)
    except Exception:
        pass


def make_shortcut(manifest) -> Path:
    desktop = Path(os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"))
    if not desktop.exists():
        desktop = Path(os.environ.get("USERPROFILE", tempfile.gettempdir()))
    lnk = desktop / ((manifest.get("shortcut") or "小工具") + ".lnk")
    target = Path(sys.executable).resolve()
    ps = (
        "$w=New-Object -ComObject WScript.Shell;"
        "$s=$w.CreateShortcut('%s');"
        "$s.TargetPath='%s';"
        "$s.WorkingDirectory='%s';"
        "$s.IconLocation='%s,0';"
        "$s.Description='%s';"
        "$s.Save()" % (lnk, target, target.parent, target, manifest.get("title", ""))
    )
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return lnk


def main():
    argv = set(sys.argv[1:])
    manifest = load_manifest()
    root = app_root()
    html_path = root / manifest["html"]
    profile = root / manifest.get("profile", PROFILE_DIR)

    if "--print-dir" in argv:
        log(str(root))
        return 0

    src = bundled_html(manifest)
    state = sync_html(src, html_path)
    profile.mkdir(parents=True, exist_ok=True)

    data_lines = []
    for name in manifest.get("data", []):
        dsrc = bundled(name)
        if dsrc:
            dstate = sync_html(dsrc, root / name)
            data_lines.append("  %s (%s, %.1f KB)" % (name, dstate, (root / name).stat().st_size / 1024))
        else:
            data_lines.append("  %s（本版本未打包）" % name)

    browser = find_browser()
    plan = [
        "程序     : %s" % manifest.get("title", ""),
        "程序目录 : %s" % root,
        "页面文件 : %s (%s, %.1f KB)" % (html_path, state, html_path.stat().st_size / 1024),
        "附加数据 : %s" % ("；".join(data_lines) if data_lines else "无"),
        "数据目录 : %s" % profile,
        "浏览器   : %s" % (browser or "未找到 Chromium 内核，将用系统默认浏览器"),
    ]

    if browser:
        args = build_args(browser, html_path, profile, manifest)
        plan.append("启动命令 : %s" % " ".join('"%s"' % a if " " in a else a for a in args))
    else:
        plan.append("启动方式 : 系统默认浏览器打开 %s" % html_path)

    if "--dry-run" in argv:
        log("\n".join(plan))
        log("（dry-run：没有真的启动）")
        return 0

    try:
        if browser and "--shortcut-only" not in argv:
            spawn_detached(build_args(browser, html_path, profile, manifest))
        elif not browser and "--shortcut-only" not in argv:
            os.startfile(str(html_path))  # noqa: S606 - Windows 专用
        if "--shortcut" in argv or "--shortcut-only" in argv:
            lnk = make_shortcut(manifest)
            log("已创建桌面快捷方式：%s" % lnk)
    except Exception as exc:  # 不弹控制台，用消息框告诉用户
        message_box("启动失败：%s\n\n可以手动双击这个文件：\n%s" % (exc, html_path),
                    manifest.get("title", "小工具"))
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        import traceback
        sys.exit(fatal("启动器出错：\n" + traceback.format_exc(),
                       load_manifest().get("title", "本地竞猜工具")))
