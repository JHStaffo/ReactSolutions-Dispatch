import { useState } from 'react';
import type { AssignWarning } from '../../../shared/types';
import { ApiError, api } from '../api';
import type { Toast } from './Toasts';

export interface ConfirmState {
  title: string;
  body?: string;
  warnings?: AssignWarning[];
  input?: { label: string; placeholder?: string; required?: boolean };
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value?: string) => void | Promise<void>;
}

export function ConfirmModal({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const [value, setValue] = useState('');
  const disabled = !!state.input?.required && !value.trim();
  return (
    <div className="modal-backdrop">
      <form
        className="modal small"
        onSubmit={async (e) => {
          e.preventDefault();
          if (disabled) return;
          onClose();
          await state.onConfirm(value.trim());
        }}
      >
        <div className="modal-head">
          <h2>{state.title}</h2>
        </div>
        <div className="modal-body">
          {state.body && <p>{state.body}</p>}
          {state.warnings?.map((w) => (
            <div key={w.code} className={`banner ${w.code === 'ALS_TO_BLS' ? 'error' : 'warn'}`}>
              ⚠ {w.message}
            </div>
          ))}
          {state.input && (
            <label>
              {state.input.label}
              <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={state.input.placeholder} maxLength={200} />
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose} autoFocus={!state.input}>
            Go back
          </button>
          <button className={`btn ${state.danger ? 'danger' : 'primary'}`} disabled={disabled}>
            {state.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PasswordModal({ onClose, toast }: { onClose: () => void; toast: (t: string, k?: Toast['kind']) => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="modal-backdrop">
      <form
        className="modal small"
        onSubmit={async (e) => {
          e.preventDefault();
          if (next !== confirm) return setError('New passwords do not match.');
          try {
            await api('auth/change-password', { body: { currentPassword: cur, newPassword: next } });
            toast('Password changed', 'success');
            onClose();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Failed');
          }
        }}
      >
        <div className="modal-head">
          <h2>Change password</h2>
        </div>
        <div className="modal-body">
          {error && <div className="banner error">{error}</div>}
          <label>
            Current password
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
          </label>
          <label>
            New password (12+ characters)
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
          </label>
          <label>
            Confirm new password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Change password</button>
        </div>
      </form>
    </div>
  );
}
