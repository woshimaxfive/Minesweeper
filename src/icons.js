const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
  open: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
  flag: '<path d="M6 21V3l13 1-3 5 3 5H6"/>',
  mine: '<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
  landscape: '<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M17 11v3M7 3h10m-2-2 2 2-2 2"/>',
  follow: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17h2M3 12a9 9 0 0 1 2-6M1 8l2 4 3-3"/>',
  settings: '<path d="M4 6h6m4 0h6M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  restart: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  moon: '<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
  install: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  statistics: '<path d="M4 20h16M7 16v-5m5 5V4m5 12V8"/>',
  hint: '<path d="M9 18h6m-5 3h4M8.5 15.5a6 6 0 1 1 7 0L15 18H9Z"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ""}</svg>`;
}
