// hendri.design, from brands/hendri/identity/tokens.json (2026-11-10).
// The page loads the fonts; the panel only names them (a shadow root can't load fonts).
export default {
  font: '"Space Grotesk", system-ui, sans-serif',
  mono: '"Fragment Mono", ui-monospace, Menlo, monospace',
  radius: "16px", // radius.card
  radiusSm: "8px", // radius.tight
  light: {
    bg: "#f3f6f8", // paper
    surface: "#ffffff", // white
    field: "#f3f6f8", // paper, inside white cards
    fill: "#c6d4db", // mist
    text: "#1f262d", // slate
    muted: "#40525e", // slate-muted
    line: "#c6d4db", // mist
    accent: "#574cff", // cobalt
    onAccent: "#ffffff",
    focus: "#e2680a", // ember: annotations, so it reads as "you are here"
  },
  dark: {
    bg: "#1f262d", // slate
    surface: "#28313a", // slate-raised
    field: "#1f262d",
    fill: "#3a464f", // mist-dark
    text: "#f3f6f8", // paper
    muted: "#9aa9b4", // fog
    line: "#3a464f",
    accent: "#8b83ff", // cobalt-light
    onAccent: "#1f262d", // white on cobalt-light fails AA, slate passes
    focus: "#ff8a3d", // ember-light
  },
};
