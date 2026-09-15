/**
 * Each action's drawing, as markup to inline in a key face.
 *
 * Written by `npm run icons -w streamdeck` from `design/actions/*.svg`.
 * Edit the drawings, not this file. The viewBox they are drawn in is 144
 * square, which is what `face.ts` scales them down from.
 */
export const GLYPHS: Record<string, string> = {
  autoroll:
    '<rect x="18" y="62" width="52" height="52" rx="12" fill="none" stroke="#ffffff" stroke-width="11"/> <circle cx="44" cy="88" r="8" fill="#ffffff"/> <rect x="78" y="62" width="52" height="52" rx="12" fill="none" stroke="#ffffff" stroke-width="11"/> <circle cx="94" cy="78" r="7" fill="#ffffff"/> <circle cx="114" cy="98" r="7" fill="#ffffff"/> <path d="M26 46 A60 60 0 0 1 118 46" fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round"/> <path d="M104 32 H132 L118 60 Z" fill="#ffffff"/>',
  clock:
    '<circle cx="72" cy="72" r="48" fill="none" stroke="#ffffff" stroke-width="12"/> <path d="M72 42 V74 H100" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>',
  command:
    '<rect x="26" y="26" width="92" height="92" rx="20" fill="none" stroke="#ffffff" stroke-width="12"/> <path d="M78 40 L52 82 L68 82 L62 108 L94 62 L76 62 Z" fill="#ffffff"/>',
  connect:
    '<path d="M89 51 A34 34 0 1 1 55 51" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round"/> <path d="M72 20 L72 64" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round"/>',
  finish:
    '<path d="M38 22 V126" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/> <path d="M38 30 H114 L96 58 L114 86 H38 Z" fill="#ffffff"/>',
  metric:
    '<g fill="#ffffff"> <rect x="26" y="76" width="24" height="42" rx="7"/> <rect x="60" y="50" width="24" height="68" rx="7"/> <rect x="94" y="26" width="24" height="92" rx="7"/> </g>',
  next: '<path d="M46 26 L118 72 L46 118 Z" fill="#ffffff"/>',
  open: '<path d="M86 42 H34 A12 12 0 0 0 22 54 V110 A12 12 0 0 0 34 122 H98 A12 12 0 0 0 110 110 V68" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/> <path d="M72 72 L116 28" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/> <path d="M84 24 H120 V60" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>',
  press:
    '<rect x="26" y="26" width="92" height="92" rx="20" fill="none" stroke="#ffffff" stroke-width="12"/> <circle cx="72" cy="72" r="20" fill="#ffffff"/>',
  roll: '<rect x="26" y="26" width="92" height="92" rx="20" fill="none" stroke="#ffffff" stroke-width="12"/> <circle cx="46" cy="46" r="9" fill="#ffffff"/> <circle cx="98" cy="46" r="9" fill="#ffffff"/> <circle cx="72" cy="72" r="9" fill="#ffffff"/> <circle cx="46" cy="98" r="9" fill="#ffffff"/> <circle cx="98" cy="98" r="9" fill="#ffffff"/>',
  run: '<g fill="#ffffff"> <rect x="26" y="34" width="92" height="16" rx="8"/> <rect x="26" y="64" width="92" height="16" rx="8"/> <rect x="26" y="94" width="56" height="16" rx="8"/> </g>',
  setup:
    '<rect x="26" y="26" width="92" height="92" rx="20" fill="none" stroke="#ffffff" stroke-width="12"/> <path d="M48 76 L66 94 L98 54" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>',
  undo: '<path d="M42 67 A32 32 0 1 0 102 67" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round"/> <path d="M42 28 L63 71 L21 71 Z" fill="#ffffff"/>',
};
