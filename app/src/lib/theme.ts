// Mirrors the viewer's theme into the dark class HeroUI reads on <html>.
// An explicit data-theme on <html> wins; otherwise the OS setting decides.
export function syncTheme(): void {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const apply = () => {
    const explicit = root.getAttribute("data-theme");
    const dark = explicit === "dark" || (explicit !== "light" && media.matches);
    root.classList.toggle("dark", dark);
  };

  apply();
  media.addEventListener("change", apply);
  new MutationObserver(apply).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}
