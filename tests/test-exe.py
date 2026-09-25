# -*- coding: utf-8 -*-
"""验证 exe 的行为（不需要手点窗口）。

1. --dry-run：是否自解释地报告计划，页面是否被释放且内容一致
2. 同一 --user-data-dir + file:// 下 localStorage 能否跨进程持久化
   （决定「数据会不会每次丢」）
3. 真实启动一次：确认 Chrome 以应用模式带专属 profile 起来，且父进程退出后
   窗口仍然活着；测试结束只杀掉命令行里带我们这个 profile 的进程
4. 再次运行不重复释放页面（内容一致就跳过）

用法：python tests/test-exe.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / "dist" / "弗一把助手.exe"
HTML_SRC = ROOT / "friberg-assistant.html"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("  ✔ " if ok else "  ✘ ") + name + (("  → " + detail) if detail else ""))


def decode(raw):
    if raw is None:
        return ""
    for enc in ("utf-8", "gbk", "cp936"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def run_exe(exe, args=(), timeout=150):
    r = subprocess.run([str(exe)] + list(args), capture_output=True, timeout=timeout)
    return r.returncode, decode(r.stdout), decode(r.stderr)


def headless(profile, url):
    cmd = [str(CHROME), "--headless=new", "--disable-gpu", "--no-sandbox",
           "--user-data-dir=%s" % profile, "--virtual-time-budget=4000", "--dump-dom", url]
    return decode(subprocess.run(cmd, capture_output=True, timeout=90).stdout)


def ps(script, timeout=60):
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                          capture_output=True, timeout=timeout)


def chrome_pids(pattern, work):
    out_file = work / "pids.txt"
    if out_file.exists():
        out_file.unlink()
    ps("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
       "Where-Object { $_.CommandLine -like '*%s*' } | ForEach-Object { $_.ProcessId } | "
       "Out-File -Encoding ascii '%s'" % (pattern, out_file))
    if not out_file.exists():
        return []
    return [l.strip() for l in out_file.read_text(errors="replace").splitlines() if l.strip().isdigit()]


def kill_pids(pids):
    if not pids:
        return
    ps("Stop-Process -Id %s -Force" % ",".join(pids))


def main():
    if not EXE.exists():
        print("找不到 exe：%s" % EXE)
        return 1
    work = Path(tempfile.mkdtemp(prefix="friberg-exe-test-"))
    print("临时目录：%s\n" % work)
    exe = work / EXE.name
    shutil.copy2(EXE, exe)
    pattern = work.name       # 用临时目录名匹配命令行，确保只碰我们自己的进程

    print("[1] --dry-run 自检")
    code, out, err = run_exe(exe, ["--dry-run"])
    check("退出码为 0", code == 0, "returncode=%s" % code)
    check("输出了计划文本", "程序目录" in out and "启动命令" in out,
          [l for l in out.splitlines() if "浏览器" in l][:1].__str__())
    page = work / "friberg-assistant.html"
    check("释放了页面文件", page.exists())
    check("内容与源文件逐字节一致", page.exists() and page.read_bytes() == HTML_SRC.read_bytes())
    data = work / "players.js"
    data_src = ROOT / "players.js"
    if data_src.exists():
        check("释放了选手数据 players.js", data.exists() and data.read_bytes() == data_src.read_bytes())
    else:
        check("未打包数据时报告 missing", "选手数据" in out, [l for l in out.splitlines() if "选手数据" in l][:1].__str__())
    check("识别出 Chromium 浏览器", "chrome.exe" in out.lower() or "msedge" in out.lower())
    check("命令含应用模式与专属 profile", "--app=file:///" in out and "--user-data-dir=" in out)

    print("\n[2] 同一 profile + file:// 的 localStorage 持久化")
    profile = work / "profile-persist"
    w = work / "write.html"
    w.write_text("<!doctype html><meta charset=utf-8><script>"
                 "localStorage.setItem('probe','hello-12345')</script>ok", encoding="utf-8")
    r = work / "read.html"
    r.write_text("<!doctype html><meta charset=utf-8><body><div id=r>none</div>"
                 "<script>document.getElementById('r').textContent=String(localStorage.getItem('probe'))"
                 "</script>", encoding="utf-8")
    headless(profile, w.as_uri())
    dom = headless(profile, r.as_uri())
    check("第二次进程读到第一次写入的值", "hello-12345" in dom,
          "有" if "hello-12345" in dom else "没有")

    print("\n[3] 真实启动（应用模式）")
    code, out, err = run_exe(exe)
    check("启动器正常退出", code == 0, "returncode=%s" % code)
    time.sleep(6)
    pids = chrome_pids(pattern, work)
    check("父进程退出后 Chrome 窗口仍然活着", len(pids) > 0, "进程数 %d" % len(pids))
    ls_dir = work / "profile" / "Default" / "Local Storage"
    check("profile 里已有 Local Storage（说明页面真的跑了）", ls_dir.exists())
    check("页面文件就在程序旁边（便携布局）", page.exists() and page.parent == work)
    kill_pids(pids)
    time.sleep(2)
    check("测试进程已清理", len(chrome_pids(pattern, work)) == 0)

    print("\n[4] 重复运行不重写页面")
    before = page.stat().st_mtime_ns
    time.sleep(0.05)
    code, out, err = run_exe(exe, ["--dry-run"])
    after = page.stat().st_mtime_ns
    check("内容一致时不重写页面文件", before == after)
    check("报告状态为 same", "(same," in out or "same," in out.replace("（", "("),
          [l for l in out.splitlines() if "页面文件" in l][:1].__str__())

    shutil.rmtree(work, ignore_errors=True)
    bad = [x for x in results if not x[1]]
    print("\n通过 %d 项，失败 %d 项" % (len(results) - len(bad), len(bad)))
    for name, _, detail in bad:
        print("  失败：" + name + " " + detail)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
