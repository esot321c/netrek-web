export default function KeymapPage() {
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
      <h1 style={{ color: "#ffff00", fontSize: 20 }}>
        Netrek Default Commands
      </h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Original Netrek keyboard bindings. Commands marked with ✓ are
        implemented in the web version.
      </p>

      <Section title="Lowercase Commands">
        <KeyTable
          rows={[
            ["b", "Bomb Planet", true],
            ["c", "Cloak/uncloak", true],
            ["d", "Detonate enemy Torp", true],
            ["e", "Toggle docking permission (SB only)", false],
            ["f", "Plasma torpedo", false],
            ["h", "Help window", true],
            ["i", "Information", true],
            ["k", "Set course (at mouse)", false],
            ["l", "Lock onto object (at mouse)", true],
            ["m", "Start sending message", true],
            ["o", "Orbit", false],
            ["p", "Phasers", false],
            ["q", "Quit game quickly", false],
            ["r", "Refit", false],
            ["s", "Shields", true],
            ["t", "Torpedo", false],
            ["w", "Change war declaration", false],
            ["x", "Beam down", true],
            ["y", "Pressor beam", true],
            ["z", "Beam up", true],
          ]}
        />
      </Section>

      <Section title="Uppercase Commands">
        <KeyTable
          rows={[
            ["D", "Detonate your own Torps", true],
            ["E", "Send generic distress call", false],
            ["F", "Send 'armies carried' report", false],
            ["L", "Players list", true],
            ["M", "Toggle Message Log", false],
            ["N", "Toggle Long/Short Planet Names", false],
            ["O", "Options Window", false],
            ["R", "Enter Repair mode", true],
            ["S", "Toggle Stats Window", false],
            ["T", "Tractor Beam", true],
            ["X", "Enter Macro Mode", true],
          ]}
        />
      </Section>

      <Section title="Number Keys">
        <KeyTable
          rows={[
            ["0-9", "Set warp speed 0-9", true],
            [")", "Warp 10", true],
            ["!", "Warp 11", true],
            ["@", "Warp 12", true],
            ["%", "Maximum warp", true],
            ["$", "Tractor/pressor off", false],
            ["^", "Pressor beam ON", false],
            ["<", "Decrease Warp by one", false],
            [">", "Increase Warp by one", false],
          ]}
        />
      </Section>

      <Section title="Mouse Controls (Web Version)">
        <KeyTable
          rows={[
            ["Left click", "Fire torpedoes", true],
            ["Shift+Left / Middle", "Fire phasers", true],
            ["Right click", "Set course", true],
          ]}
        />
      </Section>

      <Section title="Chat &amp; Macros">
        <KeyTable
          rows={[
            ["m", "Start sending message", true],
            ["X + key", "Fire macro", true],
            ["Enter", "Send message", true],
            ["Escape", "Cancel message", true],
          ]}
        />
        <p style={{ color: "#666", marginTop: 8 }}>
          See{" "}
          <a href="/docs/macros" style={{ color: "#44ffff" }}>
            Macro Reference
          </a>{" "}
          for details.
        </p>
      </Section>

      <div style={{ marginTop: 32, color: "#555" }}>
        <a href="/lobby" style={{ color: "#44ffff" }}>
          ← Back to Lobby
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

function KeyTable({ rows }: { rows: [string, string, boolean][] }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <tbody>
        {rows.map(([key, desc, implemented], i) => (
          <tr key={i} style={{ borderBottom: "1px solid #111" }}>
            <td
              style={{ padding: "2px 12px 2px 0", color: "#fff", width: 120 }}
            >
              {key}
            </td>
            <td
              style={{
                padding: "2px 8px",
                color: implemented ? "#aaa" : "#555",
              }}
            >
              {desc}
            </td>
            <td
              style={{
                padding: "2px 0",
                color: implemented ? "#44ff44" : "#444",
                width: 20,
              }}
            >
              {implemented ? "✓" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
