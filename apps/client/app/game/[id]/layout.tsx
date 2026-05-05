export default function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Full-screen layout — no AppBar, no footer
  return <>{children}</>;
}
