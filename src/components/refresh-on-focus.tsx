"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Reloads the page's data when the user comes back to the window — e.g. after finishing Google
 * sign-in in the browser, the new connection shows without pressing refresh.
 */
export function RefreshOnFocus() {
  const router = useRouter();
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && router.refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);
  return null;
}
