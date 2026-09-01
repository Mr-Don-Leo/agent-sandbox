export type ThemePref = "system" | "light" | "dark";
export type Skin = "apple" | "cyberpunk" | "xp";

const THEME_KEY = "agentsandbox.themePref";
const SKIN_KEY = "agentsandbox.skin";

// Skins with a single mode override the light/dark preference entirely.
const FIXED_SKIN_THEME: Partial<Record<Skin, "light" | "dark">> = {
  cyberpunk: "dark",
  xp: "light",
};

export function loadThemePref(): ThemePref {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function loadSkin(): Skin {
  const v = localStorage.getItem(SKIN_KEY);
  return v === "cyberpunk" || v === "xp" ? v : "apple";
}

export function applyTheme(pref: ThemePref, skin: Skin) {
  localStorage.setItem(THEME_KEY, pref);
  localStorage.setItem(SKIN_KEY, skin);

  const fixed = FIXED_SKIN_THEME[skin];
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const mode =
    fixed ?? (pref === "system" ? (systemDark ? "dark" : "light") : pref);

  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.skin = skin;
}

export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
