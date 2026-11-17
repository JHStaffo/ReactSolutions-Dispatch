import { useState } from 'react';
import type { SessionUser } from '../../../shared/types';
import { ApiError, api } from '../api';

export function Login({ notice, onLogin }: { notice: string; onLogin: (s: { user: SessionUser; idleTimeoutMs: number }) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await api('auth/login', { body: { username, password } });
      setPassword('');
      onLogin(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit} autoComplete="on">
        <div className="brand big">
          <span className="brand-mark">✚</span> ReactSolutions <b>Dispatch</b>
        </div>
        <p className="muted">Non-emergency medical transport</p>
        {notice && <div className="banner warn">{notice}</div>}
        {error && <div className="banner error">{error}</div>}
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="legal">
          This system contains protected health information. Access is limited to authorized personnel, and all activity is logged
          and audited.
        </p>
      </form>
    </div>
  );
}
