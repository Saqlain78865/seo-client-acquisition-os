"use client";

import { AlertTriangle } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";

// Never render the raw error: it may contain internal details. The digest lets us find it in server logs.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Something went wrong"
        description={`This page could not be loaded.${error.digest ? ` Reference: ${error.digest}` : ""}`}
        action={<Button onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
