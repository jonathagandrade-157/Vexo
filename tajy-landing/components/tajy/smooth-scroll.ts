/** Smooth-scrolls to an in-page `#id` anchor without a global `scroll-behavior`. */
export function scrollToHash(hash: string) {
  const id = hash.replace("#", "");
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
