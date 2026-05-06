# services.yaml 초안 Review Checklist

`state/services.yaml.draft` 를 손으로 보강한 후 `state/services.yaml`로 mv하고 commit하라.
이 checklist는 D-03 (AI 자동 생성 + 인간 review)의 "인간 review" 단계의 가이드다.

## 5 핵심 stack 각각에 대해

### news (RSS 수집 + 요약 워커)
- [ ] `purpose` 정확한가?
- [ ] `depends_on`: news-postgres (5433), news-prod-redis (6380)
- [ ] `volumes`: pgdata, redis-data 등 named volume 명시
- [ ] `normal_log_pattern`: 예) "RSS feed parsed: 12 items"
- [ ] `key_log_locations`: news-prod-api / news-prod-worker / news-prod-beat
- [ ] 실제 `docker ps` 표시되지 않은 컨테이너가 있다면 unmatched_containers에서 옮겨오기

### ais (AI 방과후)
- [ ] `purpose`: web + worker + collector + whisper
- [ ] `depends_on`: ais-prod-postgres (5438), ais-prod-redis (6385)
- [ ] `volumes`: ais-postgres-data, whisper 모델 캐시 등
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: ais-prod-web / ais-prod-worker / ais-collector-* / ais-whisper-worker

### n8n
- [ ] `depends_on`: n8n-postgres (5434), n8n-redis
- [ ] `volumes`: n8n_data
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: n8n / n8n-worker

### open-webui
- [ ] `depends_on`: 외부 LLM endpoint
- [ ] `volumes`: open-webui_data
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: open-webui

### krdn-fx
- [ ] `depends_on`: krdn-timescaledb (5435)
- [ ] `volumes`: timescale_data
- [ ] `normal_log_pattern`
- [ ] `key_log_locations`: krdn-fx-dashboard / krdn-fx-backend

## 보강 후 commit

```bash
mv state/services.yaml.draft state/services.yaml
git add state/services.yaml state/.gitkeep state/README.md state/services.yaml.review-checklist.md
git commit -m "feat(00): services.yaml 초안 (Phase 0 BOOT-02/BOOT-03)

5 핵심 stack(news/ais/n8n/open-webui/krdn-fx) 도메인 지식 초안.
docker --context home-server ps -a --format json 결과를 AI가 분류한 후
사용자가 review-checklist에 따라 depends_on, volumes, normal_log_pattern,
key_log_locations 슬롯을 보강.

Phase 1 KB-01에서 Zod schema로 검증, Voyage AI voyage-4-lite로 임베딩될 예정."
```

이 commit이 `state/`의 첫 의미 있는 commit이며 audit trail의 기준점이 된다 (BOOT-03).
