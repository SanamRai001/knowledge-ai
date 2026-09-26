import React, {
  useState,
} from 'react';
import {
  AlertCircle,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  ServerCog,
  TimerReset,
} from 'lucide-react';
import type {
  ShellState,
} from '../session';

interface SessionBoundaryProps {
  state: ShellState;
  onRetry: () => void;
  onLogin: (
    email: string,
    password: string
  ) => Promise<void>;
  isLoggingIn: boolean;
}

export const SessionBoundary: React.FC<
  SessionBoundaryProps
> = ({
  state,
  onRetry,
  onLogin,
  isLoggingIn,
}) => {
  const [email, setEmail] =
    useState('');
  const [password, setPassword] =
    useState('');

  if (state.status === 'bootstrapping') {
    return (
      <ShellCard
        icon={
          <LoaderCircle className="w-5 h-5 animate-spin" />
        }
        title="Loading Knowledge AI"
        message="Checking your session and workspace access."
      />
    );
  }

  if (
    state.status ===
    'session-required'
  ) {
    return (
      <div
        id="session-required-state"
        className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <LockKeyhole className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900">
                Sign in to Knowledge AI
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Your browser session is required before company data can load.
              </p>
            </div>
          </div>

          {state.message && (
            <p className="text-xs text-slate-600 mb-4">
              {state.message}
            </p>
          )}

          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              await onLogin(
                email,
                password
              );
            }}
          >
            <label className="block">
              <span className="text-xs font-medium text-slate-700">
                Email
              </span>
              <input
                id="auth-login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">
                Password
              </span>
              <input
                id="auth-login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <button
              id="auth-login-submit"
              type="submit"
              disabled={
                isLoggingIn ||
                !email.trim() ||
                !password
              }
              className="w-full rounded-lg bg-slate-900 text-white text-sm font-medium py-2.5 disabled:opacity-50"
            >
              {isLoggingIn
                ? 'Signing in…'
                : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (
    state.status ===
    'permission-denied'
  ) {
    return (
      <ShellCard
        id="permission-denied-state"
        icon={
          <ShieldAlert className="w-5 h-5" />
        }
        title="Access is not available"
        message={
          state.message ||
          'Your current membership does not allow this workspace.'
        }
        code={state.code}
        onRetry={onRetry}
      />
    );
  }

  if (state.status === 'rate-limited') {
    return (
      <ShellCard
        id="rate-limited-state"
        icon={
          <TimerReset className="w-5 h-5" />
        }
        title="Too many requests"
        message={
          state.message ||
          'Try again shortly.'
        }
        code={state.code}
        detail={
          state.retryAfterSeconds
            ? 'Retry after ' +
              state.retryAfterSeconds +
              ' seconds.'
            : undefined
        }
        onRetry={onRetry}
      />
    );
  }

  if (state.status === 'degraded') {
    return (
      <ShellCard
        id="degraded-dependency-state"
        icon={
          <ServerCog className="w-5 h-5" />
        }
        title="Knowledge AI is temporarily unavailable"
        message={
          state.message ||
          'A required production dependency is not ready.'
        }
        code={state.code}
        onRetry={onRetry}
      />
    );
  }

  return (
    <ShellCard
      id="shell-error-state"
      icon={
        <AlertCircle className="w-5 h-5" />
      }
      title="Knowledge AI could not load"
      message={
        state.message ||
        'An unexpected error occurred.'
      }
      code={state.code}
      onRetry={onRetry}
    />
  );
};

function ShellCard(props: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  message: string;
  detail?: string;
  code?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      id={props.id}
      className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
    >
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mb-4">
          {props.icon}
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          {props.title}
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          {props.message}
        </p>
        {props.detail && (
          <p className="text-xs text-slate-500 mt-2">
            {props.detail}
          </p>
        )}
        {props.code && (
          <p className="text-[11px] font-mono text-slate-400 mt-3">
            {props.code}
          </p>
        )}
        {props.onRetry && (
          <button
            onClick={props.onRetry}
            className="mt-5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
