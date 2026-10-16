import type { ReactNode } from "react";
import GoogleSignInButton from "./GoogleSignInButton";
import "./SignInScreen.css";

type SignInScreenProps = {
  busy: boolean;
  error: string;
  loading: boolean;
  onSignIn: () => void;
  toolbar: ReactNode;
};

export default function SignInScreen({ busy, error, loading, onSignIn, toolbar }: SignInScreenProps) {
  return (
    <main className="sign-in-screen">
      <header className="sign-in-header">
        <a aria-label="Purrfect day" className="sign-in-brand" href="#">
          <span aria-hidden="true" className="sign-in-brand-mark">✦</span>
          <span>Purrfect<span>day</span></span>
        </a>
        {toolbar}
      </header>
      <section aria-busy={loading} aria-labelledby="sign-in-title" className="sign-in-card">
        <span aria-hidden="true" className="sign-in-paw">🐾</span>
        <span className="sign-in-eyebrow">A little care, shared</span>
        <h1 id="sign-in-title">Welcome to Purrfectday</h1>
        <p>Sign in to see your family’s cats and keep their care in sync.</p>
        {loading ? (
          <div aria-live="polite" className="sign-in-loading"><span className="sign-in-spinner" />Checking your sign-in…</div>
        ) : (
          <GoogleSignInButton busy={busy} onClick={onSignIn} />
        )}
        {error && <p className="sign-in-error" role="alert">{error}</p>}
      </section>
      <p className="sign-in-footer">Your family’s care notes stay together.</p>
    </main>
  );
}
