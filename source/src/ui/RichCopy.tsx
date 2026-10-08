import { tokenizeCopy } from "../lib/copy";

/** A copy (caption) with its hashtags, @mentions and links coloured like on the network. */
export function RichCopy({ text }: { text: string }) {
  return (
    <>
      {tokenizeCopy(text).map((token, i) => (token.type === "text" ? <span key={i}>{token.value}</span> : <span key={i} className={`sp-${token.type}`}>{token.value}</span>))}
    </>
  );
}
