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

/** True once the element is on (or within 300px of) the screen, and stays true. */
function useNear(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); } }, { rootMargin: "300px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

export function PostMedia({ asset, assetItems, format, onOpen, size = "card" }: PostMediaProps) {
  installPauseOthers();
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const width = size === "card" ? 640 : 1000;
  // a Drive folder is always read live: the pictures saved in the post are a copy of what the folder held once, and the
  // folder changes. They are only used while the live list loads, or if Drive cannot be read.
  const folderId = assetLinks(asset).map(driveFolderLinkId).find(Boolean) ?? "";
  const folder = useDriveFolder(folderId);
  const slides = buildSlides({ asset, items: assetItems, folderItems: folder.items, format, width });
  // the tile for "nothing to show": same rules as the small thumbnails (folder loading, link, no asset yet)
  const { preview, loading } = useAssetPreview(asset, assetItems, 320);

  if (!slides.length) return <div ref={box} className={`pm pm-${size}`}><PostThumb preview={preview} tall loading={loading || folder.loading} /></div>;
  if (slides.length > 1) return <div ref={box} className={`pm pm-${size}`}><Carousel slides={slides} onOpen={onOpen} size={size} visible={near} /></div>;
  const only = slides[0];
  return (
    <div ref={box} className={`pm pm-${size}`}>
      {only.kind === "image" ? <FullImage slide={only} onOpen={onOpen} size={size} active={near} /> : <Player slide={only} />}
    </div>
  );
}

/* ---------- a single picture, whole ---------- */

/**
 * At most four pictures are loading at once, however many cards are on screen. Drive answers "too many requests" to a
 * burst of thumbnails, and a week of carousels is exactly that; queued pictures show a shimmer until their turn.
 */
const MAX_LOADING = 4;
let loading = 0;
const waiting: (() => void)[] = [];
function acquireSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      loading += 1;
      let done = false;
      resolve(() => { if (done) return; done = true; loading -= 1; waiting.shift()?.(); });
    };
    if (loading < MAX_LOADING) grant(); else waiting.push(grant);
  });
}

/** Drive thumbnails come in any size you ask for. */
function sized(src: string, width: number): string {
  return src.includes("drive.google.com/thumbnail") ? src.replace(/sz=w\d+/, `sz=w${width}`) : src;
}

function driveIdOf(src: string): string {
  return src.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1] ?? src.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? "";
}

/**
 * The addresses to try for a picture, best first. The exact address the post saved comes first (it is the one known to
 * have worked before), then a version at the size the card needs, then Google's image host for the same file.
 */
export function pictureCandidates(src: string, width: number): string[] {
  const id = driveIdOf(src);
  const list = [src, sized(src, width), id ? `https://lh3.googleusercontent.com/d/${id}=w${width}` : ""];
  return list.filter((value, index) => value && list.indexOf(value) === index);
}

/**
 * A picture shown whole. If an address fails the next one is tried at once; if all fail it waits and goes round once
 * more (Drive sometimes answers "too many requests"). Then the card says so and links to the original. It never swaps a
 * card for a Drive page on the first error; only the editor, which has room, may fall back to Drive's own viewer.
 */
function FullImage({ slide, onOpen, size, active: wantedNow = true }: { slide: Extract<Slide, { kind: "image" }>; onOpen?: () => void; size: "card" | "wide" | "sheet"; active?: boolean }) {
  // once a picture has been asked for it stays loaded, so swiping back never flashes the placeholder
  const [active, setActive] = useState(wantedNow);
  if (wantedNow && !active) setActive(true);
  const candidates = pictureCandidates(slide.src, size === "card" ? 640 : 1000);
  const [step, setStep] = useState(0); // index into candidates, counting the second round after the pause
  const [state, setState] = useState<"ok" | "failed" | "frame">("ok");
  const timer = useRef(0);
  const release = useRef<(() => void) | null>(null);
  const [granted, setGranted] = useState(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // wait for a loading slot (see acquireSlot), give it back when the picture has loaded or failed
  useEffect(() => {
    if (!active || state !== "ok") return;
    let cancelled = false;
    void acquireSlot().then((give) => {
      if (cancelled) { give(); return; }
      release.current = give;
      setGranted(true);
    });
    return () => { cancelled = true; release.current?.(); release.current = null; };
  }, [active, state]);
  const free = () => { release.current?.(); release.current = null; };

  if (!active || (state === "ok" && !granted)) return <div className="pm-pending" aria-hidden="true" />;
  if (state === "frame" && slide.fallback) return <iframe className="pm-frame" src={slide.fallback} loading="lazy" referrerPolicy="no-referrer" title={slide.label} allowFullScreen />;
  if (state === "failed") {
    const href = slide.original && /^https?:\/\//i.test(slide.original) ? slide.original : "";
    return (
      <div className="pm-failed" title={"Tried: " + candidates.join(" | ")}>
        <span>Picture unavailable</span>
        {href && <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden /> Open</a>}
      </div>
    );
  }
  const round = Math.floor(step / candidates.length);
  const src = candidates[step % candidates.length];
  return (
    <img
      key={step}
      className={`pm-full${onOpen ? " is-clickable" : ""}`}
      src={round ? `${src}${src.includes("?") ? "&" : "#"}round=${round}` : src}
      alt={slide.label}
      decoding="async"
      draggable={false}
      onClick={onOpen}
      onLoad={free}
      onError={() => {
        free();
        const next = step + 1;
        if (next % candidates.length !== 0) { setStep(next); return; } // another address for the same picture
        if (round === 0) { timer.current = window.setTimeout(() => setStep(next), 1500); return; } // one more round after a pause
        console.warn("Picture could not be loaded. Addresses tried:", candidates);
        setState(size === "sheet" && slide.fallback ? "frame" : "failed");
      }}
    />
  );
}

/* ---------- video: file or page that plays it ---------- */

function OpenLink({ href }: { href?: string }) {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  return <a className="pm-open" href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden /> Open in a new tab</a>;
}

function Facade({ cover, label, onPlay }: { cover?: string; label: string; onPlay: () => void }) {
  return (
    <button type="button" className="pm-facade" onClick={onPlay} aria-label={`Play ${label}`}>
      {cover ? <img src={cover} alt="" loading="lazy" draggable={false} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
      <span className="pm-play" aria-hidden="true"><Play /></span>
      <span className="pm-facade-label">{label}</span>
    </button>
  );
}

/**
 * Video in the card. A file the browser can play is played right here. A Drive video is streamed from Drive; if that
 * does not work (a private file, a format Chrome cannot play) Drive's own player takes over in the same place, and there
 * is always a link to open it in a new tab. YouTube/Vimeo load their player when you press play.
 */
function Player({ slide }: { slide: Exclude<Slide, { kind: "image" }> }) {
  const [mode, setMode] = useState<"cover" | "video" | "frame">("cover");

  if (slide.kind === "video") {
    return <video className="pm-video" src={slide.src} controls playsInline preload="metadata" aria-label={slide.label} />;
  }

  if (slide.kind === "drivevideo") {
    if (mode === "cover") return <Facade cover={slide.cover} label={slide.label} onPlay={() => setMode("video")} />;
    return (
      <div className="pm-playing">
        {mode === "video" ? (
          <video className="pm-video" src={slide.src} poster={slide.cover} controls autoPlay playsInline preload="auto" aria-label={slide.label} onError={() => setMode("frame")} />
        ) : (
          <iframe className="pm-frame" src={slide.page} referrerPolicy="no-referrer" title={slide.label} allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
        )}
        <OpenLink href={slide.original || slide.page} />
      </div>
    );
  }

  if (mode !== "cover") {
    const src = slide.autoplay ? `${slide.src}${slide.src.includes("?") ? "&" : "?"}${slide.autoplay}` : slide.src;
    return (
      <div className="pm-playing">
        <iframe className="pm-frame" src={src} referrerPolicy="no-referrer" title={slide.label} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
        <OpenLink href={slide.src} />
      </div>
    );
  }
  return <Facade cover={slide.cover} label={slide.label} onPlay={() => setMode("video")} />;
}

/* ---------- several pictures: carousel ---------- */

function Carousel({ slides, onOpen, size, visible }: { slides: Slide[]; onOpen?: () => void; size: "card" | "wide" | "sheet"; visible: boolean }) {
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
            {slide.kind === "image" ? <FullImage slide={slide} onOpen={onOpen} size={size} active={visible && Math.abs(i - index) <= 1} /> : <Player slide={slide} />}
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
