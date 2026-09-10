"use client";

import { useEffect } from "react";
import type { Settings, Limits } from "@/app/clientTypes";
import { neuronsPerImage, imagesPerDay } from "@/lib/ai/neurons";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  limits: Limits;
  onPatch: (patch: Partial<Settings>) => void;
  onReset: () => void;
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  );
}

function Range({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="range-row">
      <div className="top">
        <span>{label}</span>
        <span className="tabular">
          {value}
          {unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

const VISIBILITY_LABEL: Record<Settings["visibility"], string> = {
  public: "전체공개",
  neighbor: "이웃공개",
  both: "서로이웃공개",
  private: "비공개",
};

export default function SettingsDrawer({ open, onClose, settings, limits, onPatch, onReset }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const perImage = Math.round(neuronsPerImage(settings.cfImageSteps));
  const perDay = imagesPerDay(settings.cfImageSteps);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="설정">
        <h2>설정</h2>

        <div className="section-title">발행 안전장치</div>

        <div className="switch-row">
          <div>
            <div className="label">연습 모드</div>
            <div className="desc">켜두면 발행하지 않고 완성 화면만 저장합니다</div>
          </div>
          <Switch checked={settings.dryRun} onChange={(v) => onPatch({ dryRun: v })} />
        </div>

        <div className="switch-row">
          <div>
            <div className="label">전체 중단</div>
            <div className="desc">켜두면 어떤 작업도 발행되지 않습니다</div>
          </div>
          <Switch checked={settings.killSwitch} onChange={(v) => onPatch({ killSwitch: v })} />
        </div>

        <div className="field" style={{ padding: "10px 0" }}>
          <label>공개 범위 (발행 시 적용)</label>
          <div className="chip-row">
            {(Object.keys(VISIBILITY_LABEL) as Settings["visibility"][]).map((v) => (
              <button
                key={v}
                className="chip"
                aria-pressed={settings.visibility === v}
                onClick={() => onPatch({ visibility: v })}
              >
                {VISIBILITY_LABEL[v]}
              </button>
            ))}
          </div>
        </div>

        <Range
          label="하루 발행 수"
          value={settings.dailyPublishLimit}
          min={limits.dailyPublishLimit.min}
          max={limits.dailyPublishLimit.max}
          unit="편"
          onChange={(v) => onPatch({ dailyPublishLimit: v })}
        />
        <Range
          label="최소 발행 간격"
          value={settings.minPublishIntervalMin}
          min={limits.minPublishIntervalMin.min}
          max={limits.minPublishIntervalMin.max}
          unit="분"
          onChange={(v) => onPatch({ minPublishIntervalMin: v })}
        />

        <div className="section-title">글감과 사진</div>

        <Range
          label="검색 수집량"
          value={settings.scrapeTopN}
          min={limits.scrapeTopN.min}
          max={limits.scrapeTopN.max}
          unit="건"
          onChange={(v) => onPatch({ scrapeTopN: v })}
        />
        <Range
          label="이미지 후보 수"
          value={settings.imageCandidates}
          min={limits.imageCandidates.min}
          max={limits.imageCandidates.max}
          unit="개"
          onChange={(v) => onPatch({ imageCandidates: v })}
        />
        <Range
          label="AI 그림 품질(스텝)"
          value={settings.cfImageSteps}
          min={limits.cfImageSteps.min}
          max={limits.cfImageSteps.max}
          onChange={(v) => onPatch({ cfImageSteps: v })}
        />
        <p className="badge-warn" style={{ display: "block", marginTop: 6 }}>
          지금은 장당 약 {perImage} 뉴런 — 무료 한도로 하루 약 {perDay}장
        </p>

        <div className="section-title">실행 방식</div>

        <div className="switch-row">
          <div>
            <div className="label">브라우저 보기</div>
            <div className="desc">켜면 작업 중인 브라우저 창이 화면에 보입니다</div>
          </div>
          <Switch checked={settings.showBrowser} onChange={(v) => onPatch({ showBrowser: v })} />
        </div>
        <Range
          label="AI 동시 실행"
          value={settings.claudeConcurrency}
          min={limits.claudeConcurrency.min}
          max={limits.claudeConcurrency.max}
          onChange={(v) => onPatch({ claudeConcurrency: v })}
        />
        <Range
          label="AI 응답 대기(초)"
          value={settings.claudeTimeoutSec}
          min={limits.claudeTimeoutSec.min}
          max={limits.claudeTimeoutSec.max}
          onChange={(v) => onPatch({ claudeTimeoutSec: v })}
        />

        <button className="btn btn-ghost" style={{ marginTop: 20, width: "100%" }} onClick={onReset}>
          기본값으로 되돌리기
        </button>
      </div>
    </>
  );
}
