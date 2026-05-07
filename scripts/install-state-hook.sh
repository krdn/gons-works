#!/usr/bin/env bash
# scripts/install-state-hook.sh — APPLY-07 hook installer (PITFALL #8)
#
# 메인 repo `.git/hooks/pre-commit`에 state/-only fast-forward only 블록을
# idempotent하게 설치한다. `.git/hooks/`는 메인 repo가 추적하지 않으므로
# clone 후 운영자가 본 스크립트를 한 번 실행해야 APPLY-07이 활성화된다
# (02-10 verification에서 명시).
#
# D-04 lock: state/는 메인 repo의 서브디렉토리이며 별도 git repo가 아니다.
# 따라서 ff-only enforcement는 메인 repo hook의 state/ pathspec 검사로 구현한다.
# 메인 repo의 다른 영역(src/, .planning/ 등)은 영향받지 않는다.
#
# 동작:
# 1) `git rev-parse --git-path hooks/pre-commit`으로 hook 경로 해석
#    (worktree 환경에서도 메인 repo의 공유 hooks를 가리킴)
# 2) marker 라인 grep — 이미 있으면 idempotent skip
# 3) hook 파일 부재 → shebang + 블록 + `exit 0` 신설
# 4) hook 파일 존재 → 첫 줄(shebang) 보존하고 직후에 블록 prepend
# 5) chmod +x

set -euo pipefail

HOOK="$(git rev-parse --git-path hooks/pre-commit)"
MARKER="# === APPLY-07 state/-only ff-only block (PITFALL #8) ==="

# heredoc — 블록 본문. 임의의 변수 치환 차단 위해 'EOF' 인용.
BLOCK=$(cat <<'EOF'
# === APPLY-07 state/-only ff-only block (PITFALL #8) ===
# state/ subdir 변경이 staged이고 reflog가 rebase/rewrite/reset 패턴이면
# commit 거부. 메인 repo의 다른 영역은 영향받지 않음 (D-04 lock).
# NOTE (02-10 hotfix): 'git reflog' 양식은 'reset: moving to <ref>'이며 hard/soft/mixed
#   구분이 없다. 따라서 'reset:*hard*' glob는 매칭 0건이었음. 모든 reset 분기를 거부한다.
STATE_STAGED=$(git diff --cached --name-only -- state/ 2>/dev/null || echo "")
if [ -n "$STATE_STAGED" ]; then
  LAST_REFLOG=$(git reflog -1 --format="%gs" 2>/dev/null || echo "")
  case "$LAST_REFLOG" in
    rebase*|*rewrite*|reset:*)
      echo "[pre-commit] APPLY-07 violation: state/ 변경에 rebase/rewrite/reset 감지. state/ fast-forward only."
      exit 1
      ;;
  esac
fi
# === end APPLY-07 block ===
EOF
)

if [ -f "$HOOK" ] && grep -qF "$MARKER" "$HOOK"; then
  echo "[install-state-hook] already installed at $HOOK"
  exit 0
fi

if [ ! -f "$HOOK" ]; then
  # hook 부재 → 신설 (shebang + 블록 + exit 0)
  printf '#!/bin/sh\n%s\nexit 0\n' "$BLOCK" > "$HOOK"
else
  # 기존 hook 보존 — 첫 줄(shebang) 직후에 블록 prepend
  TMP=$(mktemp)
  head -1 "$HOOK" > "$TMP"
  printf '\n%s\n' "$BLOCK" >> "$TMP"
  tail -n +2 "$HOOK" >> "$TMP"
  mv "$TMP" "$HOOK"
fi

chmod +x "$HOOK"
echo "[install-state-hook] installed APPLY-07 block into $HOOK"
