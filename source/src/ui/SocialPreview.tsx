import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Social } from "../data/types";
import { copyStats, isStoryNetwork, needsMore, platformKind, type PlatformKind } from "../lib/copy";
import { RichCopy } from "./RichCopy";
import { BrandAvatar } from "./BrandAvatar";
import { parseDate } from "../lib/gantt";
import { PostMedia } from "./PostMedia";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Plus, Send, Share2 } from "./icons";

/**
 * The post as it will look on the network it goes out on: the media, the account, the action icons and the copy with
 * its hashtags, mentions and "more", updating while the copy is typed. Instagram and TikTok get their own look; any other
 * network falls back to the feed look. The heart and the double-tap are only for feel, nothing is saved.
 */

const BRAND = "O'Tacos";

interface SocialPreviewProps {
  copy: string;
  socials: Social[];
  /** Ids of the networks selected on the post. */
  selected: string[];
  format: string;
  asset: string;
  assetItems?: { type?: string; src?: string; fallback?: string; original?: string; label?: string }[];
  date: string;
  /** Called when the empty-copy hint is pressed (focus the copy field). */
  onWriteCopy?: () => void;
  /** Calendar use: just the phone screen (no network tabs, no counter); a press on the picture calls onOpen. */
  compact?: boolean;
  onOpen?: () => void;
}

export function SocialPreview({ copy, socials, selected, format, asset, assetItems, date, onWriteCopy, compact, onOpen }: SocialPreviewProps) {
  const options = useMemo(() => {
    const chosen = socials.filter((s) => selected.includes(s.id));
    return chosen.map((s) => ({ id: s.id, label: s.label, kind: platformKind(s), story: isStoryNetwork(s), color: s.color }));
  }, [socials, selected]);
  const [pickedId, setPickedId] = useState("");
  const current = options.find((o) => o.id === pickedId) ?? options[0];
  const kind: PlatformKind = current?.kind ?? "instagram";
  const story = Boolean(current?.story);
  const stats = copyStats(copy);

  return (
    <section className={`sp${compact ? " is-compact" : ""}`} aria-label="How the post will look">
      {compact ? null : options.length > 1 ? <PlatformTabs options={options} value={current.id} onChange={setPickedId} /> : (
        <p className="sp-platform">{current ? current.label : "Pick a social network to see its look"}</p>
      )}

      <div className={`sp-phone sp-${story ? "story" : kind === "tiktok" ? "tiktok" : "feed"}`}>
        {story ? (
          <StoryLook format={format} asset={asset} assetItems={assetItems} onOpen={onOpen} />
        ) : kind === "tiktok" ? (
          <TikTokLook copy={copy} format={format} asset={asset} assetItems={assetItems} onWriteCopy={onWriteCopy} onOpen={onOpen} />
        ) : (
          <FeedLook copy={copy} format={format} asset={asset} assetItems={assetItems} date={date} onWriteCopy={onWriteCopy} label={current?.label} onOpen={onOpen} />
        )}
      </div>

      {!compact && <p className="sp-count" aria-live="polite">
        {story ? "Stories go out without a caption." : (
          <>
            {stats.characters.toLocaleString("en-GB")}{kind === "instagram" || !current ? " / 2,200" : ""} characters
            {stats.hashtags > 0 && ` · ${stats.hashtags} hashtag${stats.hashtags === 1 ? "" : "s"}`}
          </>
        )}
      </p>}
    </section>
  );
}

/* ---------- platform switch: a thumb that slides ---------- */

function PlatformTabs({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className="sp-tabs" role="tablist" aria-label="Social network" style={{ ["--n" as string]: options.length, ["--i" as string]: index }}>
      <span className="sp-tabs-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button key={option.id} type="button" role="tab" aria-selected={option.id === value} onClick={() => onChange(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}

/* ---------- shared pieces ---------- */

const Avatar = BrandAvatar;

/** Caption as the feed shows it: name in bold, the copy after it, folded behind "more" when long. */
function Caption({ copy, lines, onWriteCopy, inline = true }: { copy: string; lines: number; onWriteCopy?: () => void; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = needsMore(copy);
  if (!copy.trim()) {
    return (
      <p className="sp-caption sp-empty">
        <strong>{BRAND}</strong> <span>Your caption will appear here.</span>{" "}
        {onWriteCopy && <button type="button" className="sp-link-btn" onClick={onWriteCopy}>Write the copy</button>}
      </p>
    );
  }
  return (
    <div className="sp-caption" id={id}>
      <p className={`sp-caption-text${long && !open ? " is-folded" : ""}`} style={{ ["--lines" as string]: lines }}>
        {inline && <strong>{BRAND}</strong>} <RichCopy text={copy} />
      </p>
      {long && (
        <button type="button" className="sp-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>{open ? "less" : "… more"}</button>
      )}
    </div>
  );
}

/** Heart that pops on press (a spring-like overshoot); only a feel, nothing is stored. */
function HeartButton({ liked, onToggle, light }: { liked: boolean; onToggle: () => void; light?: boolean }) {
  return (
    <button type="button" className={`sp-icon sp-heart${light ? " is-light" : ""}`} aria-pressed={liked} aria-label="Like (preview only)" onClick={onToggle}>
      <Heart />
    </button>
  );
}

function useBurst() {
  const [liked, setLiked] = useState(false);
  const [burst, setBurst] = useState(0);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const doubleTap = () => {
    setLiked(true);
    setBurst((n) => n + 1);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBurst(0), 800);
  };
  return { liked, setLiked, burst, doubleTap };
}

function BurstHeart({ burst }: { burst: number }) {
  return burst ? <span key={burst} className="sp-burst" aria-hidden="true"><Heart /></span> : null;
}

/* ---------- Instagram / generic feed ---------- */

function FeedLook({ copy, format, asset, assetItems, date, onWriteCopy, label, onOpen }: { copy: string; format: string; asset: string; assetItems: SocialPreviewProps["assetItems"]; date: string; onWriteCopy?: () => void; label?: string; onOpen?: () => void }) {
  const { liked, setLiked, burst, doubleTap } = useBurst();
  const day = date ? parseDate(date).toLocaleDateString("en-GB", { day: "numeric", month: "long" }).toUpperCase() : "";
  return (
    <article className="sp-feed">
      <header className="sp-head">
        <Avatar />
        <div className="sp-who">
          <strong>{BRAND}</strong>
          {label && <span>{label}</span>}
        </div>
        <MoreHorizontal aria-hidden className="sp-dots" />
      </header>
      <div className="sp-media" onDoubleClick={onOpen ? undefined : doubleTap}>
        <PostMedia asset={asset} assetItems={assetItems} format={format} size={onOpen ? "card" : "sheet"} onOpen={onOpen} />
        <BurstHeart burst={burst} />
      </div>
      <div className="sp-actions">
        <HeartButton liked={liked} onToggle={() => setLiked((v) => !v)} />
        <span className="sp-icon" aria-hidden="true"><MessageCircle /></span>
        <span className="sp-icon" aria-hidden="true"><Send /></span>
        <span className="sp-spacer" />
        <span className="sp-icon" aria-hidden="true"><Bookmark /></span>
      </div>
      <Caption copy={copy} lines={3} onWriteCopy={onWriteCopy} />
      {day && <p className="sp-date">{day}</p>}
    </article>
  );
}

/* ---------- TikTok ---------- */

function TikTokLook({ copy, format, asset, assetItems, onWriteCopy, onOpen }: { copy: string; format: string; asset: string; assetItems: SocialPreviewProps["assetItems"]; onWriteCopy?: () => void; onOpen?: () => void }) {
  const { liked, setLiked, burst, doubleTap } = useBurst();
  return (
    <article className="sp-tt">
      <div className="sp-tt-stage" onDoubleClick={onOpen ? undefined : doubleTap}>
        <PostMedia asset={asset} assetItems={assetItems} format={format} size={onOpen ? "card" : "sheet"} onOpen={onOpen} />
        <BurstHeart burst={burst} />
        <div className="sp-tt-shade" aria-hidden="true" />
        <div className="sp-tt-rail">
          <span className="sp-tt-follow"><Avatar size={44} /><i aria-hidden="true"><Plus /></i></span>
          <HeartButton liked={liked} onToggle={() => setLiked((v) => !v)} light />
          <span className="sp-icon is-light" aria-hidden="true"><MessageCircle /></span>
          <span className="sp-icon is-light" aria-hidden="true"><Bookmark /></span>
          <span className="sp-icon is-light" aria-hidden="true"><Share2 /></span>
        </div>
        <div className="sp-tt-bottom">
          <strong>{BRAND}</strong>
          <TikTokCaption copy={copy} onWriteCopy={onWriteCopy} />
        </div>
      </div>
    </article>
  );
}

function TikTokCaption({ copy, onWriteCopy }: { copy: string; onWriteCopy?: () => void }): ReactNode {
  return <Caption copy={copy} lines={2} inline={false} onWriteCopy={onWriteCopy} />;
}

/* ---------- Story: vertical, progress bar on top, no caption ---------- */

function StoryLook({ format, asset, assetItems, onOpen }: { format: string; asset: string; assetItems: SocialPreviewProps["assetItems"]; onOpen?: () => void }) {
  return (
    <article className="sp-story">
      <div className="sp-story-stage">
        <PostMedia asset={asset} assetItems={assetItems} format={format} size={onOpen ? "card" : "sheet"} onOpen={onOpen} />
        <div className="sp-story-top" aria-hidden="true">
          <span className="sp-story-bar"><i /></span>
          <span className="sp-story-who"><Avatar size={30} /><strong>{BRAND}</strong><em>now</em></span>
        </div>
      </div>
    </article>
  );
}
