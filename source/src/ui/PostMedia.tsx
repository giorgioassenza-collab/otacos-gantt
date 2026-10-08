import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { driveFolderLinkId, assetLinks } from "../lib/assets";
import { useDriveFolder } from "../lib/driveFolders";
import { buildSlides, type Slide } from "../lib/slides";
import { PostThumb } from "./PostThumb";
import { useAssetPreview } from "../lib/useAssetPreview";
import { ChevronLeft, ChevronRight, ExternalLink, Play } from "./icons";

/**
 * The media of a post, shown the way it will be seen:
 *  - several pictures (a carousel) -> a swipeable carousel with arrows and a counter;
 *  - a video -> a small player in the card (video file, or Drive/YouTube/Vimeo that loads when you press play);
 *  - a single picture -> the whole picture, never cropped.
 * With nothing to show it falls back to the labelled tile.
 */

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// only one video plays at a time: starting one pauses the others
let pauseOthersInstalled = false;
function installPauseOthers() {
  if (pauseOthersInstalled || typeof document === "undefined") return;
  pauseOthersInstalled = true;
  document.addEventListener("play", (event) => {
    document.querySelectorAll("video").forEach((video) => { if (video !== event.target) video.pause(); });
  }, true);
}

export interface PostMediaProps {
  asset: string;
  assetItems?: { type?: string; src?: string; fallback?: string; original?: string; label?: string }[];
  format: string;
  /** Called when the picture itself is pressed (not its controls). */
  onOpen?: () => void;
  /** "card" fits the narrow grid cells, "wide" the phone list, "sheet" the editor. */
  size?: "card" | "wide" | "sheet";
}

export function PostMedia({ asset, assetItems, format, onOpen, size = "card" }: PostMediaProps) {
  installPauseOthers();
  const width = size === "card" ? 640 : 1000;
  const hasSaved = Boolean(assetItems?.some((item) => item && (item.src || item.original) && item.type !== "folder"));
  const folderId = !hasSaved ? assetLinks(asset).map(driveFolderLinkId).find(Boolean) ?? "" : "";
  const folder = useDriveFolder(folderId);
  const slides = buildSlides({ asset, items: assetItems, folderItems: folder.items, format, width });
  // the tile for "nothing to show": same rules as the small thumbnails (folder loading, link, no asset yet)
  const { preview, loading } = useAssetPreview(asset, assetItems, 320);

  if (!slides.length) return <div className={`pm pm-${size}`}><PostThumb preview={preview} tall loading={loading || folder.loading} /></div>;
  if (slides.length > 1) return <div className={`pm pm-${size}`}><Carousel slides={slides} onOpen={onOpen} size={size} /></div>;
  const only = slides[0];
  return (
    <div className={`pm pm-${size}`}>
      {only.kind === "image" ? <FullImage slide={only} onOpen={onOpen} size={size} /> : <Player slide={only} />}
    </div>
  );
}

/* ---------- a single picture, whole ---------- */

/** Drive thumbnails come in any size you ask for: ask for what the card needs, not the 1200px the old app saved. */
function sized(src: string, width: number): string {
  return src.includes("drive.google.com/thumbnail") ? src.replace(/sz=w\d+/, `sz=w${width}`) : src;
}

/**
 * A picture shown whole. Drive answers "too many requests" when a lot of thumbnails are asked at once, so a failed
 * picture is retried twice with a pause. If it still fails the card says so and links to the original (the editor, which
 * has room for it, may show Drive's own viewer instead). It never swaps a card for a Drive page on the first error.
 */
function FullImage({ slide, onOpen, size, active = true }: { slide: Extract<Slide, { kind: "image" }>; onOpen?: () => void; size: "card" | "wide" | "sheet"; active?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"ok" | "failed" | "frame">("ok");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!active) return <div className="pm-pending" aria-hidden="true" />;
  if (state === "frame" && slide.fallback) return <iframe className="pm-frame" src={slide.fallback} loading="lazy" referrerPolicy="no-referrer" title={slide.label} allowFullScreen />;
  if (state === "failed") {
    const href = slide.original && /^https?:\/\//i.test(slide.original) ? slide.original : "";
    return (
      <div className="pm-failed">
        <span>Picture unavailable</span>
        {href && <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden /> Open</a>}
      </div>
    );
  }
  const width = size === "card" ? 640 : 1000;
  const base = sized(slide.src, width);
  const src = attempt ? `${base}${base.includes("?") ? "&" : "#"}retry=${attempt}` : base;
  return (
    <img
      className={`pm-full${onOpen ? " is-clickable" : ""}`}
      src={src}
      alt={slide.label}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onClick={onOpen}
      onError={() => {
        if (attempt < 2) { timer.current = window.setTimeout(() => setAttempt((n) => n + 1), 900 * (attempt + 1)); return; }
        setState(size === "sheet" && slide.fallback ? "frame" : "failed");
      }}
    />
  );
}

/* ---------- video: file or page that plays it ---------- */

function Player({ slide }: { slide: Exclude<Slide, { kind: "image" }> }) {
  const [playing, setPlaying] = useState(false);
  if (slide.kind === "video") {
    return <video className="pm-video" src={slide.src} controls playsInline preload="metadata" aria-label={slide.label} />;
  }
  if (playing) {
    const src = slide.autoplay ? `${slide.src}${slide.src.includes("?") ? "&" : "?"}${slide.autoplay}` : slide.src;
    return <iframe className="pm-frame" src={src} loading="lazy" referrerPolicy="no-referrer" title={slide.label} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />;
  }
  return (
    <button type="button" className="pm-facade" onClick={() => setPlaying(true)} aria-label={`Play ${slide.label}`}>
      {slide.cover ? <img src={slide.cover} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
      <span className="pm-play" aria-hidden="true"><Play /></span>
      <span className="pm-facade-label">{slide.label}</span>
    </button>
  );
}

/* ---------- several pictures: carousel ---------- */

function Carousel({ slides, onOpen, size }: { slides: Slide[]; onOpen?: () => void; size: "card" | "wide" | "sheet" }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  // the counter follows the scroll (swipes included); setState ignores repeats so this is cheap enough to run on every event
  const sync = useCallback(() => {
    const el = track.current;
    if (el && el.clientWidth) setIndex(Math.max(0, Math.min(slides.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  }, [slides.length]);

  const go = (to: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(slides.length - 1, to));
    setIndex(next); // answer the press at once, the scroll catches up
    el.scrollTo({ left: next * el.clientWidth, behavior: reduced() ? "auto" : "smooth" });
  };
  const stop = (event: MouseEvent) => event.stopPropagation();
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
  };

  return (
    <div className="pm-carousel" role="group" aria-roledescription="carousel" aria-label={`${slides.length} slides`}>
      <div className="pm-track" ref={track} onScroll={sync} onKeyDown={onKey} tabIndex={0}>
        {slides.map((slide, i) => (
          <div key={i} className="pm-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
            {slide.kind === "image" ? <FullImage slide={slide} onOpen={onOpen} size={size} active={Math.abs(i - index) <= 1} /> : <Player slide={slide} />}
          </div>
        ))}
      </div>
      <button type="button" className="pm-arrow pm-prev" onClick={(e) => { stop(e); go(index - 1); }} disabled={index === 0} aria-label="Previous slide"><ChevronLeft aria-hidden /></button>
      <button type="button" className="pm-arrow pm-next" onClick={(e) => { stop(e); go(index + 1); }} disabled={index === slides.length - 1} aria-label="Next slide"><ChevronRight aria-hidden /></button>
      <span className="pm-counter" aria-live="polite">{index + 1} / {slides.length}</span>
      {size !== "card" && slides.length <= 12 && (
        <span className="pm-dots" aria-hidden="true">{slides.map((_, i) => <i key={i} data-on={i === index} />)}</span>
      )}
    </div>
  );
}

/** Link to open the original asset elsewhere (used by the editor). */
export function OpenAsset({ href }: { href: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden /> Open the original</a>;
}
