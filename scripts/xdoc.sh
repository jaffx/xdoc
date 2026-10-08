#!/usr/bin/env bash
#
# xdoc 服务管理脚本：后台启动 / 停止 / 重启 / 状态 / 日志。
#
# 与直接 `node dist/cli.js` 的区别：
#   1. 后台运行，日志与 PID 落在 <repo>/.run/ 下（按端口区分，可挂多个实例），
#      终端关掉也不受影响
#   2. 端口固定（默认 1998）——显式传 -p 时 xdoc 不会自增端口，
#      被占用直接报错，避免"以为在 1998，实际飘到 1999"这种问题
#   3. 启动后做健康检查，确认真的起来了才返回成功
#
# <root>/config.json 里的 token / host / port / cert / key 同样生效：
# 脚本按「命令行 > 环境变量 > config.json > 默认值」解析出最终配置再启动，
# 因此 PID 文件名、健康检查的地址与协议都和实际监听的保持一致。
#
# 用法：scripts/xdoc.sh <命令> [选项]
# 走 npm 时注意用 -- 分隔，否则 npm 会吞掉 -p 之类的选项：
#   npm run service -- start -p 3000

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$REPO_DIR/dist/cli.js"
RUN_DIR="$REPO_DIR/.run"

PORT="${XDOC_PORT:-}"
HOST="${XDOC_HOST:-}"
ROOT_DIR=""
# 命令行 / 环境变量显式给的令牌。来自 config.json 的另算——
# 那种情况下不往命令行上传，免得令牌出现在 ps 的输出里
TOKEN_ARG=""
CERT=""
KEY=""
OPEN_BROWSER=0
FOREGROUND=0

# ---------- 输出 ----------

info() { printf '%s\n' "$*"; }
step() { printf '\033[2m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
xdoc 服务管理

用法：
  scripts/xdoc.sh <命令> [选项]
  npm run service -- <命令> [选项]        # 注意 --，否则 npm 会吞掉 -p 等选项

命令：
  start      后台启动（已在运行则直接报告）
  stop       停止
  restart    重启
  status     查看运行状态
  logs       跟踪日志（Ctrl+C 退出）

选项：
  -p, --port <端口>    监听端口，同时决定操作哪个实例（默认 1998，可用 XDOC_PORT 覆盖）
  -H, --host <地址>    监听地址（默认 127.0.0.1）
  -r, --root <路径>    数据根目录（默认 ~/.xdoc，可用 XDOC_ROOT 覆盖）
      --token <令牌>   访问令牌（也可用 XDOC_TOKEN；不设则读 config.json）
      --cert <路径>    TLS 证书（PEM），与 --key 一起用则提供 https
      --key <路径>     TLS 私钥（PEM）
      --open           启动后自动打开浏览器（后台运行时一般不需要）
  -f, --foreground     前台运行，日志直接打到终端
  -h, --help           显示帮助

令牌、监听地址、证书都可以写在 <数据根目录>/config.json 里，不用每次带选项：
  { "host": "0.0.0.0", "token": "自己定一个足够长的随机串" }
EOF
}

# ---------- 基础检查 ----------

NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "找不到 node，请先安装 Node.js（>= 18.17）"

# ---------- 配置解析 ----------

# 与 CLI 的 resolveRoot 一致：-r > XDOC_ROOT > ~/.xdoc
resolve_root() {
  if [ -n "$ROOT_DIR" ]; then printf '%s' "$ROOT_DIR"; return; fi
  if [ -n "${XDOC_ROOT:-}" ]; then printf '%s' "$XDOC_ROOT"; return; fi
  printf '%s/.xdoc' "$HOME"
}

# 读 <root>/config.json，按行输出：令牌 / 证书 / 私钥 / host / port。
# 一行一项而不是 tab 分隔——空字段在 tab 分隔下会被 IFS 的空白折叠规则吃掉，
# 后面的字段就整体错位了
read_settings() {
  "$NODE" -e '
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const root = process.argv[1];
    const out = ["", "", "", "", ""];
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
      const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
      const abs = (v) => {
        const s = str(v);
        return s ? path.resolve(root, s.replace(/^~(?=\/|$)/, os.homedir())) : "";
      };
      out[0] = str(raw.token);
      out[1] = abs(raw.cert);
      out[2] = abs(raw.key);
      out[3] = str(raw.host);
      out[4] = Number.isInteger(raw.port) && raw.port > 0 ? String(raw.port) : "";
    } catch {
      // 文件不存在或读不动都按"没配"处理，真正的报错交给 CLI
    }
    process.stdout.write(out.join("\n"));
  ' "$(resolve_root)"
}

apply_settings() {
  local -a cfg=()
  mapfile -t cfg < <(read_settings)

  # 命令行 / 环境变量 > config.json > 默认值
  TOKEN_EXPLICIT=0
  { [ -n "$TOKEN_ARG" ] || [ -n "${XDOC_TOKEN:-}" ]; } && TOKEN_EXPLICIT=1
  TOKEN="${TOKEN_ARG:-${XDOC_TOKEN:-${cfg[0]:-}}}"
  [ -n "$CERT" ] || CERT="${cfg[1]:-}"
  [ -n "$KEY" ] || KEY="${cfg[2]:-}"
  PORT="${PORT:-${cfg[4]:-1998}}"
  HOST="${HOST:-${cfg[3]:-127.0.0.1}}"
}

# ---------- 健康检查 ----------

probe_host() {
  # 监听 0.0.0.0 时不能用它去连，换成回环地址探测
  [ "$HOST" = "0.0.0.0" ] && printf '127.0.0.1' || printf '%s' "$HOST"
}

scheme() { [ -n "$CERT" ] && [ -n "$KEY" ] && printf 'https' || printf 'http'; }

base_url() { printf '%s://%s:%s' "$(scheme)" "$(probe_host)" "$PORT"; }

health_ok() {
  command -v curl >/dev/null 2>&1 || return 0
  # 开了令牌时健康检查也得带令牌，否则永远 401。
  # https 加 -k：证书可能是自签的，而这里只探本机存活，不用于对外校验
  local -a args=(-fsS -m 2 -o /dev/null)
  [ "$(scheme)" = "https" ] && args+=(-k)
  [ -n "$TOKEN" ] && args+=(-H "Authorization: Bearer $TOKEN")
  curl "${args[@]}" "$(base_url)/api/spaces" 2>/dev/null
}

# 进程是否存活
pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# 确认 PID 属于本项目的 xdoc，避免 PID 复用后误杀别的进程
pid_is_xdoc() {
  local pid="$1" cmdline=""
  [ -r "/proc/$pid/cmdline" ] || return 0   # 非 Linux 或读不到时不深究
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  case "$cmdline" in
    *dist/cli.js*) return 0 ;;
    *) return 1 ;;
  esac
}

read_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  pid_alive "$pid" && printf '%s' "$pid"
}

# 端口是否空闲（能监听上就是空闲），用 node 探测，不依赖 ss/netstat
port_free() {
  "$NODE" -e '
    const net = require("net");
    const s = net.createServer();
    s.once("error", () => process.exit(1));          // 被占用或其他错误
    s.once("listening", () => s.close(() => process.exit(0)));
    s.listen(Number(process.argv[1]), process.argv[2] || "127.0.0.1");
  ' "$PORT" "$(probe_host)" >/dev/null 2>&1
}

# 尽力查出占用端口的进程，用于报错提示
port_holder() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -lntp 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p {print $0}' | head -1
}

ensure_build() {
  [ -f "$CLI" ] || {
    step "未找到 $CLI，先执行构建…"
    (cd "$REPO_DIR" && "$NODE" scripts/build.mjs) || die "构建失败"
  }
  # 源码比产物新时提醒，但不擅自重建（避免拖慢启动）
  if [ -n "$(find "$REPO_DIR/src" -newer "$CLI" -name '*.ts' -print -quit 2>/dev/null)" ]; then
    warn "提示：src/ 下有比 dist/ 更新的文件，改动可能未生效。需要时执行 npm run build"
  fi
}

# ---------- 命令 ----------

cmd_start() {
  ensure_build

  local pid
  if pid="$(read_pid)"; then
    if health_ok; then
      info "xdoc 已在运行（PID $pid）-> $(base_url)"
      return 0
    fi
    warn "进程 $pid 还在，但健康检查失败，可能正在启动或已异常；可先执行 stop"
    return 1
  fi
  rm -f "$PID_FILE"

  if ! port_free; then
    local holder
    holder="$(port_holder || true)"
    die "端口 $PORT 已被占用，未启动。
$( [ -n "$holder" ] && printf '  占用者：%s\n' "$holder" )
  换端口：scripts/xdoc.sh start -p 1999"
  fi

  mkdir -p "$RUN_DIR"
  local -a args=(--host "$HOST" -p "$PORT")
  [ -n "$ROOT_DIR" ] && args+=(--root "$ROOT_DIR")
  # 显式指定的令牌才往命令行上传；config.json 里的那份由 CLI 自己读，
  # 免得令牌出现在 ps 里
  [ "$TOKEN_EXPLICIT" -eq 1 ] && [ -n "$TOKEN" ] && args+=(--token "$TOKEN")
  [ -n "$CERT" ] && args+=(--cert "$CERT")
  [ -n "$KEY" ] && args+=(--key "$KEY")
  [ "$OPEN_BROWSER" -eq 1 ] && args+=(--open) || args+=(--no-open)

  if [ "$FOREGROUND" -eq 1 ]; then
    exec "$NODE" "$CLI" "${args[@]}"
  fi

  step "启动中…"
  nohup "$NODE" "$CLI" "${args[@]}" >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  printf '%s' "$new_pid" > "$PID_FILE"

  # 等服务真正可用，最多 10 秒。
  # 先确认进程还活着再看健康检查——否则端口上若恰好有别的服务在应答，
  # 会误判成"启动成功"，而实际上我们自己这个进程已经退出了。
  local i
  for i in $(seq 1 50); do
    if ! pid_alive "$new_pid"; then
      rm -f "$PID_FILE"
      warn "启动失败，日志末尾："
      tail -n 15 "$LOG_FILE" >&2 || true
      return 1
    fi
    if health_ok; then
      info "xdoc 已启动（PID $new_pid）-> $(base_url)"
      info "日志：$LOG_FILE"
      return 0
    fi
    sleep 0.2
  done

  warn "已启动（PID $new_pid）但 10 秒内未通过健康检查，请查看日志：$LOG_FILE"
  return 1
}

cmd_stop() {
  local pid
  if ! pid="$(read_pid)"; then
    rm -f "$PID_FILE"
    info "xdoc 未在运行"
    return 0
  fi

  if ! pid_is_xdoc "$pid"; then
    warn "PID $pid 不属于 xdoc（可能已被复用），不执行 kill，仅清理 PID 文件"
    rm -f "$PID_FILE"
    return 0
  fi

  step "停止进程 $pid…"
  kill "$pid" 2>/dev/null || true

  local i
  for i in $(seq 1 50); do
    pid_alive "$pid" || { rm -f "$PID_FILE"; info "已停止"; return 0; }
    sleep 0.2
  done

  warn "进程未响应 TERM，强制结束"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  info "已强制停止"
}

cmd_status() {
  local pid
  if ! pid="$(read_pid)"; then
    rm -f "$PID_FILE" 2>/dev/null || true
    info "状态：未运行"
    return 1
  fi

  local uptime
  uptime="$(ps -o etime= -p "$pid" 2>/dev/null | tr -d ' ' || true)"

  info "状态：运行中"
  info "  PID    ：$pid"
  info "  运行时长：${uptime:-未知}"
  info "  端口   ：$PORT（$HOST）"

  if health_ok; then
    info "  地址   ：$(base_url)"
    info "  健康检查：通过"
    return 0
  fi

  info "  健康检查：失败（进程在但接口无响应）"
  return 1
}

cmd_logs() {
  [ -f "$LOG_FILE" ] || die "还没有日志：$LOG_FILE"
  info "跟踪 $LOG_FILE（Ctrl+C 退出）"
  tail -n 50 -f "$LOG_FILE"
}

cmd_restart() {
  cmd_stop
  cmd_start
}

# ---------- 参数解析 ----------

cmd="${1:-}"
[ -n "$cmd" ] && shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port) PORT="${2:-}"; shift 2 ;;
    -H|--host) HOST="${2:-}"; shift 2 ;;
    -r|--root) ROOT_DIR="${2:-}"; shift 2 ;;
    --token) TOKEN_ARG="${2:-}"; shift 2 ;;
    --cert) CERT="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --open) OPEN_BROWSER=1; shift ;;
    -f|--foreground) FOREGROUND=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（用 -h 查看帮助）" ;;
  esac
done

# 定下最终配置：后面的 PID 文件名、健康检查地址都要跟实际监听的一致
apply_settings

case "$PORT" in
  ''|*[!0-9]*) [ -n "$PORT" ] && die "端口非法：$PORT" ;;
esac

if { [ -n "$CERT" ] && [ -z "$KEY" ]; } || { [ -z "$CERT" ] && [ -n "$KEY" ]; }; then
  die "cert 与 key 必须同时提供（--cert/--key 或 config.json 里的 cert/key）。"
fi

# PID 与日志按端口区分，因此可以同时挂多个实例（-p 决定操作哪一个）
PID_FILE="$RUN_DIR/xdoc-$PORT.pid"
LOG_FILE="$RUN_DIR/xdoc-$PORT.log"

case "$cmd" in
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  ''|-h|--help|help) usage ;;
  *)         usage; die "未知命令：$cmd" ;;
esac
