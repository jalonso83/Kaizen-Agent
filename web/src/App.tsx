import { useEffect, useState } from 'react';
import { api } from './api';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';
import type { Partner } from './types';

// Router mínimo (DISENO §10): sin librería de rutas, dos pantallas,
// condicionado a si GET /api/auth/me resuelve o no.
export default function App() {
  const [partner, setPartner] = useState<Partner | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setPartner)
      .catch(() => setPartner(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;

  if (!partner) return <LoginPage onLoggedIn={setPartner} />;

  return <ChatPage partner={partner} onLoggedOut={() => setPartner(null)} />;
}
