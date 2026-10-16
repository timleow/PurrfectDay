type GoogleSignInButtonProps = {
  busy?: boolean;
  onClick: () => void;
};

export default function GoogleSignInButton({ busy = false, onClick }: GoogleSignInButtonProps) {
  return (
    <button className="google-sign-in-button" disabled={busy} onClick={onClick} type="button">
      <svg aria-hidden="true" height="20" viewBox="0 0 48 48" width="20">
        <path d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" fill="#4285F4" />
        <path d="M24 44c5.5 0 10.2-1.8 13.6-4.9L31 34c-1.8 1.2-4.1 2-7 2-5.4 0-10-3.7-11.6-8.6H5.6v5.3A20 20 0 0 0 24 44Z" fill="#34A853" />
        <path d="M12.4 27.4a12 12 0 0 1 0-7v-5.3H5.6a20 20 0 0 0 0 17.6l6.8-5.3Z" fill="#FBBC05" />
        <path d="M24 11.8c3 0 5.7 1 7.8 3.1l5.9-5.9C34.2 5.6 29.5 4 24 4A20 20 0 0 0 5.6 15l6.8 5.3c1.6-4.9 6.2-8.5 11.6-8.5Z" fill="#EA4335" />
      </svg>
      <span>{busy ? "Connecting…" : "Continue with Google"}</span>
    </button>
  );
}
