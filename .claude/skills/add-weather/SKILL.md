---
name: add-weather
description: Open-Meteo 기반 날씨 예보 및 대기질 MCP 서버를 NanoClaw에 추가합니다. API 키 불필요. 최저/최고 온도, 강수량, 강설량, 일별 예보, PM10, PM2.5, AQI 등급을 제공합니다.
---

# 날씨예보 스킬 추가

Open-Meteo API를 사용하는 날씨 MCP 서버를 추가합니다.
**API 키 불필요.** 한국 지역은 기상청(KMA) 모델 데이터를 활용합니다.

## Phase 1: 사전 확인

`.nanoclaw/state.yaml`을 읽어 `applied_skills`에 `weather`가 있으면 이미 적용 완료입니다. 아래 "검증" 단계로 건너뜁니다.

## Phase 2: 스킬 적용

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-weather
```

성공하면 다음을 수행하고 종료:
- `container/agent-runner/src/weather-mcp.ts` 추가
- `container/agent-runner/src/index.ts`에 weather MCP 서버 및 allowedTools 추가
- `.nanoclaw/state.yaml`에 기록

**병합 충돌 발생 시**: `modify/container/agent-runner/src/index.ts.intent.md`를 참고하여 수동 해결 후 state.yaml에 직접 weather 항목을 추가합니다.

## Phase 3: 빌드 및 재시작

```bash
npm run build
rm -rf data/sessions/*/agent-runner-src 2>/dev/null || true
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## 검증

채널에서 테스트:

```
@Jarvis 서울 날씨 알려줘
@Jarvis 부산 이번주 날씨 예보 해줘
@Jarvis 서울 미세먼지 어때?
```

## 제거

1. `container/agent-runner/src/weather-mcp.ts` 삭제
2. `container/agent-runner/src/index.ts`에서 `weather` MCP 서버, `'mcp__weather__*'`, `__dirname`(runQuery 내) 제거
3. `.nanoclaw/state.yaml`에서 weather 항목 제거
4. `rm -rf data/sessions/*/agent-runner-src 2>/dev/null || true`
5. `./container/build.sh && npm run build`
6. 서비스 재시작
