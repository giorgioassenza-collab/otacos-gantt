import { useState, type FormEvent } from "react";
import { useBoard } from "../store";

const TEAM_EMAIL = "team@otacos-workflow.app";

export function Login() {
  const { state, sync } = useBoard();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try { await sync.login(password); } finally { setBusy(false); }
  }

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-brand">
          <img src={`${import.meta.env.BASE_URL}otacos-logo.svg`} alt="O'Tacos" />
          <h1 className="login-title">Workflow</h1>
        </div>
        <form className="login-form" onSubmit={submit}>
          {/* username is fixed; it is here so password managers can match the account */}
          <input type="email" name="username" autoComplete="username" value={TEAM_EMAIL} readOnly hidden />
          <div className="field">
            <label htmlFor="pw">Team password</label>
            <input
              id="pw" className="input" type="password" name="password" autoComplete="current-password"
              value={password} onChange={(event) => setPassword(event.target.value)} autoFocus
              aria-invalid={Boolean(state.authError)} aria-describedby="pw-error"
            />
          </div>
          <p className="login-error" id="pw-error" role="alert">{state.authError}</p>
          <button className="btn btn--primary btn--block" type="submit" disabled={!password || busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="login-note">One shared password for the whole team. Ask the team lead if you don't have it.</p>
      </div>
    </main>
  );
}
