import { useState } from "react";
import type { AssetPreview } from "../lib/assets";
import { ExternalLink, Folder, ImageIcon, Play } from "./icons";

const ICONS = { video: Play, folder: Folder, link: ExternalLink, none: ImageIcon } as const;

/**
 * Preview of a post's asset: always something. A real picture when there is one (a cover with a play button for
 * videos), the first frame of a video file, otherwise a labelled tile saying what the asset is. If a picture cannot be
 * loaded (a private Drive file) it tries the saved fallback and then shows a tile.
 */
export function PostThumb({ preview, tall, loading }: { preview: AssetPreview; tall?: boolean; loading?: boolean }) {
  const [step, setStep] = useState<0 | 1 | 2>(0); // 0 main source, 1 fallback source, 2 gave up
  const cls = `ped-thumb${tall ? " is-tall" : ""}`;

  if (preview.kind === "image" && step < 2) {
    const src = step === 0 ? preview.src : preview.fallback;
    if (src) {
      return (
        <span className={`${cls} has-image`}>
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setStep(step === 0 && preview.fallback && preview.fallback !== preview.src ? 1 : 2)}
          />
          {preview.play && <span className="ped-thumb-play" aria-hidden="true"><Play /></span>}
          {preview.count > 1 && <span className="ped-thumb-count">{preview.count}</span>}
        </span>
      );
    }
  }

  if (preview.kind === "videofile" && step < 2) {
    return (
      <span className={`${cls} has-image`}>
        <video src={`${preview.src}#t=0.1`} muted playsInline preload="metadata" onError={() => setStep(2)} />
        <span className="ped-thumb-play" aria-hidden="true"><Play /></span>
      </span>
    );
  }

  const tile = preview.kind === "tile"
    ? { icon: preview.icon, label: preview.label }
    : preview.kind === "videofile" ? { icon: "video" as const, label: "Video" } : { icon: "none" as const, label: "Asset" };
  const Icon = ICONS[tile.icon];
  return (
    <span className={`${cls} is-tile${tile.icon === "none" ? " is-empty" : ""}`}>
      {loading ? <span className="spinner" aria-hidden="true" /> : <Icon aria-hidden />}
      <span>{tile.label}</span>
    </span>
  );
}
