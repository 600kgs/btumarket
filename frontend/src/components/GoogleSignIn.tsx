import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { API } from "../lib/api";

declare global {
  interface Window {
    google?: any;
  }
}

let gsiScriptPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (!gsiScriptPromise) {
    gsiScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return gsiScriptPromise;
}

interface GoogleSignInProps {
  onCredential: (credential: string) => void;
}

// Renders a "Sign in with Google" button if the backend has
// MARKETPLACE_GOOGLE_CLIENT_ID configured; renders nothing (no error) if
// not, so login/register work fine before that's set up. Also renders the
// "or" divider above the button, shown only once the button itself is ready.
export default function GoogleSignIn({ onCredential }: GoogleSignInProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let clientId = "";
      try {
        const res = await fetch(`${API}/public-config`);
        clientId = (await res.json()).google_client_id || "";
      } catch {
        return; // backend unreachable - just skip the button
      }
      if (!clientId || cancelled) return;

      try {
        await loadGsiScript();
      } catch {
        return; // offline / blocked - skip the button
      }
      if (cancelled || !containerRef.current || !window.google) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        width: 280,
      });
      if (dividerRef.current) dividerRef.current.style.display = "";
    })();

    return () => {
      cancelled = true;
    };
    // onCredential is expected to be stable (defined once per page); rerunning
    // this effect would re-init the GSI button unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={dividerRef} className="auth-divider" style={{ display: "none" }}>
        <span>{t("or_divider")}</span>
      </div>
      {/* minHeight reserves space so the hint below never jumps up into the
          button (and can't overlap the taller personalized "Sign in as…"
          variant) before the async GSI button finishes rendering. */}
      <div ref={containerRef} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />
    </>
  );
}
