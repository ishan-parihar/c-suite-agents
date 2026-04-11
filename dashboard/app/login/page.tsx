'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/';

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(from);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Authentication failed');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0E27] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-bold text-white tracking-tight"
            style={{ fontFamily: 'var(--font-fira-code), monospace' }}
          >
            Operant
          </h1>
          <p className="text-[#A1A1AA] mt-2 text-sm">
            Operations Dashboard
          </p>
        </div>

        <div
          className="rounded-xl border p-8"
          style={{
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-default)',
          }}
        >
          <h2 className="text-lg font-semibold text-white mb-6">
            Sign In
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[#A1A1AA] mb-2"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                className="w-full px-3 py-2.5 rounded-lg border text-white placeholder-[#71717A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
                placeholder="Enter dashboard password"
              />
            </div>

            {error && (
              <div
                className="mb-6 px-3 py-2.5 rounded-lg text-sm"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#EF4444',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-2.5 rounded-lg font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2563EB]"
              style={{
                background: 'var(--accent-primary)',
              }}
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
