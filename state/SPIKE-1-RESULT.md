# Spike 1 결과 — Bun.$ docker --context home-server ps

**Date:** 2026-05-06
**Status:** PASS
**Container count:** 24
**Containers detected (5 핵심 stack):** news, ais, n8n, open-webui (4/5)
**Missing:** krdn-fx (CLAUDE.md ⏸ 마커와 일치, 현재 stopped 상태)

## Context name resolution

**Plan-time 가정:** `dserver`
**실제 등록된 이름:** `home-server` (`~/.claude/CLAUDE.md` "Docker Context" 섹션과 일치)
**선택한 해결책:** `.env` 의 `DOCKER_CONTEXT=home-server`로 설정 (사용자 결정).
- `dserver` alias 추가는 하지 않음 (이중 관리 회피).
- 기존 `home-server` context를 직접 사용.

## 출력 발췌

```
[Spike 1] docker context = "home-server"
[Spike 1] ✓ docker context inspect OK
[Spike 1] ✓ 24 컨테이너 파싱 성공
샘플 (최대 5개):
  - n8n-worker (docker.n8n.io/n8nio/n8n:latest) — running Up 3 days (healthy)
  - n8n (docker.n8n.io/n8nio/n8n:latest) — running Up 3 days (healthy)
  - n8n-postgres (postgres:16-alpine) — running Up 3 days (healthy)
  - n8n-redis (redis:7-alpine) — running Up 3 days (healthy)
  - vscode (codercom/code-server) — running Up 3 days
[Spike 1] 5 핵심 stack 중 발견: news, ais, n8n, open-webui (4/5)

[Spike 1 PASS] ✓ Bun.$ docker --context home-server ps --format json roundtrip OK
```

## DESIGN.md correction #2 검증

- ✓ `dockerode` 비-사용. `Bun.$` shell-out으로 named context 호출 정상 동작 확인.
- ✓ `Bun.$` template literal interpolation이 `--context home-server`를 정확히 전달 (escape 자동 처리).
- → Phase 1 listContainers / readLogs / readCompose tool 모두 동일 패턴으로 구현 가능.

## 발견된 friction (DOG-02 입력)

1. **Context 이름 mismatch (Plan-time vs runtime)**:
   - Plan은 `dserver`를 가정했으나 실제 환경은 `home-server`.
   - `~/.claude/CLAUDE.md` "운영 서버 (192.168.0.5)" 섹션의 `Alias dserver, dcserver`는 셸 alias이지 docker context 이름이 아니었음.
   - Phase 0 plan 작성 시점에 환경 사실 확인 누락.
   - **해결책:** `.env`에서 override. plan 검증 통과(grep 패턴은 값 무관).
   - **시스템적 교훈:** 새 phase plan을 작성하기 전에 `docker context ls`처럼 라이브 환경의 사실을 한 번 확인하는 단계가 `/gsd-discuss-phase` 또는 plan 작성 단계에 명시적으로 들어가야 한다.
   - FRICTION.md (00-08)에 기록 예정.

2. **krdn-fx stopped 상태**:
   - CLAUDE.md 인프라 표에 ⏸ 마커로 stale 가능성 명시되어 있었고, 실제 stopped 상태로 확인됨.
   - services.yaml 초안 생성 시 `state: stopped` 필드를 명시해야 한다.
   - 또는 `docker --context home-server ps -a`를 사용해서 stopped 컨테이너도 enumerate.

## D-02 (No partial pass) 영향

Spike 1은 priority 1, 실패 시 Phase 1 모든 read-only tool 차단. **PASS이므로 Phase 1 진행 가능**.
