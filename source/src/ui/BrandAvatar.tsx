/** The O'Tacos account picture used in the post looks (feed, story, calendar card). */
export function BrandAvatar({ size = 32, ring = false }: { size?: number; ring?: boolean }) {
  return (
    <span className={`sp-avatar${ring ? " has-ring" : ""}`} style={{ ["--s" as string]: `${size}px` }} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}otacos-logo.svg`} alt="" draggable={false} />
    </span>
  );
}
