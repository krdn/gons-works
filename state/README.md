# state/ — Git-Versioned Action Log

이 디렉토리는 gons-works AI copilot의 모든 운영 액션이 기록되는 곳이다.

## 구조 (Phase 1+ 채워짐)

- `actions/` — 한 .md 파일 = 한 commit. user prompt + AI reasoning + 결과 요약.
- `snapshots/` — 액션 시점 `docker ps` 출력.
- `services.yaml` — 5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 도메인 지식. Phase 0에서 AI 초안 생성, 사용자 review 후 첫 commit.

## 정책

- **Phase 1**: read-only 도구 호출도 SQLite event log + `state/` commit 으로 기록 (AUDIT-01).
- **Phase 2**: `proposePatch`/`applyPatch` 5-key 게이트로 승인된 변경은 2PC commit 순서 (docker exec 먼저 → 성공 시 git commit).
- **fast-forward only**: pre-commit hook으로 강제 (Phase 2 APPLY-07).

## 본 repo와의 관계

`state/`는 메인 repo의 서브디렉토리다 (별도 submodule 비-사용). 추후 `homelab-state` 별 repo로 분리하는 옵션은 v2 STATE-SUB-01에 보존.

## git log 사용 패턴

```bash
git log state/                    # 모든 액션 이력
git log state/ --since="1 week ago"
git log state/ -p actions/2026-05-06_apply-patch_voice-restart.md  # 특정 액션의 patch
```
