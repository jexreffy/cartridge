import { useState, FormEvent } from 'react';
import { signIn, signUp, confirmSignUp } from '../auth';

type Mode = 'login' | 'signup' | 'confirm';

interface LoginProps {
  onSuccess: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.8rem', background: '#0e0e14',
  border: '1px solid #2a2a35', borderRadius: 6, color: '#e2e2e8',
  fontSize: '1rem', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', color: '#888',
  marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em',
};

export default function Login({ onSuccess }: LoginProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const friendlyError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UserNotFoundException') || msg.includes('NotAuthorizedException'))
      return 'Incorrect email or password.';
    if (msg.includes('UsernameExistsException'))
      return 'An account with this email already exists.';
    if (msg.includes('InvalidPasswordException'))
      return 'Password must be at least 8 characters and include uppercase, lowercase, and a number.';
    if (msg.includes('CodeMismatchException'))
      return 'Incorrect confirmation code. Please try again.';
    if (msg.includes('ExpiredCodeException'))
      return 'Code has expired. Please sign up again to receive a new code.';
    if (msg === 'NEW_PASSWORD_REQUIRED')
      return 'Account requires a password reset. Contact the administrator.';
    return msg;
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await signIn(email, password);
      onSuccess();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await signUp(email, password);
      setMode('confirm');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await confirmSignUp(email, code);
      // Auto sign in after confirmation
      await signIn(email, password);
      onSuccess();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0e0e14',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: '2.5rem',
        background: '#1a1a24', border: '1px solid #2a2a35', borderRadius: 12,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎮</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#e2e2e8' }}>Cartridge</h1>
          <p style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.4rem' }}>
            Your personal game taste predictor
          </p>
        </div>

        {/* Mode tabs */}
        {mode !== 'confirm' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {(['login', 'signup'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(''); }}
                style={{
                  flex: 1, padding: '0.5rem', background: mode === m ? '#6c3fff' : 'transparent',
                  border: `1px solid ${mode === m ? '#6c3fff' : '#2a2a35'}`,
                  borderRadius: 6, color: mode === m ? '#fff' : '#888',
                  fontSize: '0.9rem', cursor: 'pointer', fontWeight: mode === m ? 600 : 400,
                }}>
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
        )}

        {/* Sign in form */}
        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                required style={inputStyle} />
            </div>
            {error && <ErrorBox msg={error} />}
            <SubmitButton loading={loading} label="Sign in" />
          </form>
        )}

        {/* Sign up form */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUp}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus style={inputStyle} />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                required minLength={8} style={inputStyle} />
              <p style={{ fontSize: '0.75rem', color: '#555', marginTop: '0.4rem' }}>
                Min 8 characters, must include uppercase, lowercase, and a number.
              </p>
            </div>
            {error && <ErrorBox msg={error} />}
            <SubmitButton loading={loading} label="Create account" />
          </form>
        )}

        {/* Confirm form */}
        {mode === 'confirm' && (
          <form onSubmit={handleConfirm}>
            <p style={{ color: '#aaa', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              We sent a verification code to <strong style={{ color: '#e2e2e8' }}>{email}</strong>.
              Enter it below to activate your account.
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={labelStyle}>Verification code</label>
              <input type="text" value={code} onChange={e => setCode(e.target.value)}
                required autoFocus inputMode="numeric" pattern="[0-9]*"
                style={{ ...inputStyle, letterSpacing: '0.2em', fontSize: '1.25rem', textAlign: 'center' }} />
            </div>
            {error && <ErrorBox msg={error} />}
            <SubmitButton loading={loading} label="Confirm & sign in" />
            <button type="button" onClick={() => { setMode('signup'); setError(''); }}
              style={{ width: '100%', marginTop: '0.75rem', padding: '0.5rem',
                background: 'transparent', border: 'none', color: '#555',
                fontSize: '0.85rem', cursor: 'pointer' }}>
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <p style={{ color: '#f87171', fontSize: '0.875rem', marginBottom: '1rem',
      background: '#2a1a1a', padding: '0.6rem 0.8rem', borderRadius: 6,
      border: '1px solid #4a2a2a' }}>
      {msg}
    </p>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button type="submit" disabled={loading}
      style={{
        width: '100%', padding: '0.7rem', background: loading ? '#3a2a6a' : '#6c3fff',
        border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600,
        fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer',
      }}>
      {loading ? '…' : label}
    </button>
  );
}
