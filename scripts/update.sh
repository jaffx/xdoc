#!/usr/bin/env bash
#
# xdoc 一条命令更新：停掉老服务 -> 拉新代码 -> 装依赖（变了才装）-> 构建 -> 起服务。
#
# 为什么不写进 scripts/xdoc.sh 当个子命令：本脚本要 git pull 自己所在的仓库，
# 挂在 xdoc.sh 里的话，pull 下来的新版本会覆盖正在执行的那份脚本，后面的流程
# 就半新半旧了。这里的壳足够薄，拉完代码再交给新的 xdoc.sh，跑的一定是最新版。
#
# 与其它脚本的分工：
#   init.sh    一台干净机器从零跑起来（装 Node、建 swap、构建、首次启动）
#   xdoc.sh    已经能跑之后起停看日志（不拉代码）
#   本脚本     代码要更新：拉代码 + 重建 + 重启
#
# 用法：scripts/update.sh [选项] [xdoc.sh 的选项]
#   scripts/update.sh                 # 拉最新代码，重建，重启（端口取 config.json / 默认 1998）
#   scripts/update.sh -p 1999         # 其余选项原样透传给 xdoc.sh，-p 决定更新哪个实例
#   scripts/update.sh --no-pull       # 不拉代码，只重建 + 重启
#   scripts/update.sh --branch v0.2   # 拉别的分支或标签

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XDOC_SH="$REPO_DIR/scripts/xdoc.sh"

DO_PULL=1
BRANCH=""
PASSTHRU=()

info() { printf '%s\n' "$*"; }
step() { printf '\n\033[2m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
xdoc 更新（拉代码 + 重建 + 重启）

用法：
  scripts/update.sh [选项] [xdoc.sh 的选项]

选项：
      --no-pull         跳过 git pull，只重建并重启
      --branch <引用>   拉指定的分支 / 标签（默认当前分支）
  -h, --help            显示帮助

其余选项原样透传给 scripts/xdoc.sh，所以 -p / -r / --token 这些照样能用：
  scripts/update.sh -p 1999          # 更新并重启 1999 这个实例
  scripts/update.sh --no-pull -r /srv/xdoc

服务器上第一次用之前，得先有一次带这个脚本的代码（比如 git pull），之后
scripts/update.sh 一条就够。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) DO_PULL=0; shift ;;
    --branch)  BRANCH="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) PASSTHRU+=("$1"); shift ;;
  esac
done

[ -f "$XDOC_SH" ] || die "找不到 $XDOC_SH，代码像是没完整拉下来"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "找不到 node。环境还没齐就先跑 scripts/init.sh --start"

# 每个子命令都把透传选项带上：端口决定停/起的是哪个实例
pass() { "$XDOC_SH" "$@" ${PASSTHRU[@]+"${PASSTHRU[@]}"}; }

# ---------- 1. 停 ----------

step "1/5 停掉老服务"
pass stop || warn "停止时出错，继续"

# ---------- 2. 拉 ----------

CHANGED=""
if [ "$DO_PULL" -eq 1 ]; then
  step "2/5 拉取新代码"
  if [ ! -d "$REPO_DIR/.git" ]; then
    die "这不是 git 仓库：$REPO_DIR
  用 scp / tar 部署的话，加 --no-pull 只重建重启；或者重新走一遍 README 的「一条命令部署」"
  fi
  # 有未提交改动就不动它：更新脚本不该替人决定丢哪份代码
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
    die "工作区有未提交的改动，先自己处理（想丢掉就 git -C $REPO_DIR checkout -- .）：
$(git -C "$REPO_DIR" status --short)"
  fi

  before="$(git -C "$REPO_DIR" rev-parse HEAD)"
  target="${BRANCH:-$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)}"
  # --quiet：拉到什么提交下面自己会打，不用 git 再报一遍文件级摘要
  git -C "$REPO_DIR" pull --ff-only --quiet origin "$target" || die "拉取失败：本地可能有分叉，或远端没配好"
  after="$(git -C "$REPO_DIR" rev-parse HEAD)"

  if [ "$before" = "$after" ]; then
    info "  已是最新：$(git -C "$REPO_DIR" log --oneline -1)"
  else
    info "  更新：${before:0:7} -> ${after:0:7}"
    git -C "$REPO_DIR" log --oneline "$before..$after" | sed 's/^/    /'
    CHANGED="$(git -C "$REPO_DIR" diff --name-only "$before" "$after")"
  fi
else
  step "2/5 跳过拉取（--no-pull）"
fi

# ---------- 3. 依赖 ----------

step "3/5 依赖"
if [ ! -d "$REPO_DIR/node_modules" ]; then
  WANT_DEPS="缺 node_modules"
elif [ -n "$CHANGED" ] && printf '%s\n' "$CHANGED" | grep -qE '^package(-lock)?\.json$'; then
  WANT_DEPS="package.json 变了"
else
  WANT_DEPS=""
fi

if [ -n "$WANT_DEPS" ]; then
  NPM="$(command -v npm || true)"
  [ -n "$NPM" ] || die "找不到 npm（node 装了但 npm 没有？）"
  info "  $WANT_DEPS，重新装依赖"
  (cd "$REPO_DIR" && "$NPM" install --no-audit --no-fund) \
    || die "npm install 失败。内存不够的话先加 swap：scripts/init.sh --swap 2048"
else
  info "  依赖没变，跳过"
fi

# ---------- 4. 构建 ----------

step "4/5 构建"
# 一定要重建：xdoc.sh 只在 dist/ 缺失时才构建，源码更新它不会自己重来
(cd "$REPO_DIR" && "$NODE" scripts/build.mjs) \
  || die "构建失败。服务仍是停着的（dist/ 还是旧那份），修好后再跑一次本脚本"

# ---------- 5. 起 ----------

step "5/5 启动"
pass start

info ""
info "更新完成。启动横幅（含访问地址、MCP 端点）在日志里："
info "  scripts/xdoc.sh logs"
