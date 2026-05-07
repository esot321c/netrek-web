export default function MacrosPage() {
  return (
    <div
      style={{
        background: "#000",
        color: "#aaa",
        fontFamily: "monospace",
        fontSize: 13,
        padding: 32,
        minHeight: "100vh",
        maxWidth: 800,
        margin: "0 auto",
      }}
    >
      <h1 style={{ color: "#ffff00", fontSize: 20 }}>Netrek Macro System</h1>

      <Section title="How Macros Work">
        <p>
          Press <K>X</K> to enter macro mode, then press a macro key to send a
          pre-defined message.
        </p>
        <p>
          If the macro has a preset destination (team or all), it sends
          immediately.
        </p>
        <p>If not, you{"'"}ll be prompted to choose a destination:</p>
        <ul style={{ marginLeft: 16, marginTop: 4 }}>
          <li>
            <K>T</K> — send to your team
          </li>
          <li>
            <K>A</K> — send to all players
          </li>
          <li>
            <K>0-9</K>, <K>a-f</K> — send to a specific player slot
          </li>
        </ul>
      </Section>

      <Section title="Default Macros">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "2px 12px 2px 0",
                  color: "#666",
                }}
              >
                Key
              </th>
              <th
                style={{ textAlign: "left", padding: "2px 8px", color: "#666" }}
              >
                Dest
              </th>
              <th
                style={{ textAlign: "left", padding: "2px 8px", color: "#666" }}
              >
                Message
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ["b", "Team", "bombing %l"],
              ["e", "Team", "need escort to %l, carrying %a"],
              ["f", "Team", "%T%c carrying %a armies, headed to %l"],
              ["h", "Team", "help at %l!"],
              ["1", "Team", "I need fuel!  %f%% fuel left"],
              ["2", "Team", "I need repair!  %d%% damage"],
              ["3", "Team", "ogg %p"],
              ["4", "Team", "defending %l"],
              ["5", "All", "good game!"],
            ].map(([key, dest, text], i) => (
              <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                <td style={{ padding: "2px 12px 2px 0", color: "#fff" }}>
                  {key}
                </td>
                <td style={{ padding: "2px 8px", color: "#888" }}>{dest}</td>
                <td style={{ padding: "2px 8px", color: "#aaa" }}>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Substitution Variables">
        <p style={{ marginBottom: 8 }}>
          Use <K>%</K> codes in macro text. They are replaced with live game
          data when the macro fires.
        </p>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "2px 12px 2px 0",
                  color: "#666",
                }}
              >
                Code
              </th>
              <th
                style={{ textAlign: "left", padding: "2px 8px", color: "#666" }}
              >
                Expands to
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ["%a", "Armies carried"],
              ["%d", "Damage percentage"],
              ["%s", "Shield percentage"],
              ["%f", "Fuel percentage"],
              ["%w", "Weapon temperature %"],
              ["%e", "Engine temperature %"],
              ["%W", "1 if weapon-temped, 0 if not"],
              ["%E", "1 if engine-temped, 0 if not"],
              ["%k", "Kill count"],
              ["%S", "Ship type (SC, DD, CA, BB, AS, SB)"],
              ["%T", "Team character (F, R, K, O)"],
              ["%o", "Team name (Fed, Rom, Kli, Ori)"],
              ["%c", "Your slot digit"],
              ["%i", "Your player name"],
              ["%l", "Nearest planet name"],
              ["%n", "Armies on nearest planet"],
              ["%t", "Team character of nearest planet"],
              ["%z", "Team name of nearest planet"],
              ["%p", "Nearest enemy player ID"],
              ["%u", "Nearest enemy player name"],
              ["%g", "Nearest friendly player ID"],
              ["%b", "Nearest planet name (same as %l)"],
              ["%%", "Literal % character"],
            ].map(([code, desc], i) => (
              <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                <td style={{ padding: "2px 12px 2px 0", color: "#44ffff" }}>
                  {code}
                </td>
                <td style={{ padding: "2px 8px" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Planned Features">
        <ul style={{ marginLeft: 16 }}>
          <li>
            Conditional expressions:{" "}
            <code style={{ color: "#555" }}>
              {"%?%n>4%{bomb %l at %n%!bomb%}"}
            </code>
          </li>
          <li>Single-key macros (no X prefix)</li>
          <li>Macro editor UI</li>
          <li>Custom keymap remapping</li>
        </ul>
      </Section>

      <div style={{ marginTop: 32, color: "#555" }}>
        <a href="/docs/keymap" style={{ color: "#44ffff" }}>
          Keymap Reference
        </a>
        {" | "}
        <a href="/lobby" style={{ color: "#44ffff" }}>
          Back to Lobby
        </a>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ color: "#ffff00", fontSize: 15, marginBottom: 8 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        background: "#222",
        border: "1px solid #444",
        padding: "0 4px",
        borderRadius: 2,
        color: "#fff",
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}
