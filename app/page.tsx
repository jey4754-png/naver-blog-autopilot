"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SettingsDrawer from "@/app/SettingsDrawer";
import type {
  Settings,
  Limits,
  StatusResponse,
  UsageResponse,
  JobSummary,
  JobDetail,
  DraftSection,
} from "@/app/clientTypes";

type Mode = "auto" | "experience" | "branding";
type PhotoSource = "local" | "crawl" | "ai" | "none";

const MODE_INFO: Record<Mode, { title: string; desc: string }> = {
  auto: { title: "자동 발굴", desc: "키워드만 넣으면 트렌드를 읽고 글감을 골라 씁니다" },
  experience: { title: "체험단", desc: "1인칭 방문/사용 후기체로 씁니다" },
  branding: { title: "브랜딩·전문성", desc: "권위→실적→프레임워크 구조로 씁니다" },
};

const STAGE_LABEL: Record<string, string> = {
  queued: "대기 중",
  collecting: "자료 수집 중",
  "local-photos": "사진 확인 중",
  ideas: "글감 고르는 중",
  draft: "글 쓰는 중",
  images: "사진 준비 중",
  publishing: "발행 중",
};

function fmtStage(status: string, stage: string | null) {
  if (status === "done") return "완료";
  if (status === "failed") return "실패";
  if (status === "canceled") return "취소됨";
  return stage ? (STAGE_LABEL[stage] ?? stage) : status;
}

async function jsonFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

export default function Page() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [logs, setLogs] = useState<{ level: string; message: string }[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("auto");
  const [keyword, setKeyword] = useState("");
  const [topic, setTopic] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [photoSource, setPhotoSource] = useState<PhotoSource>("none");
  const [photoFolder, setPhotoFolder] = useState("");
  const [batchMode, setBatchMode] = useState<"order" | "ai">("order");
  const [imageStyle, setImageStyle] = useState<"photo" | "illust">("photo");

  const refreshStatus = useCallback(() => {
    jsonFetch<StatusResponse>("/api/status").then(setStatus).catch(() => {});
  }, []);
  const refreshUsage = useCallback(() => {
    jsonFetch<UsageResponse>("/api/usage").then(setUsage).catch(() => {});
  }, []);
  const refreshJobs = useCallback(() => {
    jsonFetch<{ jobs: JobSummary[] }>("/api/jobs")
      .then((d) => setJobs(d.jobs))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshUsage();
    refreshJobs();
    const t = setInterval(() => {
      refreshStatus();
      refreshUsage();
      refreshJobs();
    }, 5000);
    return () => clearInterval(t);
  }, [refreshStatus, refreshUsage, refreshJobs]);

  const loadDetail = useCallback((id: string) => {
    jsonFetch<JobDetail>(`/api/jobs/${id}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, []);

  const [streamKey, setStreamKey] = useState(0);

  useEffect(() => {
    if (!selectedId) return;
    setLogs([]);
    loadDetail(selectedId);

    const es = new EventSource(`/api/jobs/${selectedId}/stream?r=${streamKey}`);
    es.addEventListener("log", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data);
      setLogs((prev) => [...prev, { level: data.level, message: data.message }]);
    });
    es.addEventListener("end", () => {
      loadDetail(selectedId);
      refreshJobs();
      refreshUsage();
      es.close();
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [selectedId, streamKey, loadDetail, refreshJobs, refreshUsage]);

  // 초안을 고쳐서 다시 발행을 시도한 뒤, 로그 스트림을 새로 연결하기 위해 부른다.
  const reconnectStream = useCallback(() => setStreamKey((k) => k + 1), []);

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => {
      setStatus((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev));
      jsonFetch<{ settings: Settings }>("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .then((d) => setStatus((prev) => (prev ? { ...prev, settings: d.settings } : prev)))
        .catch(() => refreshStatus());
    },
    [refreshStatus],
  );

  const resetSettings = useCallback(() => {
    jsonFetch<{ settings: Settings }>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: true }),
    }).then((d) => setStatus((prev) => (prev ? { ...prev, settings: d.settings } : prev)));
  }, []);

  const handleLogin = useCallback(async () => {
    setLoginBusy(true);
    try {
      await jsonFetch("/api/naver/login", { method: "POST" });
    } catch {
      // 상태는 아래 refreshStatus 로 다시 확인한다.
    } finally {
      setLoginBusy(false);
      refreshStatus();
    }
  }, [refreshStatus]);

  const pickFolder = useCallback(async () => {
    try {
      const res = await jsonFetch<{ ok: boolean; folder?: string; manual?: boolean; message?: string }>(
        "/api/pick-folder",
        { method: "POST" },
      );
      if (res.ok && res.folder) setPhotoFolder(res.folder);
      else if (res.manual) setFormError(res.message ?? "폴더 경로를 직접 입력해 주세요");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const submit = useCallback(async () => {
    setFormError(null);
    if (mode === "auto" && !keyword.trim()) {
      setFormError("관심 키워드를 입력해 주세요");
      return;
    }
    if (mode !== "auto" && (!topic.trim() || !keyPoints.trim())) {
      setFormError("주제와 핵심 내용을 입력해 주세요");
      return;
    }
    if (photoSource === "ai" && status && !status.cloudflareConfigured) {
      setFormError("AI 사진 생성을 쓰려면 Cloudflare 열쇠를 먼저 설정해야 합니다");
      return;
    }

    setStarting(true);
    try {
      const body =
        mode === "auto"
          ? { mode, keyword: keyword.trim(), photoSource: photoSource === "local" ? "none" : photoSource, imageStyle }
          : {
              mode,
              topic: topic.trim(),
              keyPoints: keyPoints.trim(),
              photoSource,
              photoFolder: photoSource === "local" ? photoFolder.trim() : undefined,
              batchMode,
              imageStyle,
            };
      const res = await jsonFetch<{ id: string }>("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSelectedId(res.id);
      refreshJobs();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [mode, keyword, topic, keyPoints, photoSource, photoFolder, batchMode, imageStyle, status, refreshJobs]);

  const settings = status?.settings;
  const limits = status?.limits;

  const railColor = !settings
    ? "var(--text-dim)"
    : settings.killSwitch
      ? "var(--armed)"
      : settings.dryRun
        ? "var(--safe)"
        : "var(--armed)";
  const railText = !settings
    ? "상태 확인 중..."
    : settings.killSwitch
      ? "전체 중단 / 어떤 작업도 발행되지 않습니다"
      : settings.dryRun
        ? "연습 모드 / 발행하지 않고 완성 화면만 저장합니다"
        : "실제 발행 / 완성되는 글이 블로그에 그대로 올라갑니다";
  const submitLabel = settings?.killSwitch ? "지금은 실행할 수 없음" : settings?.dryRun ? "연습으로 만들기" : "글 만들고 발행하기";

  return (
    <div className="container" style={{ paddingTop: 18, paddingBottom: 60 }}>
      <header className="status-rail">
        <div className="status-rail-inner">
          <div className="status-badge" style={{ background: `${railColor}22`, color: railColor }}>
            <span className="dot" style={{ background: railColor }} />
            <span>{railText}</span>
          </div>
          <div className="conn-dots">
            <span>
              <span className="dot" style={{ background: status?.claude.installed ? "var(--safe)" : "var(--armed)" }} />
              Claude
            </span>
            <span>
              <span className="dot" style={{ background: status?.naver.valid ? "var(--safe)" : "var(--armed)" }} />
              네이버
            </span>
            <span>
              <span className="dot" style={{ background: status?.cloudflareConfigured ? "var(--safe)" : "var(--text-dim)" }} />
              이미지 생성
            </span>
            <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>
              설정
            </button>
          </div>
        </div>
      </header>

      {!status?.naver.valid && (
        <div className="form-card" style={{ marginTop: 16 }}>
          <div>
            <strong>네이버에 대신 글을 올리려면 로그인이 한 번 필요합니다.</strong>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
              아래 버튼을 누르면 새 창이 뜹니다. 평소처럼 로그인하시고, <b>"로그인 상태 유지"에 꼭 체크</b>해 주세요.
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleLogin} disabled={loginBusy} style={{ alignSelf: "flex-start" }}>
            {loginBusy ? "로그인 창 여는 중..." : "네이버 로그인"}
          </button>
        </div>
      )}

      <div className="meters">
        <div className="meter">
          <div className="sub">오늘 발행</div>
          <div className="num tabular">
            {usage?.todayPublishCount ?? 0} / {usage?.dailyPublishLimit ?? "-"}편
          </div>
          <div className="sub">
            발행 간격 {settings?.minPublishIntervalMin ?? "-"}분
            {usage && usage.todayPublishCount >= usage.dailyPublishLimit ? " · 설정에서 늘릴 수 있습니다" : ""}
          </div>
          <div className="meter-bar">
            <div
              style={{
                width: usage ? `${Math.min(100, (usage.todayPublishCount / Math.max(1, usage.dailyPublishLimit)) * 100)}%` : "0%",
                background:
                  usage && usage.todayPublishCount / usage.dailyPublishLimit >= 0.9
                    ? "var(--armed)"
                    : usage && usage.todayPublishCount / usage.dailyPublishLimit >= 0.7
                      ? "var(--live)"
                      : "var(--act)",
              }}
            />
          </div>
        </div>
        <div className="meter">
          <div className="sub">이미지 생성량</div>
          <div className="num tabular">
            {usage ? Math.round(usage.usage.neurons) : 0} / {usage?.usage.freeDailyNeurons ?? 10000} 뉴런
          </div>
          <div className="sub">
            {usage?.usage.isEstimate ? "추정치" : "실측"} · 장당 약 {usage ? Math.round(usage.neuronsPerImage) : "-"} 뉴런
          </div>
          <div className="meter-bar">
            <div
              style={{
                width: usage ? `${Math.min(100, (usage.usage.neurons / usage.usage.freeDailyNeurons) * 100)}%` : "0%",
                background:
                  usage && usage.usage.neurons / usage.usage.freeDailyNeurons >= 0.9
                    ? "var(--armed)"
                    : usage && usage.usage.neurons / usage.usage.freeDailyNeurons >= 0.7
                      ? "var(--live)"
                      : "var(--act)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="section-title">글 쓰기</div>
      <div className="mode-cards">
        {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
          <button key={m} className="mode-card" aria-pressed={mode === m} onClick={() => setMode(m)}>
            <h3>{MODE_INFO[m].title}</h3>
            <p>{MODE_INFO[m].desc}</p>
          </button>
        ))}
      </div>

      <div className="form-card" style={{ marginTop: 12 }}>
        {mode === "auto" ? (
          <div className="field">
            <label>관심 키워드</label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="예: 제주도 여행, 홈카페"
            />
          </div>
        ) : (
          <>
            <div className="field">
              <label>주제</label>
              <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: OO카페 방문 후기" />
            </div>
            <div className="field">
              <label>핵심 내용</label>
              <textarea
                value={keyPoints}
                onChange={(e) => setKeyPoints(e.target.value)}
                placeholder={mode === "experience" ? "가는 법, 가격, 웨이팅, 느낀 점 등을 자유롭게 적어주세요" : "실적·숫자·강조하고 싶은 사실을 적어주세요"}
              />
            </div>
          </>
        )}

        <div className="field">
          <label>사진</label>
          <div className="chip-row">
            {mode !== "auto" && (
              <button className="chip" aria-pressed={photoSource === "local"} onClick={() => setPhotoSource("local")}>
                내 사진
              </button>
            )}
            <button className="chip" aria-pressed={photoSource === "crawl"} onClick={() => setPhotoSource("crawl")}>
              검색해서 가져오기
            </button>
            <button className="chip" aria-pressed={photoSource === "ai"} onClick={() => setPhotoSource("ai")}>
              AI로 그리기
            </button>
            <button className="chip" aria-pressed={photoSource === "none"} onClick={() => setPhotoSource("none")}>
              사진 없음
            </button>
          </div>
        </div>

        {photoSource === "local" && (
          <div className="field">
            <label>사진 폴더</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={photoFolder}
                onChange={(e) => setPhotoFolder(e.target.value)}
                placeholder="폴더 경로 (예: ~/Pictures/제주여행)"
              />
              <button className="btn" onClick={pickFolder} type="button">
                폴더 선택
              </button>
            </div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              <button className="chip" aria-pressed={batchMode === "order"} onClick={() => setBatchMode("order")}>
                순서대로
              </button>
              <button className="chip" aria-pressed={batchMode === "ai"} onClick={() => setBatchMode("ai")}>
                AI가 어울리는 자리 찾기
              </button>
            </div>
          </div>
        )}

        {(photoSource === "ai" || photoSource === "crawl") && (
          <div className="field">
            <label>그림체</label>
            <div className="chip-row">
              <button className="chip" aria-pressed={imageStyle === "photo"} onClick={() => setImageStyle("photo")}>
                사진 느낌
              </button>
              <button className="chip" aria-pressed={imageStyle === "illust"} onClick={() => setImageStyle("illust")}>
                일러스트
              </button>
            </div>
            {photoSource === "ai" && status && !status.cloudflareConfigured && (
              <div className="badge-warn" style={{ marginTop: 8 }}>
                Cloudflare 열쇠가 없어 AI 사진 생성을 쓸 수 없습니다 (설정 안내는 README 참고)
              </div>
            )}
          </div>
        )}

        {formError && <div className="badge-warn">{formError}</div>}

        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={starting || settings?.killSwitch || (photoSource === "ai" && status ? !status.cloudflareConfigured : false)}
        >
          {starting ? "만드는 중..." : submitLabel}
        </button>
      </div>

      <div className="section-title">최근 작업</div>
      <div className="layout-2col">
        <div className="job-list">
          {jobs.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>아직 만든 글이 없습니다</div>}
          {jobs.map((j) => (
            <button key={j.id} className="job-row" aria-pressed={selectedId === j.id} onClick={() => setSelectedId(j.id)}>
              <div className="kw">{j.keyword}</div>
              <div className="st">{fmtStage(j.status, j.stage)}</div>
            </button>
          ))}
        </div>

        <div className="detail-panel">
          {!detail && <div style={{ color: "var(--text-dim)" }}>왼쪽에서 작업을 선택하면 진행 상황이 여기 표시됩니다</div>}
          {detail && (
            <JobDetailView
              detail={detail}
              logs={logs}
              onChanged={() => {
                loadDetail(detail.job.id);
                reconnectStream();
                refreshJobs();
              }}
            />
          )}
        </div>
      </div>

      {status && settings && limits && (
        <SettingsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          settings={settings}
          limits={limits}
          onPatch={patchSettings}
          onReset={resetSettings}
        />
      )}
    </div>
  );
}

function JobDetailView({
  detail,
  logs,
  onChanged,
}: {
  detail: JobDetail;
  logs: { level: string; message: string }[];
  onChanged: () => void;
}) {
  const draft = detail.drafts[detail.drafts.length - 1];
  const post = detail.posts[0];
  const inProgress = !["done", "failed", "canceled"].includes(detail.job.status);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSections, setEditSections] = useState<DraftSection[]>([]);
  const [polishInstruction, setPolishInstruction] = useState("");
  const [busy, setBusy] = useState<"save" | "republish" | "polish" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const startEditing = () => {
    if (!draft) return;
    setEditTitle(draft.title);
    setEditSections(draft.sections.map((s) => ({ ...s })));
    setActionError(null);
    setEditing(true);
  };

  const updateSection = (i: number, patch: Partial<DraftSection>) => {
    setEditSections((prev) => prev.map((s, idx) => (idx === i ? ({ ...s, ...patch } as DraftSection) : s)));
  };

  const removeSection = (i: number) => {
    setEditSections((prev) => prev.filter((_, idx) => idx !== i));
  };

  const saveEdits = async (): Promise<boolean> => {
    if (!draft) return false;
    setBusy("save");
    setActionError(null);
    try {
      await jsonFetch(`/api/jobs/${detail.job.id}/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, sections: editSections }),
      });
      onChanged();
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveAndClose = async () => {
    const ok = await saveEdits();
    if (ok) setEditing(false);
  };

  const polishText = async () => {
    if (!draft) return;
    const ok = await saveEdits();
    if (!ok) return;
    setBusy("polish");
    setActionError(null);
    try {
      const res = await jsonFetch<{ title: string; sections: DraftSection[] }>(
        `/api/jobs/${detail.job.id}/drafts/${draft.id}/polish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction: polishInstruction }),
        },
      );
      setEditSections(res.sections);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const republish = async () => {
    if (!draft) return;
    const ok = await saveEdits();
    if (!ok) return;
    setBusy("republish");
    setActionError(null);
    try {
      await jsonFetch(`/api/jobs/${detail.job.id}/republish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{detail.job.keyword}</h3>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>
        {fmtStage(detail.job.status, detail.job.stage)}
      </div>

      {inProgress && (
        <div style={{ marginBottom: 16 }}>
          {logs.map((l, i) => (
            <div key={i} className={`log-line ${l.level}`}>
              {l.message}
            </div>
          ))}
        </div>
      )}

      {post && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div>
            <b>결과: </b>
            {post.status === "published" && "발행 완료"}
            {post.status === "dry_run" && "연습 모드로 완성"}
            {post.status === "failed" && "실패"}
            {post.status === "blocked" && "차단됨"}
          </div>
          {post.note && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{post.note}</div>}
          {post.blog_url && (
            <a href={post.blog_url} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ width: "fit-content" }}>
              올라간 글 보기
            </a>
          )}
          {post.screenshotUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.screenshotUrl} alt="완성 화면 미리보기" className="preview-img" />
          )}
        </div>
      )}

      {draft && !inProgress && (
        <div>
          <div
            className="section-title"
            style={{ marginTop: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <span>글 미리보기</span>
            {!editing && (
              <button className="btn" onClick={startEditing}>
                수정하기
              </button>
            )}
          </div>

          {actionError && <div className="badge-warn" style={{ marginBottom: 10 }}>{actionError}</div>}

          {editing ? (
            <div className="form-card">
              <div className="field">
                <label>제목</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>

              {editSections.map((s, i) => (
                <SectionEditor key={i} section={s} onChange={(patch) => updateSection(i, patch)} onRemove={() => removeSection(i)} />
              ))}

              <div className="field">
                <label>AI로 다듬을 때 원하는 스타일 (선택, 비워두면 기본으로 다듬습니다)</label>
                <input
                  type="text"
                  placeholder="예: 그림일기처럼 짧고 쉬운 문장으로, 아이에게 말하듯이"
                  value={polishInstruction}
                  onChange={(e) => setPolishInstruction(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => setEditing(false)} disabled={busy !== null}>
                  취소
                </button>
                <button className="btn" onClick={polishText} disabled={busy !== null}>
                  {busy === "polish" ? "다듬는 중... (1분 정도)" : "AI로 다듬기"}
                </button>
                <button className="btn" onClick={saveAndClose} disabled={busy !== null}>
                  {busy === "save" ? "저장 중..." : "저장"}
                </button>
                <button className="btn btn-primary" onClick={republish} disabled={busy !== null}>
                  {busy === "republish" ? "다시 만드는 중..." : "이 내용으로 다시 만들기"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {draft.sections.map((s, i) => (
                <SectionPreview key={i} section={s} images={detail.images} index={i} />
              ))}
              <button className="btn btn-primary" onClick={republish} disabled={busy !== null} style={{ marginTop: 12 }}>
                {busy === "republish" ? "다시 만드는 중..." : "이 내용으로 다시 만들기"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionEditor({
  section,
  onChange,
  onRemove,
}: {
  section: DraftSection;
  onChange: (patch: Partial<DraftSection>) => void;
  onRemove: () => void;
}) {
  const label: Record<DraftSection["type"], string> = {
    heading: "소제목",
    paragraph: "문단",
    quote: "인용구",
    divider: "구분선",
    image: "사진",
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{label[section.type]}</span>
        <button className="btn btn-ghost" onClick={onRemove} style={{ padding: "2px 8px", fontSize: 12 }}>
          삭제
        </button>
      </div>

      {(section.type === "heading" || section.type === "quote") && (
        <input
          type="text"
          className="editor-input"
          value={section.text}
          onChange={(e) => onChange({ text: e.target.value } as Partial<DraftSection>)}
        />
      )}

      {section.type === "paragraph" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            className="editor-input"
            value={section.text}
            onChange={(e) => onChange({ text: e.target.value } as Partial<DraftSection>)}
          />
          <input
            type="text"
            className="editor-input"
            placeholder="형광펜으로 강조할 문구 (본문 안에 있는 글자 그대로, 비워두면 없음)"
            value={section.highlight ?? ""}
            onChange={(e) => onChange({ highlight: e.target.value || undefined } as Partial<DraftSection>)}
          />
        </div>
      )}

      {section.type === "image" && (
        <input
          type="text"
          className="editor-input"
          placeholder="사진 설명(캡션)"
          value={section.caption ?? ""}
          onChange={(e) => onChange({ caption: e.target.value || undefined } as Partial<DraftSection>)}
        />
      )}

      {section.type === "divider" && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>─── 구분선 ───</div>}
    </div>
  );
}

function highlightText(text: string, highlight?: string) {
  if (!highlight) return text;
  const idx = text.indexOf(highlight);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="preview-mark">{highlight}</mark>
      {text.slice(idx + highlight.length)}
    </>
  );
}

function SectionPreview({
  section,
  images,
  index,
}: {
  section: DraftSection;
  images: JobDetail["images"];
  index: number;
}) {
  if (section.type === "heading") return <div className="preview-heading">{section.text}</div>;
  if (section.type === "quote") return <div className="preview-quote">{section.text}</div>;
  if (section.type === "divider") return <hr className="preview-hr" />;
  if (section.type === "paragraph")
    return <p className="preview-section">{highlightText(section.text, section.highlight)}</p>;

  const img = images.find((im) => im.section_index === index && im.verdict_ok === 1);
  return (
    <div className="preview-section">
      {img?.fileUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.fileUrl} alt={section.caption ?? section.query} className="preview-img" />
      ) : (
        <div className="badge-warn">사진 없음: {section.query}</div>
      )}
      {section.caption && <div className="preview-caption">{section.caption}</div>}
    </div>
  );
}
