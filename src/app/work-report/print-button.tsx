"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer className="h-4 w-4" /> Print or save as PDF
    </Button>
  );
}
