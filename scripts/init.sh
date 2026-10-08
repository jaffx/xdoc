#!/usr/bin/env bash
#
# xdoc 服务器初始化：从一台干净机器，到 xdoc 在后台跑起来。
#
# 与 scripts/xdoc.sh 的分工：
#   xdoc.sh 管「环境已经齐了之后怎么起停」，
#   本脚本管「环境本身还不齐时怎么补齐」。
#
# 幂等，可以反复执行。阶段：
#   1 环境自检   架构 / 发行版 / 内存 / 磁盘 / 下载工具 / glibc
#   2 安装 Node  缺失或低于 18.17 时，官方 tarball → 阿里云镜像回退，带 sha256 校验
#   3 检查 git   缺了尝试用系统包管理器装；装不上只警告
#   4 检查 npm 源是否可达
#   5 安装依赖   npm install（已有 node_modules 且未 --force 时跳过）
#   6 构建       npm run build，产出 dist/
#   7 启动       仅 --start 时执行，交给 scripts/xdoc.sh start
#
# 前提：代码已经在服务器上（scp / tar / git clone 都行），本脚本不负责拉代码。
#
# 部署到服务器时，--host / --token 会一路传到 CLI；不传就读 <root>/config.json。
# 写完 config.json 之后，前后重启都直接用 scripts/xdoc.sh restart 就行。
#
# 用法：scripts/init.sh [选项]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 与 package.json 的 engines 保持一致
MIN_NODE_MAJOR=18
MIN_NODE_MINOR=17

NODE_VERSION="v22.23.2"        # 与本机开发环境对齐
PREFIX="/usr/local"
REGISTRY=""
CHECK_ONLY=0
SWAP_MB=0                      # 0 = 内存不足时只提示，不动系统
SKIP_INSTALL=0
SKIP_BUILD=0
FORCE=0
DO_START=0
PORT="${XDOC_PORT:-1998}"
HOST=""
TOKEN=""
CERT=""
KEY=""

TMP_DIR=""
CURL=""
WGET=""
cleanup() { [ -n "${TMP_DIR:-}" ] && rm -rf "$TMP_DIR"; return 0; }
trap cleanup EXIT

# ---------- 输出 ----------

info() { printf '%s\n' "$*"; }
step() { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
row()  { printf '  %s：%s\n' "$1" "$2"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
xdoc 服务器初始化

用法：
  scripts/init.sh [选项]

选项：
  --check-only          只做环境自检，不安装、不构建
  --node <版本>         Node 版本，默认 v22.23.2
  --prefix <路径>       Node 安装位置，默认 /usr/local（非 root 用 ~/.local）
  --swap <MB>           可用内存不足时创建 swap，默认 0 = 只提示不动系统
  --registry <url>      npm 源（默认用 npm 自己的配置）
  --force               已有 node_modules 也重装依赖、重新构建
  --skip-install        跳过 npm install
  --skip-build          跳过 npm run build
  --start               构建完直接后台启动（等价 scripts/xdoc.sh start）
  -p, --port <端口>     启动端口，默认 1998
      --host <地址>     监听地址，对外提供服务要 0.0.0.0（默认 127.0.0.1）
      --token <令牌>    访问令牌；不设就谁都能看（默认如此，见 <root>/config.json）
      --cert <路径>     TLS 证书（PEM），与 --key 一起用则提供 https
      --key <路径>      TLS 私钥（PEM）
  -h, --help            显示帮助

示例：
  scripts/init.sh --check-only              # 先看看这台机器行不行
  scripts/init.sh --start                   # 一条龙：装环境 + 构建 + 起服务
  scripts/init.sh --start --token <令牌>     # 同上，但顺手加一道令牌
  scripts/init.sh --prefix ~/.local --swap 2048

这几个部署参数也可以写进 <root>/config.json（默认 ~/.xdoc/config.json，首次
运行自动生成 { "host": "0.0.0.0" }），之后起停就不用再带。想鉴权就往里加：
  { "host": "0.0.0.0", "token": "自己定一个足够长的随机串" }
EOF
}

# ---------- 版本与架构 ----------

# $1 = vX.Y.Z，判断是否 >= 18.17
version_ge_min() {
  local v="${1#v}" major minor
  major="${v%%.*}"
  minor="${v#*.}"; minor="${minor%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt "$MIN_NODE_MAJOR" ] && return 0
  [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ] && return 0
  return 1
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   printf 'x64' ;;
    aarch64|arm64)  printf 'arm64' ;;
    *)              return 1 ;;
  esac
}

# ---------- 下载 ----------

pick_downloader() {
  command -v curl >/dev/null 2>&1 && CURL="$(command -v curl)"
  command -v wget >/dev/null 2>&1 && WGET="$(command -v wget)"
  [ -n "$CURL" ] || [ -n "$WGET" ] || die "curl 和 wget 都没有，没法下载 Node.js；请先装其中之一"
}

# $1=url $2=输出文件
# 国内访问 nodejs.org 偶发抖动，统一带重试；超时给得宽一点
fetch() {
  if [ -n "$CURL" ]; then
    "$CURL" -fsSL --retry 3 --retry-delay 2 -m 600 -o "$2" "$1"
  else
    "$WGET" -q -T 600 -t 3 -O "$2" "$1"
  fi
}

# $1=url -> stdout
fetch_stdout() {
  if [ -n "$CURL" ]; then
    "$CURL" -fsSL --retry 3 --retry-delay 1 -m 60 "$1"
  else
    "$WGET" -q -T 60 -t 3 -O - "$1"
  fi
}

# 能不能连通（只看状态码，不落盘）
url_ok() {
  if [ -n "$CURL" ]; then
    "$CURL" -fsS --retry 2 --retry-delay 1 -m 20 -o /dev/null "$1" 2>/dev/null
  else
    "$WGET" -q -T 20 -t 2 --spider "$1" >/dev/null 2>&1
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

# $1=下载源根 $2=包名 $3=本地文件
verify_sha() {
  local sums expected actual
  sums="$(fetch_stdout "$1/SHASUMS256.txt" 2>/dev/null || true)"
  [ -n "$sums" ] || { warn "  拿不到 SHASUMS256.txt，跳过校验"; return 0; }
  expected="$(printf '%s\n' "$sums" | awk -v p="$2" '$2 == p { print $1 }')"
  [ -n "$expected" ] || { warn "  SHASUMS256.txt 里没有 $2，跳过校验"; return 0; }
  if ! actual="$(sha256_of "$3")"; then
    warn "  没有 sha256sum/shasum，跳过校验"
    return 0
  fi
  [ "$actual" = "$expected" ] || die "sha256 校验失败：$2
  期望 $expected
  实际 $actual"
  ok "sha256 校验通过"
}

# ---------- 自检 ----------

mem_total_mb() { awk '/^MemTotal:/     { print int($2/1024) }' /proc/meminfo 2>/dev/null || echo 0; }
mem_avail_mb() { awk '/^MemAvailable:/ { print int($2/1024) }' /proc/meminfo 2>/dev/null || echo 0; }
swap_total_mb() { awk '/^SwapTotal:/   { print int($2/1024) }' /proc/meminfo 2>/dev/null || echo 0; }

detect_distro() {
  ( . /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-未知}" ) || printf '未知'
}

self_check() {
  local arch node_v npm_v glibc_v dezip
  info '[自检]'

  if arch="$(detect_arch)"; then
    row '架构' "$(uname -m)（Node 包用 linux-$arch）"
  else
    row '架构' "$(uname -m) —— 没有对应的 Node 官方包，需要手动装"
  fi
  row '发行版' "$(detect_distro)"
  row '内存' "$(mem_avail_mb) MB 可用 / 共 $(mem_total_mb) MB"
  row '磁盘' "$(df -Ph "$REPO_DIR" | awk 'NR==2 { print $4" 可用" }')"
  row '下载工具' "${CURL:-无 curl} ${WGET:+$WGET}"

  if command -v gzip >/dev/null 2>&1; then
    dezip="gzip"
  elif command -v xz >/dev/null 2>&1; then
    dezip="xz"
  fi
  row '解压' "${dezip:-无 gzip/xz，装 Node 时会失败}"
  # pipefail 下 ldd | head 会因为 SIGPIPE 判失败，所以先吞掉状态码再判断有没有内容
  glibc_v="$(ldd --version 2>/dev/null | head -1 || true)"
  row 'glibc' "${glibc_v:-未知}"

  if node_v="$(command -v node >/dev/null 2>&1 && node -v)"; then
    if version_ge_min "$node_v"; then
      row 'node' "$node_v（满足 >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR）"
    else
      row 'node' "$node_v（低于 $MIN_NODE_MAJOR.$MIN_NODE_MINOR，需要升级）"
    fi
  else
    row 'node' '缺失'
  fi
  npm_v="$(command -v npm >/dev/null 2>&1 && npm -v || true)"
  row 'npm' "${npm_v:-缺失}"
  row 'git' "$(command -v git >/dev/null 2>&1 && git --version || echo '缺失（只影响后续 git pull，不影响运行）')"
}

# 内存不够时提醒，或者按 --swap 创建
ensure_memory() {
  local avail
  avail="$(mem_avail_mb)"
  [ "$avail" -ge 1500 ] && return 0

  warn "可用内存只有 ${avail} MB，npm install 有 OOM 风险"
  if [ "$SWAP_MB" -eq 0 ]; then
    info "  想自动加 swap 就重跑：scripts/init.sh --swap 2048"
    return 0
  fi
  if [ "$(swap_total_mb)" -gt 0 ]; then
    info "  系统已有 swap，跳过创建"
    return 0
  fi

  step "创建 ${SWAP_MB} MB swap"
  dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB" status=none || die "写 /swapfile 失败（磁盘空间？）"
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile || die "swapon 失败"
  grep -q '^/swapfile ' /etc/fstab 2>/dev/null || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  ok "已启用 /swapfile，并写入 /etc/fstab
  撤销：swapoff /swapfile && rm /swapfile（再从 /etc/fstab 删掉那行）"
}

# ---------- Node ----------

install_node() {
  local arch pkg base src v ext downloaded=0
  arch="$(detect_arch)" || die "不认识的架构 $(uname -m)，请手动安装 Node.js >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR"

  # 官方同时提供 .tar.gz 和 .tar.xz，挑一个机器上解得了的
  if command -v gzip >/dev/null 2>&1; then
    ext="tar.gz"
  elif command -v xz >/dev/null 2>&1; then
    ext="tar.xz"
  else
    die "既没有 gzip 也没有 xz，解不开 Node 包。先装一个：dnf install -y gzip（或 apt-get install -y gzip）"
  fi
  pkg="node-$NODE_VERSION-linux-$arch.$ext"
  TMP_DIR="$(mktemp -d)"

  for base in "https://nodejs.org/dist/$NODE_VERSION" \
              "https://mirrors.aliyun.com/nodejs-release/$NODE_VERSION"; do
    step "下载 $pkg（$base）"
    if fetch "$base/$pkg" "$TMP_DIR/$pkg"; then
      verify_sha "$base" "$pkg" "$TMP_DIR/$pkg"
      downloaded=1
      break
    fi
    warn "  这个源没下下来，换下一个"
  done
  [ "$downloaded" -eq 1 ] || die "两个源都失败了，请检查网络"

  step "解压到 $PREFIX"
  mkdir -p "$TMP_DIR/unpack"
  case "$ext" in
    tar.gz) tar -xzf "$TMP_DIR/$pkg" -C "$TMP_DIR/unpack" || die "解压失败" ;;
    tar.xz) tar -xJf "$TMP_DIR/$pkg" -C "$TMP_DIR/unpack" || die "解压失败" ;;
  esac
  src="$TMP_DIR/unpack/${pkg%.$ext}"
  [ -d "$src/bin" ] || die "解压结果异常：$src/bin 不存在"

  mkdir -p "$PREFIX" || die "无法创建 $PREFIX"
  [ -w "$PREFIX" ] || die "$PREFIX 不可写。非 root 请改用：--prefix ~/.local"
  cp -a "$src/." "$PREFIX/"

  export PATH="$PREFIX/bin:$PATH"
  v="$("$PREFIX/bin/node" -v)"
  version_ge_min "$v" || die "装完了但版本仍不满足：$v"
  ok "node $v / npm $("$PREFIX/bin/npm" -v)  -> $PREFIX"

  case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) warn "$PREFIX/bin 不在 PATH 里" ;;
  esac
}

ensure_node() {
  local v
  if v="$(command -v node >/dev/null 2>&1 && node -v)"; then
    if version_ge_min "$v"; then
      ok "已有 node $v，跳过安装"
      return 0
    fi
    warn "现有 node $v 低于 $MIN_NODE_MAJOR.$MIN_NODE_MINOR，将安装 $NODE_VERSION 覆盖 $PREFIX"
  fi
  install_node
}

# 装完了但 PATH 里还是没有时，给个 profile.d 片段
ensure_path() {
  case ":$PATH:" in
    *":$PREFIX/bin:"*) return 0 ;;
  esac
  [ "$PREFIX" = "/usr/local" ] && return 0    # /usr/local/bin 本来就在默认 PATH 里
  if [ -w /etc/profile.d ]; then
    printf 'export PATH="%s/bin:$PATH"\n' "$PREFIX" > /etc/profile.d/xdoc-node.sh
    ok "已写入 /etc/profile.d/xdoc-node.sh（重新登录后生效）"
  else
    warn "PATH 里没有 $PREFIX/bin，记得自己加：export PATH=\"$PREFIX/bin:\$PATH\""
  fi
}

ensure_git() {
  command -v git >/dev/null 2>&1 && { ok "git 已有：$(git --version)"; return 0; }

  local pm
  for pm in dnf yum apt-get; do
    command -v "$pm" >/dev/null 2>&1 || continue
    step "用 $pm 安装 git"
    if [ "$pm" = "apt-get" ]; then
      ( "$pm" update -qq && "$pm" install -y git ) >/dev/null 2>&1 && break
    else
      "$pm" install -y git >/dev/null 2>&1 && break
    fi
  done

  if command -v git >/dev/null 2>&1; then
    ok "$(git --version)"
  else
    warn "git 没装上。代码已经在本地的话不影响使用，只是后续没法 git pull"
  fi
}

# ---------- npm 源 ----------

registry_url() {
  if [ -n "$REGISTRY" ]; then
    printf '%s' "${REGISTRY%/}"
    return 0
  fi
  local r
  r="$(npm config get registry 2>/dev/null || true)"
  printf '%s' "${r:-https://registry.npmjs.org}"
}

ensure_registry() {
  local reg
  reg="$(registry_url)"
  case "$reg" in http://*|https://*) ;; *) die "npm 源地址不像 URL：$reg" ;; esac

  if url_ok "$reg/markdown-it"; then
    ok "npm 源可达：$reg"
  else
    warn "npm 源不可达：$reg
  换一个：scripts/init.sh --registry https://registry.npmmirror.com
  完全离线的话，只能在本机打好包（含 node_modules）再传过来"
    [ "$SKIP_INSTALL" -eq 1 ] || die "源不通装不了依赖"
  fi
}

# ---------- 依赖与构建 ----------

ensure_deps() {
  if [ "$SKIP_INSTALL" -eq 1 ]; then
    step "按参数跳过 npm install"
    return 0
  fi
  if [ -d "$REPO_DIR/node_modules" ] && [ "$FORCE" -eq 0 ]; then
    ok "已有 node_modules，跳过安装（要重装加 --force）"
    return 0
  fi

  local -a args=(install)
  [ -n "$REGISTRY" ] && args+=(--registry "${REGISTRY%/}")
  step "npm ${args[*]} …（mermaid/echarts 有几十 MB，慢一点正常）"
  ( cd "$REPO_DIR" && npm "${args[@]}" )
  ok "依赖装好了"
}

ensure_build() {
  if [ "$SKIP_BUILD" -eq 1 ]; then
    step "按参数跳过 npm run build"
  else
    step "npm run build …"
    ( cd "$REPO_DIR" && npm run build )
  fi

  [ -f "$REPO_DIR/dist/cli.js" ] || die "dist/cli.js 不存在，构建没成功"
  ok "构建产物就绪：dist/cli.js（$(du -sh "$REPO_DIR/dist" | awk '{print $1}')）"
}

# ---------- 启动 ----------

start_service() {
  [ "$DO_START" -eq 1 ] || return 0
  # 令牌不再是必需项（不设就是不鉴权），所以这里不拦也不猜——到底有没有令牌、
  # 监听在哪，CLI 的启动横幅会照实打出来
  local -a args=(start -p "$PORT")
  [ -n "$HOST" ] && args+=(--host "$HOST")
  [ -n "$TOKEN" ] && args+=(--token "$TOKEN")
  [ -n "$CERT" ] && args+=(--cert "$CERT")
  [ -n "$KEY" ] && args+=(--key "$KEY")

  step "启动服务（$HOST:$PORT）"
  "$REPO_DIR/scripts/xdoc.sh" "${args[@]}"
}

# ---------- 参数解析 ----------

while [ $# -gt 0 ]; do
  case "$1" in
    --check-only)   CHECK_ONLY=1; shift ;;
    --node)         NODE_VERSION="${2:-}"; shift 2 ;;
    --prefix)       PREFIX="${2:-}"; shift 2 ;;
    --swap)         SWAP_MB="${2:-}"; shift 2 ;;
    --registry)     REGISTRY="${2:-}"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --skip-build)   SKIP_BUILD=1; shift ;;
    --start)        DO_START=1; shift ;;
    -p|--port)      PORT="${2:-}"; shift 2 ;;
    --host)         HOST="${2:-}"; shift 2 ;;
    --token)        TOKEN="${2:-}"; shift 2 ;;
    --cert)         CERT="${2:-}"; shift 2 ;;
    --key)          KEY="${2:-}"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *)              usage; die "未知参数：$1" ;;
  esac
done

case "$NODE_VERSION" in v*) ;; *) NODE_VERSION="v$NODE_VERSION" ;; esac
case "$PREFIX" in ''|/*) ;; *) die "--prefix 需要绝对路径：$PREFIX" ;; esac
case "$SWAP_MB" in ''|*[!0-9]*) die "--swap 需要整数（MB）：$SWAP_MB" ;; esac
case "$PORT" in ''|*[!0-9]*) die "端口非法：$PORT" ;; esac

# ---------- 主流程 ----------

pick_downloader
self_check

if [ "$CHECK_ONLY" -eq 1 ]; then
  info ''
  info '仅自检（--check-only），没有改动系统。'
  exit 0
fi

ensure_memory
ensure_node
ensure_path
ensure_git
ensure_registry
ensure_deps
ensure_build
start_service

info ''
info '完成。'
info "  数据根目录：${XDOC_ROOT:-~/.xdoc}"
info "  起停：$REPO_DIR/scripts/xdoc.sh {start|stop|restart|status|logs}"
[ "$DO_START" -eq 1 ] || info "  现在还没启动，要起来就执行：$REPO_DIR/scripts/xdoc.sh start -p $PORT"
