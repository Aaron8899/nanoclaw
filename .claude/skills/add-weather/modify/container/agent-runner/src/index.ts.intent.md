# Intent: container/agent-runner/src/index.ts 변경 사항

## 변경된 내용

Open-Meteo 기반 날씨 MCP 서버를 에이전트 사용 가능 도구에 추가했습니다.

## 변경된 섹션

### mcpServers (runQuery → query() 호출 내부)

기존 `nanoclaw`, `gmail` 서버 옆에 `weather` MCP 서버 추가:

```typescript
weather: {
  command: 'node',
  args: [path.join(__dirname, 'weather-mcp.js')],
},
```

### allowedTools (runQuery → query() 호출 내부)

`'mcp__weather__*'` 항목 추가하여 모든 날씨 MCP 도구 허용.

### __dirname (runQuery 함수 내부)

`mcpServerPath`에서만 사용되던 `__dirname`을 `runQuery` 함수 내부에서도 선언하여
`weather-mcp.js` 경로 참조에 사용.

기존 코드에서 `main()` 함수 내부에서만 `__dirname`이 선언되어 있었으므로,
`runQuery` 함수 내부에도 동일하게 추가했습니다.

## 불변 항목 (변경 금지)

- `nanoclaw` MCP 서버 설정 및 환경변수는 유지
- `gmail` MCP 서버 설정은 유지
- 기존 `allowedTools` 항목은 모두 유지
- 쿼리 루프, IPC 처리, MessageStream 등 모든 로직은 유지
- hooks (PreCompact, sanitize Bash)는 유지
- 출력 프로토콜 (마커) 유지

## 반드시 유지해야 할 사항

- `nanoclaw` MCP 서버 및 해당 환경변수
- `gmail` MCP 서버
- 기존 allowedTools 항목 전체
- hook 시스템 (PreCompact, PreToolUse sanitize)
- IPC input/_close sentinel 처리
- MessageStream 클래스 및 쿼리 루프
