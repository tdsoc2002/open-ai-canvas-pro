#!/bin/bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin"
case "${1:-}" in
    ""|--check) ;;
    *) echo '用法：scripts/start-local.sh [--check]' >&2; exit 2 ;;
esac
for command in python3 node go bun ssh psql redis-server redis-cli curl lsof; do
    command -v "$command" >/dev/null || { echo "缺少本机依赖：$command" >&2; exit 1; }
done
NODE_VERSION="$(node --version)"
[[ -f "$ROOT/web/node_modules/vite/package.json" ]] || { echo '缺少前端依赖，请先在 web 使用 bun install --frozen-lockfile。' >&2; exit 1; }
bun -e 'const pkg = await Bun.file(process.argv[1]).json(); if (!Bun.semver.satisfies(process.argv[2], pkg.engines.node)) { console.error(`当前 Node ${process.argv[2]} 不满足 Vite 要求 ${pkg.engines.node}；请先切换兼容版本。`); process.exit(1); }' "$ROOT/web/node_modules/vite/package.json" "$NODE_VERSION"
CONFIG="$ROOT/.local/config/ljcanvas-dev.env"
[[ -f "$CONFIG" ]] || { echo '缺少 .local/config/ljcanvas-dev.env；拒绝使用默认 SQLite。' >&2; exit 1; }
source "$CONFIG"
exec python3 - "$ROOT" "${1:-}" <<'PY'
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request
from urllib.parse import parse_qs, urlparse

root = Path(sys.argv[1])
cache = root / '.local/cache/ljcanvas-dev'

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def target_url(value):
    u = urlparse(value)
    require(not u.password and not u.fragment and parse_qs(u.query, keep_blank_values=True) == {'sslmode': ['disable'], 'application_name': ['ljcanvas-local-dev'], 'connect_timeout': ['10']}, '数据库 URL 含非预期连接参数，拒绝覆盖目标库')
    return (u.scheme, u.hostname, u.port, u.path, u.username)

def output(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()

def listener(port):
    p = subprocess.run(['lsof', '-nP', '-t', '-iTCP:' + str(port), '-sTCP:LISTEN'], capture_output=True, text=True)
    ids = set(p.stdout.split())
    require(len(ids) <= 1, f'{port} 存在多个监听进程，未处理已有进程')
    return int(next(iter(ids))) if ids else None

def process_env(pid):
    # 只在内存中检查必要字段，不打印或保存完整进程环境。
    raw = output(['ps', 'eww', '-p', str(pid), '-o', 'command='])
    return dict(re.findall(r'(?:^|\s)([A-Z_]+)=([^\s]*)', raw))

def verify_process(role, pid):
    record = cache / ('backend.pid' if role == 'backend' else 'frontend.pid')
    require(record.is_file(), f'{role} 端口已占用但没有本入口 PID 记录，未停止已有进程')
    owner = int(record.read_text().strip())
    env = process_env(pid)
    if role == 'backend':
        require(pid == owner and output(['ps', '-p', str(pid), '-o', 'comm=']) == str(cache / 'backend'), '8080 不是本项目已记录的开发后端')
        require(env.get('CANVAS_DATABASE_DRIVER') == 'postgres' and target_url(env.get('DATABASE_URL', '')) == expected_target, '8080 未连接指定开发库，拒绝复用')
        require(env.get('REDIS_URL') == expected_redis and env.get('CANVAS_BACKEND_DATA_DIR') == expected_data, '8080 的 Redis 或文件目录未隔离，拒绝复用')
        require(env.get('CANVAS_AUTO_MIGRATE') == 'false' and not env.get('YINGCE_AGENT_URL'), '8080 的迁移或 Agent 设置不符合本机约束')
    else:
        parent = int(output(['ps', '-p', str(pid), '-o', 'ppid=']))
        require(pid == owner or parent == owner, '3000 不是本入口记录的前端进程')
        cwd = output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn']).splitlines()
        require('n' + str(root / 'web') in cwd, '3000 不属于本项目 web 目录')
        require(env.get('VITE_API_PROXY_TARGET') == 'http://127.0.0.1:8080' and env.get('VITE_CANVAS_BACKEND_URL') == '/api', '3000 的前端代理不是指定开发后端')

def healthy(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health/ready', timeout=4) as r:
            value = json.load(r)
        data = value.get('data', {})
        return value.get('code') == 0 and data.get('ready') is True and all(data.get('checks', {}).get(k) is True for k in ('database', 'runtime', 'schema'))
    except (OSError, ValueError):
        return False

started = []
try:
    expected_target = ('postgresql', '127.0.0.1', 25432, '/LJCanvas-dev', 'ljcanvas_dev')
    expected_data = str(root / '.local/project-workbench-debug/ljcanvas-dev')
    expected_redis = 'unix://' + str(cache / 'redis.sock') + '?db=0'
    require(os.environ.get('CANVAS_DATABASE_DRIVER') == 'postgres', '配置不是 PostgreSQL；拒绝启动，不回退 SQLite')
    require(target_url(os.environ.get('DATABASE_URL', '')) == expected_target, 'DATABASE_URL 不是指定的 LJCanvas-dev 隧道连接')
    require(all(os.environ.get(k) == v for k, v in {'PGHOST': '127.0.0.1', 'PGPORT': '25432', 'PGDATABASE': 'LJCanvas-dev', 'PGUSER': 'ljcanvas_dev', 'CANVAS_BACKEND_ADDR': '127.0.0.1:8080', 'CANVAS_BACKEND_DATA_DIR': expected_data, 'CANVAS_AUTO_MIGRATE': 'false', 'REDIS_URL': expected_redis}.items()), '连接、数据目录、Redis 或迁移设置与隔离约束不符')
    require(not os.environ.get('YINGCE_AGENT_URL'), '本地开发不可复用远程 Agent')
    passfile = Path(os.environ.get('PGPASSFILE', ''))
    require(passfile.is_file() and passfile.stat().st_uid == os.getuid() and passfile.stat().st_mode & 0o777 == 0o600, '缺少私有 pgpass 或其权限不是 0600')
    for file in ('.local/ljcanvas-dev-db.sh', '.local/start-backend-ljcanvas-dev.sh', '.local/start-web-ljcanvas-dev.sh'):
        require(os.access(root / file, os.X_OK), f'缺少本机执行入口：{file}')
    require((root / 'web/node_modules/.bin/vite').exists(), '缺少前端依赖，请先在 web 使用 bun install --frozen-lockfile')
    if sys.argv[2] == '--check':
        print('配置校验通过：固定 LJCanvas-dev、独立本机 Redis；不会回退 SQLite。未启动或连接服务。')
        sys.exit(0)
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (cache / 'start.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('另一个一键启动正在进行，请等待它完成') from None
    # 先检查端口归属；不接管未知服务，也不自动杀进程。
    for role, port in (('backend', 8080), ('frontend', 3000)):
        pid = listener(port)
        if pid:
            verify_process(role, pid)
        else:
            record = cache / (role + '.pid')
            if record.exists():
                previous = record.read_text().strip()
                require(not previous.isdigit() or subprocess.run(['ps', '-p', previous], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0, f'{role} 已有未就绪的进程，请先查看日志，不重复启动')
    subprocess.run([str(root / '.local/ljcanvas-dev-db.sh')], check=True)
    for role, port in (('backend', 8080), ('frontend', 3000)):
        pid = listener(port)
        child = None
        if not pid:
            with (cache / (role + '.log')).open('ab', buffering=0) as log:
                child = subprocess.Popen([str(root / f'.local/start-{"backend" if role == "backend" else "web"}-ljcanvas-dev.sh')], cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            started.append(child)
            (cache / (role + '.pid')).write_text(str(child.pid) + '\n')
        deadline = time.monotonic() + 300
        while not healthy(port):
            require(not child or child.poll() is None, f'{role} 启动退出，请检查 .local/cache/ljcanvas-dev/{role}.log')
            require(time.monotonic() < deadline, f'{role} 就绪超时，请检查日志；未触碰已有服务')
            time.sleep(1)
        verify_process(role, listener(port))
        print(f'{role} 已就绪' + ('（复用已有开发进程）' if child is None else '（本次启动）'), flush=True)
    print('前端：http://127.0.0.1:3000\n后端：http://127.0.0.1:8080\n数据库：LJCanvas-dev（SSH 隧道）\n日志：.local/cache/ljcanvas-dev/{backend,frontend}.log\n未修改服务器配置，未重启服务器服务。')
except (Exception, KeyboardInterrupt) as error:
    # 仅回收本次新建且仍存活的进程组，不终止复用进程或未知服务。
    for child in reversed(started):
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    print('启动失败：' + str(error), file=sys.stderr)
    sys.exit(1)
PY
