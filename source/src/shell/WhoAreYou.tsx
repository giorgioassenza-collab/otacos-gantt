import { useIdentity } from "../lib/identity";
import { TEAM } from "../lib/team";
import { initials } from "../lib/gantt";

/** Shown once after the password: who is using this device. Personalises notifications, nothing else. */
export function WhoAreYou() {
  const { choose } = useIdentity();
  return (
    <main className="login who">
      <div className="login-card who-card">
        <div className="login-brand">
          <img src={`${import.meta.env.BASE_URL}otacos-logo.svg`} alt="O'Tacos" />
          <h1 className="login-title">Who are you?</h1>
        </div>
        <p className="login-note">Pick your name. You will see everything, plus a bell with what is waiting for you.</p>
        <div className="who-grid" role="group" aria-label="Choose your name">
          {TEAM.map((name, index) => (
            <button key={name} type="button" className="who-btn" onClick={() => choose(name)} data-autofocus={index === 0 ? true : undefined}>
              <span className="who-avatar" aria-hidden="true">{initials(name)}</span>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
