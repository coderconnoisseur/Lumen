"use client";

import { useEffect, useState } from "react";

// Google sends the popup here. Hand the result to the opener (see components/gmailOAuthButton.tsx) and close.
export default function GmailOAuthCallback() {
  const [message, setMessage] = useState("Finishing sign-in...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const origin = window.location.origin;

    if (error || !code || !state) {
      const text = error ? `Google said: ${error}` : "No sign-in code received";
      window.opener?.postMessage({ type: "gmail-oauth-error", error: text }, origin);
      setMessage(`${text}. You can close this window.`);
    } else {
      window.opener?.postMessage({ type: "gmail-oauth-callback", code, state }, origin);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("gmail-oauth");
        channel.postMessage({ type: "gmail-oauth-callback", code, state });
        channel.close();
      }
      try {
        sessionStorage.setItem("gmail_oauth_result", JSON.stringify({ code, state, timestamp: Date.now() }));
      } catch {
        // storage blocked; the other two channels still work
      }
      setMessage("Connected. You can close this window.");
    }
    window.close();
  }, []);

  return <p className="p-8 text-center text-sm text-muted-foreground">{message}</p>;
}
