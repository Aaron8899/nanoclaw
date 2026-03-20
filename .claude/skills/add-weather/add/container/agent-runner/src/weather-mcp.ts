/**
 * Weather MCP Server for NanoClaw
 * Open-Meteo 기반 날씨 및 대기질 정보 제공 (API 키 불필요)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/** WMO 날씨 코드를 한국어 날씨 상태로 변환 */
function getWeatherDescription(code: number): string {
  if (code === 0) return '맑음';
  if (code === 1) return '대체로 맑음';
  if (code === 2) return '구름 조금';
  if (code === 3) return '흐림';
  if (code >= 45 && code <= 48) return '안개';
  if (code >= 51 && code <= 55) return '이슬비';
  if (code >= 56 && code <= 57) return '어는 이슬비';
  if (code >= 61 && code <= 65) return '비';
  if (code >= 66 && code <= 67) return '어는 비';
  if (code >= 71 && code <= 75) return '눈';
  if (code === 77) return '싸락눈';
  if (code >= 80 && code <= 82) return '소나기';
  if (code >= 85 && code <= 86) return '눈 소나기';
  if (code >= 95 && code <= 99) return '뇌우';
  return '알 수 없음';
}

/**
 * 유럽 AQI 지수를 등급 문자열로 변환
 * @param aqi - 유럽 AQI 지수 (0~500)
 * @returns 등급 문자열
 */
function getAqiGrade(aqi: number): string {
  if (aqi <= 20) return '좋음';
  if (aqi <= 40) return '보통';
  if (aqi <= 60) return '나쁨';
  if (aqi <= 80) return '매우 나쁨';
  if (aqi <= 100) return '위험';
  return '매우 위험';
}

/**
 * 도시명을 위도/경도로 변환 (Open-Meteo Geocoding API 사용)
 * @param location - 도시명 (예: "서울", "Seoul")
 * @returns 위도, 경도, 도시명 (실패 시 null)
 */
async function geocode(location: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=ko`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> };
  if (!data.results || data.results.length === 0) return null;
  const r = data.results[0];
  return { lat: r.latitude, lon: r.longitude, name: r.name };
}

const server = new McpServer({
  name: 'weather',
  version: '1.0.0',
});

server.tool(
  'get_weather',
  `날씨 예보를 조회합니다. 현재 온도, 날씨 상태, 최저/최고 기온, 강수량, 강설량과 일별 예보를 반환합니다.
Open-Meteo API를 사용하며 API 키가 필요 없습니다. 한국 지역은 KMA 기상청 모델 데이터를 활용합니다.`,
  {
    location: z.string().describe('도시명 (예: "서울", "부산", "Tokyo", "New York")'),
    days: z.number().int().min(1).max(7).default(3).describe('예보 일수 (1~7일, 기본값 3일)'),
  },
  async (args) => {
    // 1. 도시명 → 위도/경도 변환
    const geo = await geocode(args.location);
    if (!geo) {
      return {
        content: [{ type: 'text' as const, text: `"${args.location}" 위치를 찾을 수 없습니다.` }],
        isError: true,
      };
    }

    // 2. 날씨 예보 API 호출
    const params = new URLSearchParams({
      latitude: String(geo.lat),
      longitude: String(geo.lon),
      current: 'temperature_2m,weather_code,precipitation,snowfall',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code',
      forecast_days: String(args.days),
      timezone: 'Asia/Seoul',
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `날씨 API 오류: ${res.status} ${res.statusText}` }],
        isError: true,
      };
    }

    const data = await res.json() as {
      current: {
        temperature_2m: number;
        weather_code: number;
        precipitation: number;
        snowfall: number;
      };
      daily: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
        snowfall_sum: number[];
        weather_code: number[];
      };
    };

    const cur = data.current;
    const daily = data.daily;

    // 현재 날씨 포맷팅
    const lines: string[] = [
      `📍 ${geo.name} 현재 날씨`,
      `🌡️ 현재 온도: ${cur.temperature_2m}°C`,
      `☁️ 날씨: ${getWeatherDescription(cur.weather_code)}`,
      cur.precipitation > 0 ? `🌧️ 현재 강수량: ${cur.precipitation}mm` : '',
      cur.snowfall > 0 ? `❄️ 현재 강설량: ${cur.snowfall}cm` : '',
      '',
      `📅 ${args.days}일 예보:`,
    ].filter(l => l !== null);

    // 일별 예보 포맷팅
    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i];
      const max = daily.temperature_2m_max[i];
      const min = daily.temperature_2m_min[i];
      const precip = daily.precipitation_sum[i];
      const snow = daily.snowfall_sum[i];
      const desc = getWeatherDescription(daily.weather_code[i]);

      let dayLine = `  ${date}: ${desc}, 최저 ${min}°C / 최고 ${max}°C`;
      if (precip > 0) dayLine += `, 강수 ${precip}mm`;
      if (snow > 0) dayLine += `, 강설 ${snow}cm`;
      lines.push(dayLine);
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

server.tool(
  'get_air_quality',
  `대기질 정보를 조회합니다. PM10, PM2.5, 유럽 AQI 지수와 등급(좋음/보통/나쁨/매우 나쁨)을 반환합니다.
Open-Meteo Air Quality API (CAMS 모델)를 사용하며 API 키가 필요 없습니다.`,
  {
    location: z.string().describe('도시명 (예: "서울", "부산", "Tokyo")'),
  },
  async (args) => {
    // 1. 도시명 → 위도/경도 변환
    const geo = await geocode(args.location);
    if (!geo) {
      return {
        content: [{ type: 'text' as const, text: `"${args.location}" 위치를 찾을 수 없습니다.` }],
        isError: true,
      };
    }

    // 2. 대기질 API 호출
    const params = new URLSearchParams({
      latitude: String(geo.lat),
      longitude: String(geo.lon),
      current: 'pm10,pm2_5,european_aqi',
      timezone: 'Asia/Seoul',
    });
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: `대기질 API 오류: ${res.status} ${res.statusText}` }],
        isError: true,
      };
    }

    const data = await res.json() as {
      current: {
        pm10: number;
        pm2_5: number;
        european_aqi: number;
      };
    };

    const aq = data.current;
    const grade = getAqiGrade(aq.european_aqi);

    const lines = [
      `📍 ${geo.name} 현재 대기질`,
      `🌫️ PM2.5: ${aq.pm2_5} μg/m³`,
      `💨 PM10: ${aq.pm10} μg/m³`,
      `📊 AQI (유럽): ${aq.european_aqi} (${grade})`,
    ];

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// stdio transport 시작
const transport = new StdioServerTransport();
await server.connect(transport);
