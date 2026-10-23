import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const firstRun = (await db.user.count()) === 0;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back. Sign in to your workspace.</p>
      <LoginForm />
      {firstRun && (
        <p className="mt-6 text-center text-sm text-muted">
          First time here?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create the owner account
          </Link>
        </p>
      )}
    </div>
  );
}
