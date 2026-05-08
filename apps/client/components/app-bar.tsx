"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { useAuth } from "@/lib/auth-context";
import { Crosshair, Menu, X } from "lucide-react";

const navItems = [{ label: "Lobby", href: "/lobby" }];

export function AppBar() {
  const pathname = usePathname();
  const { user, isGuest } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hide AppBar on full-screen game route
  if (pathname.startsWith("/game")) return null;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-gray-950">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Crosshair className="h-5 w-5" />
          Netrek
        </Link>

        {(user || isGuest) && (
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  pathname === item.href
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <UserMenu />
          </div>
          {(user || isGuest) && (
            <button
              className="rounded-md p-2 text-muted-foreground hover:text-foreground md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (user || isGuest) && (
        <div className="border-t bg-background px-4 py-4 md:hidden">
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  pathname === item.href
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 border-t" />
            <div className="px-2 py-2">
              <UserMenu />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
