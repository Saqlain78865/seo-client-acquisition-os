"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this page view.
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
      aria-label="Toggle dark mode"
    >
      <Moon className="h-4 w-4 dark:hidden" />
      <Sun className="hidden h-4 w-4 dark:block" />
    </button>
  );
}
