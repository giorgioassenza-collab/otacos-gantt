import { Component, type ErrorInfo, type ReactNode } from "react";

/** A lazy chunk that no longer exists on the server (the app was redeployed while the page was open). */
export function isChunkError(error: unknown): boolean {
  const text = `${(error as Error)?.name ?? ""} ${(error as Error)?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(text);
}

const RELOAD_KEY = "otw2.chunkReload";

/** Reload once to pick up the new version; the guard stops a reload loop if the problem is something else. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 15000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  /** Short name of the part that failed, shown in the message. */
  label?: string;
  /** When true the fallback is small and inline (a sheet or a view) instead of a full screen. */
  inline?: boolean;
  onReset?: () => void;
}

interface State { error: Error | null }

/**
 * Keeps a crash in one part of the app from turning the whole screen blank: shows what happened and a way back.
 * A stale chunk after a new version is published is fixed by reloading, so that case reloads by itself once.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen crashed:", error, info.componentStack);
    if (isChunkError(error)) reloadOnce();
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className={`crash${this.props.inline ? " is-inline" : ""}`} role="alert">
        <h2>{chunk ? "A new version is available" : "Something went wrong"}</h2>
        <p>
          {chunk
            ? "The app was updated while this page was open. Reload to continue."
            : `${this.props.label ?? "This screen"} hit an error. Your data is safe.`}
        </p>
        {!chunk && <pre className="crash-detail">{error.message}</pre>}
        <div className="crash-actions">
          {!chunk && <button type="button" className="btn" onClick={this.reset}>Try again</button>}
          <button type="button" className="btn btn--primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
