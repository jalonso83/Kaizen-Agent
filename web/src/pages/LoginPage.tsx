import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { Partner } from '../types';

interface Props {
  onLoggedIn: (partner: Partner) => void;
}

export function LoginPage({ onLoggedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const partner = await api.login(email.trim().toLowerCase(), password);
      onLoggedIn(partner);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <span className="brand">Kaizen</span>
        <p className="login-sub">El agente de crecimiento de FinZen AI.</p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
