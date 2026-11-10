// the hero's own little icons: each stage's symbol in its colour, and a simple mark for each kind of part
export const ICO = (inner: string, c: string) => `<svg viewBox="0 0 14 14" width="16" height="16"><g fill="none" stroke="#222423" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">${inner.replace(/fill="C"/g, 'fill="none"')}</g><g fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${inner.replace(/fill="C"/g, `fill="${c}"`)}</g></svg>`;
export const STAGE_ICONS: [string, string][] = [
  ['tokenizer', ICO('<rect x="4" y="7.5" width="6" height="5.5"/><rect x="6" y="9.3" width="2" height="2" fill="C"/><path d="M7 7.5 V4 H11 V1"/>', '#0b1f6b')],
  ['syntax', ICO('<rect x="2" y="3" width="10" height="7.5"/><path d="M5 5 V8.5 M5 6.8 H9.5 M7 10.5 V14 M7 0 V3"/>', '#2a5dff')],
  ['semantic', ICO('<path d="M7 0 V3 L8.6 4 L5.4 5 L8.6 6 L5.4 7 L7 7.8"/><rect x="5.8" y="7.8" width="2.4" height="2.8"/><circle cx="7" cy="12.4" r="1.3"/>', '#0b1f6b')],
  ['memory', ICO('<circle cx="7" cy="4.6" r="1.7"/><circle cx="7" cy="4.6" r=".5" fill="C"/><path d="M7 2.9 V0.5 M7 6.3 V9 L4 11.5 L3 14 M4 11.5 L5.2 14 M7 9 L10 11.5 L8.8 14 M10 11.5 L11 14"/>', '#2a5dff')],
  ['reasoning', ICO('<circle cx="7" cy="2" r="1.3"/><path d="M7 3.3 L5 6 L8.2 8 L5.6 11 L7.6 13.6 M8.2 8 L11 9.8 M5 6 L3 7.5"/>', '#0b1f6b')],
  ['prediction', ICO('<circle cx="7" cy="6" r="3.2"/><circle cx="7" cy="6" r="1" fill="C"/>' + [2, 4.5, 7, 9.5, 12].map((x) => `<circle cx="${x}" cy="12.3" r=".6" fill="C"/>`).join(''), '#2a5dff')],
];
export const stageIcon = (name: string) => STAGE_ICONS.find(([k]) => name.toLowerCase().startsWith(k))?.[1];
/* each kind of part as it looks in the network: a head is a ringed nucleus, a column is a string of beads, the embedding takes text in at the top, the unembedding sends words out at the bottom */
export const PART_ICONS: Record<string, string> = {
  head: ICO('<circle cx="7" cy="7" r="4.6"/><circle cx="7" cy="7" r="2" fill="C"/>', '#2a5dff'),
  column: ICO('<circle cx="7" cy="2" r="1.4"/><circle cx="7" cy="5.4" r="1.4"/><circle cx="7" cy="8.8" r="1.4"/><circle cx="7" cy="12.2" r="1.4"/>', '#0b1f6b'),
  embedding: ICO('<path d="M7 0.5 V5 M5 3 L7 5 L9 3"/><circle cx="7" cy="9.5" r="3.4"/>', '#2a5dff'),
  unembedding: ICO('<circle cx="7" cy="4.5" r="3.4"/><path d="M7 8.5 V13.5 M5 11.5 L7 13.5 L9 11.5"/>', '#0b1f6b'),
};
