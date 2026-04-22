"use client";

import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname();

  // Hide footer on full-screen game route
  if (pathname.startsWith("/game")) return null;

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-6">
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Netrek
        </p>
      </div>
    </footer>
  );
}
