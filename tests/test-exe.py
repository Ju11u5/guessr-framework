# -*- coding: utf-8 -*-
"""验证 exe 的行为（不需要手点窗口），两个 exe 都测。

对每个 exe：
1. --dry-run：报告计划、释放页面、内容一致、识别浏览器
2. 同一 --user-data-dir + file:// 下 localStorage 跨进程持久化（决定数据会不会每次丢）
3. 真实启动一次：确认 Chrome 以应用模式带专属 profile 起来，且父进程退出后窗口仍活着；
   测试结束只杀掉命令行里带我们这个 profile 的进程
4. 再跑一次不重复释放页面；页面标题与产品名对得上

用法：python tests/test-exe.py [exe路径 ...]
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

# 每个 exe 的预期：页面文件、应带的附加数据、产品名
EXPECT = {
    '弗一把助手.exe': {'html': 'friberg-assistant.html', 'data': ['players.js'], 'title': '弗一把'},
    '猜一猜.exe': {'html': 'guessr-framework.html', 'data': [], 'title': '猜一猜'},
}

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


def run_exe(exe, args=(), timeout=180):
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
    if pids:
        ps("Stop-Process -Id %s -Force" % ",".join(pids))


def test_one(exe_path: Path):
    spec = EXPECT.get(exe_path.name, {})
    html_name = spec.get('html')
    print('\n================ %s ================' % exe_path.name)
    work = Path(tempfile.mkdtemp(prefix="exe-test-"))
    exe = work / exe_path.name
    shutil.copy2(exe_path, exe)
    pattern = work.name

    code, out, err = run_exe(exe, ["--dry-run"])
    check("退出码为 0", code == 0, "returncode=%s" % code)
    check("输出了计划文本", "程序目录" in out and "启动命令" in out)
    page = work / html_name if html_name else None
    check("释放了正确的页面文件（%s）" % html_name, bool(page and page.exists()))
    src = ROOT / html_name if html_name else None
    check("页面内容与源文件逐字节一致", bool(page and src and page.read_bytes() == src.read_bytes()))
    check("识别出 Chromium 浏览器", "chrome.exe" in out.lower() or "msedge" in out.lower())
    check("命令含应用模式与专属 profile", "--app=file:///" in out and "--user-data-dir=" in out)
    check("产品名正确", spec.get('title', '') in out, [l for l in out.splitlines() if l.startswith("程序")][:1].__str__())

    for name in spec.get('data', []):
        d = work / name
        dsrc = ROOT / name
        if dsrc.exists():
            check("释放了附加数据 %s" % name, d.exists() and d.read_bytes() == dsrc.read_bytes())
        else:
            check("未打包 %s 时报告清楚" % name, "未打包" in out)
    for name in [n for n in ('players.js',) if n not in spec.get('data', [])]:
        check("不该带的数据没有释放（%s）" % name, not (work / name).exists())

    profile = work / "profile-persist"
    w = work / "write.html"
    w.write_text("<!doctype html><meta charset=utf-8><script>localStorage.setItem('probe','ok-1')</script>",
                 encoding="utf-8")
    r = work / "read.html"
    r.write_text("<!doctype html><meta charset=utf-8><body><div id=r>x</div><script>"
                 "document.getElementById('r').textContent=String(localStorage.getItem('probe'))</script>",
                 encoding="utf-8")
    headless(profile, w.as_uri())
    dom = headless(profile, r.as_uri())
    check("localStorage 跨进程持久化", "ok-1" in dom)

    code, out, err = run_exe(exe)
    check("启动器正常退出", code == 0, "returncode=%s" % code)
    time.sleep(6)
    pids = chrome_pids(pattern, work)
    check("父进程退出后窗口仍然活着", len(pids) > 0, "进程数 %d" % len(pids))
    check("profile 里已有 Local Storage（页面真跑了）",
          (work / "profile" / "Default" / "Local Storage").exists())
    kill_pids(pids)
    time.sleep(2)
    check("测试进程已清理", len(chrome_pids(pattern, work)) == 0)

    before = page.stat().st_mtime_ns if page else 0
    time.sleep(0.05)
    code, out, err = run_exe(exe, ["--dry-run"])
    after = page.stat().st_mtime_ns if page else 0
    check("内容一致时不重写页面", before == after and before != 0)

    shutil.rmtree(work, ignore_errors=True)


def main():
    exes = [Path(p) for p in sys.argv[1:]]
    if not exes:
        exes = [ROOT / 'dist' / n for n in EXPECT]
    exes = [e for e in exes if e.exists()]
    if not exes:
        print('找不到 exe，先跑 python app/build.py')
        return 1
    for e in exes:
        test_one(e)
    bad = [x for x in results if not x[1]]
    print("\n通过 %d 项，失败 %d 项" % (len(results) - len(bad), len(bad)))
    for name, _, detail in bad:
        print("  失败：" + name + " " + detail)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
