// For Font's Sake, from brands/fontsake/identity/tokens.json (2026-11-10).
// tokens.json has no radius yet; 6px and 4px are a guess to check against the site.
export default {
  font: 'Archivo, system-ui, sans-serif',
  mono: '"Roboto Mono", ui-monospace, monospace',
  radius: "6px",
  radiusSm: "4px",
  light: {
    bg: "#e7e4db", // paper
    surface: "#efece4", // plate
    field: "#e7e4db", // paper, inside plate cards
    fill: "#cbc7bc", // rule
    text: "#15171b", // ink
    muted: "#5e5c54", // muted (#6c6a61) darkened a step for AA on paper
    line: "#cbc7bc", // rule
    accent: "#a9331e", // mark-fill: the mark under paper-coloured text
    onAccent: "#e7e4db",
    focus: "#218cd8", // frame: deliberately not the mark
  },
  dark: {
    bg: "#131410", // paper-dark
    surface: "#1a1b16", // plate-dark
    field: "#131410",
    fill: "#33342c", // rule-dark
    text: "#e3e0d6", // ink-dark
    muted: "#8b8a7e", // muted-dark
    line: "#33342c",
    accent: "#e0603f", // mark-dark
    onAccent: "#131410",
    focus: "#46a6ea", // frame-dark
  },
};
