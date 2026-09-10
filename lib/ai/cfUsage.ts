import { getDb } from "@/lib/db";
import { neuronsPerImage } from "@/lib/ai/neurons";

// ⚠️ 7-12: 실측을 보려면 API 토큰에 "Account Analytics: Read" 권한이 필요하다.
// (GraphQL aiInferenceAdaptiveGroups). 권한이 없으면 401이 아니라
// "not authorized" GraphQL 에러로 온다 — 그때는 자체 생성 로그로 추정치를 계산한다.
// ⚠️ 이 함수는 실제 Cloudflare 계정·네트워크가 있어야 검증 가능하다. 이 세션에는
// 둘 다 없어 실측 경로는 코드만 작성했고 라이브로 확인하지 못했다 — 추정치 경로만 확인했다.

export interface UsageResult {
  neurons: number;
  isEstimate: boolean;
  note?: string;
}

function hasCfCredentials(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

async function fetchRealUsage(): Promise<UsageResult | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return null;

  const today = new Date().toISOString().slice(0, 10);
  const query = `
    query GetAiUsage($accountTag: String!, $date: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            limit: 1000
            filter: { date: $date }
          ) {
            sum { count }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { accountTag: accountId, date: today } }),
    });
    const json = await res.json();
    if (json.errors?.length) {
      // 권한 없음 등은 추정치로 폴백한다.
      return null;
    }
    const groups = json.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    const neurons = groups.reduce((sum: number, g: { sum?: { count?: number } }) => sum + (g.sum?.count ?? 0), 0);
    return { neurons, isEstimate: false };
  } catch {
    return null;
  }
}

function estimateFromLog(cfImageSteps: number): UsageResult {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM images
       WHERE source_site = 'ai' AND date(created_at, 'localtime') = date('now', 'localtime')`,
    )
    .get() as { n: number };
  const neurons = row.n * neuronsPerImage(cfImageSteps);
  return { neurons, isEstimate: true, note: "자체 생성 로그 기반 추정치입니다" };
}

export async function getUsage(cfImageSteps: number): Promise<UsageResult> {
  if (hasCfCredentials()) {
    const real = await fetchRealUsage();
    if (real) return real;
  }
  return estimateFromLog(cfImageSteps);
}

export function hasCloudflareKeys(): boolean {
  return hasCfCredentials();
}
