#!/usr/bin/env bash
#
# 本地一条命令，把 xdoc 部署到远程服务器并启动。
#
#   scripts/deploy.sh root@1.2.3.4
#
# 流程：ssh 上去 → 没有代码就 clone（仓库是公开的，服务器上无需配 GitHub 密钥）、
# 有了就 git pull → scripts/init.sh --start → 从日志里取回访问令牌 →
# 打印访问地址、MCP 端点和 Agent 配置。
#
# 装 Node、装依赖、构建全在服务器上做，本地唯一的前提是 ssh 能免密登录。
# 监听地址与令牌由服务器上自动生成的 <root>/config.json 决定（0.0.0.0 + 随机
# 令牌），所以默认不用带任何参数就是对外的。
#
# 用法：scripts/deploy.sh <user@host> [选项] [-- <init.sh 的额外参数>]

set -euo pipefail

TARGET=""
PORT="${XDOC_PORT:-1998}"
SSH_PORT=22
DIR="~/xdoc"
REPO="https://github.com/jaffx/xdoc.git"
ADDR=""
TOKEN=""
NO_START=0
DRY_RUN=0
PASSTHRU=""

# ---------- 输出 ----------

info() { printf '%s\n' "$*"; }
step() { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
xdoc 远程部署（在本地跑，装到服务器上）

用法：
  scripts/deploy.sh <user@host> [选项]

选项：
  -p, --port <端口>       监听端口，默认 1998
      --ssh-port <端口>   ssh 端口，默认 22
  -d, --dir <路径>        服务器上的代码目录，默认 ~/xdoc
  -t, --token <令牌>      指定令牌；不指定就用 config.json 里自动生成的那份
      --host <地址>       访问地址里用的主机，默认取 user@host 里的 host
      --repo <url>        覆盖仓库地址
      --no-start          只同步代码并构建，不启动服务
      --dry-run           只打印将在服务器上执行的脚本，不做任何事
  -h, --help              显示帮助
  -- <参数…>              原样转给服务器上的 scripts/init.sh（如 --swap 2048）

示例：
  scripts/deploy.sh root@1.2.3.4
  scripts/deploy.sh root@1.2.3.4 -p 8080 -t mytoken
  scripts/deploy.sh ubuntu@1.2.3.4 --dir '~/code/xdoc' -- --prefix '~/.local' --swap 2048

端口要能被外面访问到，还得放行防火墙 / 云厂商安全组，见 README「远程部署」。
EOF
}

# ---------- 参数 ----------

while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port)      PORT="${2:-}"; shift 2 ;;
    --ssh-port)     SSH_PORT="${2:-}"; shift 2 ;;
    -d|--dir)       DIR="${2:-}"; shift 2 ;;
    -t|--token)     TOKEN="${2:-}"; shift 2 ;;
    --host)         ADDR="${2:-}"; shift 2 ;;
    --repo)         REPO="${2:-}"; shift 2 ;;
    --no-start)     NO_START=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --)             shift; PASSTHRU="$*"; break ;;
    -h|--help)      usage; exit 0 ;;
    -*)             usage; die "未知参数：$1" ;;
    *)              [ -n "$TARGET" ] && die "只能指定一个 user@host（收到：$TARGET 和 $1）"
                    TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || { usage; die "缺少目标服务器，例如：scripts/deploy.sh root@1.2.3.4"; }
case "$PORT" in ''|*[!0-9]*) die "端口非法：$PORT" ;; esac
case "$SSH_PORT" in ''|*[!0-9]*) die "--ssh-port 非法：$SSH_PORT" ;; esac

# user@host 里没给 --host 时，拿 host 部分当访问地址（ssh config 里的别名可能
# 解析不了，那种情况就自己 --host 指定公网 IP）
[ -n "$ADDR" ] || ADDR="${TARGET##*@}"
case "$ADDR" in
  \[*\]*) : ;;                      # IPv6 的方括号 URL 里本来就要带着，原样留
  *)      ADDR="${ADDR%%:*}" ;;     # host:port 去掉端口
esac

# ~ 交给远程 shell 展开：本地展开成 /root/xdoc 就错了（也可能不是同一个用户）
case "$DIR" in
  '~')   DIR='$HOME' ;;
  '~/'*) DIR='$HOME/'"${DIR#\~/}" ;;
esac

# ---------- 组装远程脚本 ----------

# 一次 ssh 跑完：省得来回几趟，也能让安装/构建的进度实时打出来
if [ "$NO_START" -eq 1 ]; then
  INIT_ARGS="$PASSTHRU"
else
  INIT_ARGS="--start -p $PORT"
  [ -n "$TOKEN" ] && INIT_ARGS="$INIT_ARGS --token $TOKEN"
  [ -n "$PASSTHRU" ] && INIT_ARGS="$INIT_ARGS $PASSTHRU"
fi

# 起完服务取回令牌：从配置文件解出来的令牌直接问日志最省事——不管它来自
# 命令行、环境变量还是 config.json，CLI 都会把最终那份印在同一行横幅里
TOKEN_SNIPPET=""
if [ "$NO_START" -eq 0 ]; then
  TOKEN_SNIPPET="$(cat <<EOF
line="\$(grep -a '访问令牌' "$DIR/.run/xdoc-$PORT.log" 2>/dev/null | tail -n 1 || true)"
printf 'XDOC_DEPLOY_TOKEN=%s\\n' "\$(printf '%s' "\$line" | awk '{print \$NF}')"
EOF
)"
fi

REMOTE_SCRIPT="$(cat <<EOF
set -e

if [ -d "$DIR/.git" ]; then
  echo "[deploy] 更新代码：$DIR"
  git -C "$DIR" pull --ff-only || {
    echo "[deploy] git pull 失败：服务器上 $DIR 有本地改动？先 git -C $DIR status 看看" >&2
    exit 1
  }
elif [ -d "$DIR" ]; then
  echo "[deploy] $DIR 已存在但不是 git 仓库，换个 --dir 或先把它挪走" >&2
  exit 1
else
  echo "[deploy] 拉取代码：$REPO -> $DIR"
  git clone "$REPO" "$DIR"
fi

cd "$DIR"
echo "[deploy] 服务器上执行：scripts/init.sh $INIT_ARGS"
./scripts/init.sh $INIT_ARGS

$TOKEN_SNIPPET
EOF
)"

if [ "$DRY_RUN" -eq 1 ]; then
  info "# 将在 $TARGET 上执行："
  printf '%s\n' "$REMOTE_SCRIPT"
  exit 0
fi

# ---------- 连上去 ----------

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -p "$SSH_PORT" "$TARGET")
step "连接 $TARGET …"
"${SSH[@]}" true 2>/dev/null || die "ssh 连不上 $TARGET。
  先确认能免密登录：ssh -p $SSH_PORT $TARGET
  还没配密钥就：ssh-copy-id -p $SSH_PORT $TARGET"
ok "ssh 通了"

step "在服务器上部署（首次会装 Node / 依赖 / 构建，慢一点）"
OUTPUT="$("${SSH[@]}" "$REMOTE_SCRIPT")" || die "服务器上执行失败，上面是它的输出。"
printf '%s\n' "$OUTPUT" | sed 's/^/  /'

REMOTE_TOKEN="$(printf '%s\n' "$OUTPUT" | sed -n 's/^XDOC_DEPLOY_TOKEN=//p' | tail -n 1)"
[ -n "$REMOTE_TOKEN" ] || REMOTE_TOKEN="$TOKEN"

# ---------- 从本地验一下 ----------

URL="http://$ADDR:$PORT"
REACHABLE=0
if [ "$NO_START" -eq 0 ]; then
  step "从本地探 $URL"
  # 401 也算通：服务在，只是没带令牌
  code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "$URL/api/spaces" 2>/dev/null || true)"
  if [ -n "$code" ]; then
    REACHABLE=1
    ok "可达（HTTP $code）"
  fi
fi

# ---------- 收尾 ----------

info ''
if [ "$NO_START" -eq 1 ]; then
  info '完成：代码已同步并构建，没有启动服务。'
  exit 0
fi

info "完成：xdoc 已在 $TARGET 上跑起来。"
info ''
info "  访问地址：$URL"
info "  MCP 端点：$URL/mcp"
if [ -n "$REMOTE_TOKEN" ]; then
  info "  访问令牌：$REMOTE_TOKEN"
else
  info "  未设令牌：浏览器打开就能看（要加令牌就在 config.json 里写 token）"
fi
info ''
if [ "$REACHABLE" -eq 0 ]; then
  warn "本地连不上 $URL —— 服务是起来了（在服务器上监听 0.0.0.0:$PORT），
  大概率是防火墙没放行。云服务器去控制台安全组放行 $PORT/tcp：
    sudo ufw allow $PORT/tcp                     # 或者 firewalld / 云厂商安全组
  再验：curl -sS -o /dev/null -w '%{http_code}\n' $URL/api/spaces"
  info ''
fi

info "浏览器打开上面地址就能看。Agent 端（Claude Desktop 走 mcp-remote）："
info ''
if [ -n "$REMOTE_TOKEN" ]; then
  cat <<EOF
  {
    "mcpServers": {
      "xdoc-remote": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "$URL/mcp",
                 "--header", "Authorization: Bearer \${XDOC_TOKEN}"],
        "env": { "XDOC_TOKEN": "$REMOTE_TOKEN" }
      }
    }
  }
EOF
else
  cat <<EOF
  {
    "mcpServers": {
      "xdoc-remote": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "$URL/mcp"]
      }
    }
  }
EOF
fi
info ''
info "  起停：ssh $TARGET 'cd $DIR && scripts/xdoc.sh {start|stop|restart|status|logs}'"
