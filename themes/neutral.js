// The default look: warm greys, no brand colour. Every other theme fills the same keys.
export default {
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  radius: "10px",
  radiusSm: "7px",
  light: {
    bg: "#f1f1ef", // the panel ground
    surface: "#ffffff", // section cards, the raised segment
    field: "#ebebe8", // every control row
    fill: "#d6d6d1", // how far a number is along its range
    text: "#18181a",
    muted: "#55554f", // secondary text, AA on field
    line: "#e0e0dc",
    accent: "#18181a", // Copy values, On, the edited bar
    onAccent: "#ffffff",
    focus: "#2f6fed",
  },
  dark: {
    bg: "#141416",
    surface: "#1e1e21",
    field: "#28282c",
    fill: "#3d3d43",
    text: "#ececea",
    muted: "#a6a6a1",
    line: "#2e2e33",
    accent: "#ececea",
    onAccent: "#141416",
    focus: "#7aa2ff",
  },
};
