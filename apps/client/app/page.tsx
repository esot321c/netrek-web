"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-300">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-4 py-24 text-center">
        <h1 className="text-6xl font-bold tracking-tight text-yellow-500 sm:text-7xl">
          Netrek
        </h1>
        <p className="mt-4 max-w-xl text-xl text-gray-400">
          Browser-based multiplayer space combat. Two teams, 40 planets,
          capture-the-flag with armies.
        </p>
        <div className="mt-8">
          {loading ? (
            <span className="text-gray-500">Loading...</span>
          ) : user ? (
            <Link
              href="/lobby"
              className="inline-block rounded bg-yellow-500 px-8 py-3 text-lg font-semibold text-gray-900 hover:bg-yellow-400 transition-colors"
            >
              Enter Lobby
            </Link>
          ) : (
            <Link
              href="/auth/signin"
              className="inline-block rounded bg-yellow-500 px-8 py-3 text-lg font-semibold text-gray-900 hover:bg-yellow-400 transition-colors"
            >
              Sign In to Play
            </Link>
          )}
        </div>
      </section>

      {/* What is Netrek */}
      <section className="mx-auto max-w-4xl px-4 py-12 border-t border-gray-800">
        <h2 className="text-2xl font-bold text-yellow-500 mb-4">
          What is Netrek?
        </h2>
        <p className="text-gray-300 leading-relaxed">
          Netrek is one of the oldest surviving multiplayer online games, first
          developed in 1988. It is a team-based space combat game where two
          teams of up to 8 players each fight for control of 40 planets. Each
          team must conquer enemy planets by bombing armies and beaming down
          their own, ultimately triggering T-Mode (tournament mode) and racing
          to capture the enemy home worlds.
        </p>
        <p className="mt-4 text-gray-300 leading-relaxed">
          This is a faithful browser-based clone of Bronco Netrek (Vanilla),
          preserving the original game mechanics, feel, and spirit while making
          it accessible from any modern browser.
        </p>
      </section>

      {/* How to Play */}
      <section className="mx-auto max-w-4xl px-4 py-12 border-t border-gray-800">
        <h2 className="text-2xl font-bold text-yellow-500 mb-6">How to Play</h2>

        <div className="grid gap-8 sm:grid-cols-2">
          {/* Movement */}
          <div>
            <h3 className="text-lg font-semibold text-yellow-600 mb-3">
              Movement
            </h3>
            <ul className="space-y-1 text-sm text-gray-400">
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">
                  0–9
                </kbd>{" "}
                — Set warp speed 0–9
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">)</kbd>{" "}
                — Warp 10
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">!</kbd>{" "}
                — Warp 11
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">@</kbd>{" "}
                — Warp 12
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">%</kbd>{" "}
                — Maximum speed
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">
                  Right click
                </kbd>{" "}
                — Set course to cursor
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">l</kbd>{" "}
                — Lock onto nearest entity
              </li>
            </ul>
          </div>

          {/* Combat */}
          <div>
            <h3 className="text-lg font-semibold text-yellow-600 mb-3">
              Combat
            </h3>
            <ul className="space-y-1 text-sm text-gray-400">
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">
                  Left click
                </kbd>{" "}
                — Fire torpedoes toward cursor
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">
                  Shift+Left / Middle
                </kbd>{" "}
                — Fire phasers
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">s</kbd>{" "}
                — Toggle shields
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">c</kbd>{" "}
                — Toggle cloak
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">d</kbd>{" "}
                — Detonate enemy torpedoes
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">D</kbd>{" "}
                — Detonate own torpedoes
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">r</kbd>{" "}
                — Toggle repair mode
              </li>
            </ul>
          </div>

          {/* Planets */}
          <div>
            <h3 className="text-lg font-semibold text-yellow-600 mb-3">
              Planets
            </h3>
            <ul className="space-y-1 text-sm text-gray-400">
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">b</kbd>{" "}
                — Bomb enemy planet
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">z</kbd>{" "}
                — Beam up armies
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">x</kbd>{" "}
                — Beam down armies
              </li>
              <li className="text-gray-500 pt-1">
                Capture 3+ enemy planets to trigger T-Mode and win.
              </li>
            </ul>
          </div>

          {/* Special */}
          <div>
            <h3 className="text-lg font-semibold text-yellow-600 mb-3">
              Special
            </h3>
            <ul className="space-y-1 text-sm text-gray-400">
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">T</kbd>{" "}
                — Tractor beam toggle
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">y</kbd>{" "}
                — Pressor beam toggle
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">L</kbd>{" "}
                — Toggle player list
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">i</kbd>{" "}
                — Info on nearest entity
              </li>
              <li>
                <kbd className="bg-gray-800 text-gray-200 px-1 rounded">h</kbd>{" "}
                — Toggle help window
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Ship Classes */}
      <section className="mx-auto max-w-4xl px-4 py-12 border-t border-gray-800">
        <h2 className="text-2xl font-bold text-yellow-500 mb-6">
          Ship Classes
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              code: "SC",
              name: "Scout",
              desc: "Fast and agile. Low armor, best for reconnaissance and quick raids.",
            },
            {
              code: "DD",
              name: "Destroyer",
              desc: "Balanced speed and firepower. The workhorse of fleet combat.",
            },
            {
              code: "CA",
              name: "Cruiser",
              desc: "Heavy firepower with good shields. Excellent for sustained combat.",
            },
            {
              code: "BB",
              name: "Battleship",
              desc: "Maximum firepower and armor. Slow but devastating in battle.",
            },
            {
              code: "AS",
              name: "Assault Ship",
              desc: "Specialized for carrying armies and planet capture operations.",
            },
            {
              code: "SB",
              name: "Starbase",
              desc: "Enormous stationary fortress. Repairs allies and dominates sectors.",
            },
          ].map((ship) => (
            <div
              key={ship.code}
              className="rounded border border-gray-700 bg-gray-800 p-4"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xl font-bold text-yellow-500 font-mono">
                  {ship.code}
                </span>
                <span className="font-semibold text-gray-200">{ship.name}</span>
              </div>
              <p className="text-sm text-gray-400">{ship.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-800 py-8 text-center text-sm text-gray-600">
        Netrek Web — a browser clone of Bronco Netrek
      </footer>
    </div>
  );
}
