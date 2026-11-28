const ICONS = {
  yellow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 8h14l1.5 3H20v9H4v-9H3.5L5 8zm2 3v7h10v-7H7zm2-6h6l1 3H8l1-3z"/></svg>`,
  green: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.5 14.5c2.8-1 6.2-4.8 7.2-8.6 2.8 1.6 4.6 4.4 4.6 7.2 0 .4 0 .8-.1 1.1 1.2-1.2 2.8-2.8 3.3-5.1 2.2 3.2.6 8-3.2 10.2-2.2 1.3-5 1.6-7.4.6-1.8-.8-3.8-3.4-4.4-5.4zM8 9.2c.8-1.6 2-3.2 3.4-4.4-.2 2.2-1.6 4.4-3.4 4.4z"/></svg>`,
  purple: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 6.5 12 4l8 2.5v7.2c0 4.2-3.4 6.8-8 8.8-4.6-2-8-4.6-8-8.8V6.5zm8 1.2-5 1.5v4.5c0 2.5 2 4.3 5 5.7 3-1.4 5-3.2 5-5.7V9.2l-5-1.5z"/></svg>`,
  black: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.2c3.5 0 6.3 2.4 6.3 5.6 0 1.8-.9 3.4-2.3 4.4V16h-2.1l-.7-1.7H10.8L10.1 16H8v-2.8C6.6 12.2 5.7 10.6 5.7 8.8 5.7 5.6 8.5 3.2 12 3.2zm-2.5 4.6c-.8 0-1.4.6-1.4 1.4S8.7 10.6 9.5 10.6s1.4-.6 1.4-1.4S10.3 7.8 9.5 7.8zm5 0c-.8 0-1.4.6-1.4 1.4s.6 1.4 1.4 1.4 1.4-.6 1.4-1.4S15.3 7.8 14.5 7.8zM10.2 12.2h3.6v1.1h-3.6v-1.1zM7.6 18.8 9.5 17h5l1.9 1.8H7.6z"/></svg>`,
  escape: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 4h2v16H5V4zm3 1.5 11 4.2-11 4.2V5.5z"/></svg>`,
  pirate: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 17.5 12 8l8 9.5H4zM6.5 19h11c.6 1 1 2 1 2H5.5s.4-1 1-2zM11 5.5h2v3h-2v-3zM8.2 6.2l1.4-1.4 2 2.2-1.4 1.3-2-2.1zm7.6 0-2 2.1 1.4 1.3 2-2.2-1.4-1.2z"/></svg>`,
  mermaid: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.5 13.2 7h3.8L14.2 9.4 15.5 13 12 10.8 8.5 13l1.3-3.6L7 7h3.8L12 3.5zm-6 11.2c2.2 1 4.4 1.6 6 1.6s3.8-.6 6-1.6c-.4 2.4-2.8 5.3-6 6.8-3.2-1.5-5.6-4.4-6-6.8z"/></svg>`,
  tigress: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4c2 3 3 5 3 7 2-1 3.5-1.2 5-.5-1 3.2-3.2 5.2-5.2 6.2 1.2 1.2 2.6 2 4.2 2.6-3 .8-6.2.4-8-.8-1.8 1.2-5 1.6-8 .8 1.6-.6 3-1.4 4.2-2.6C5.2 15.5 3 13.5 2 10.3c1.5-.7 3-.5 5 .5 0-2 1-4 3-6 1 2.2 2 3.4 2 5.2 0-1.8 1-3 2-5.2z"/></svg>`,
  skullKing: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 8.5 12 3l6 5.5H6zm6 1.2c3.4 0 6 2.2 6 5.4 0 1.6-.6 3-1.6 4.1V21h-2.3l-.6-1.6h-3l-.6 1.6H8.6v-1.8C7.6 18 7 16.7 7 15.1c0-3.2 2.6-5.4 6-5.4zm-2.4 5.2c-.8 0-1.3.6-1.3 1.3S9 16.6 9.6 16.6s1.3-.6 1.3-1.4-.6-1.3-1.3-1.3zm4.8 0c-.8 0-1.3.6-1.3 1.3s.6 1.4 1.3 1.4 1.3-.6 1.3-1.4-.6-1.3-1.3-1.3zM10 18h4v1h-4v-1z"/></svg>`,
  kraken: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.2c2.9 0 5.1 2.1 5.1 5.1 0 1.1-.3 2.1-.9 2.9 1.7.5 3 1.5 3.9 2.8-.8.7-1.9.9-3 .5.3 1.2.3 2.5-.2 3.7-.8-.6-1.3-1.5-1.5-2.6-.4 1.5-1.2 2.9-2.6 3.8-.2-1.2 0-2.5.6-3.6-.7.3-1.5.5-2.4.5h-.2c-.8 0-1.6-.2-2.3-.5.6 1.1.8 2.4.6 3.6-1.4-.9-2.2-2.3-2.6-3.8-.2 1.1-.7 2-1.5 2.6-.5-1.2-.5-2.5-.2-3.7-1.1.4-2.2.2-3-.5.9-1.3 2.2-2.3 3.9-2.8-.6-.8-.9-1.8-.9-2.9 0-3 2.2-5.1 5.1-5.1zm-2.3 4.3c-.6 0-1.1.5-1.1 1.1s.5 1.2 1.1 1.2 1.1-.5 1.1-1.2-.5-1.1-1.1-1.1zm4.6 0c-.6 0-1.1.5-1.1 1.1s.5 1.2 1.1 1.2 1.1-.5 1.1-1.2-.5-1.1-1.1-1.1z"/></svg>`,
  whiteWhale: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 14.2c0-3.8 4.2-6.8 9.4-6.8 1.7 0 3.3.3 4.6 1L21 6.2l-1.1 4.1c1 .1 1.8 2.6 1.8 4v.9H3.8c-.4-.6-.6-1.3-.6-2zm12.4-2.7c.6 0 1 .5 1 1.1s-.4 1.1-1 1.1-1-.5-1-1.1.4-1.1 1-1.1zM5.4 17.4h11.4c.5 1.1.9 2.3.9 2.3H6.2s.4-1.2.9-2.3H5.4z"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 16.5 5.5 7l5 5 1.5-7 1.5 7 5-5 2.5 9.5H3zM4 18h16v2.5H4V18z"/></svg>`,
};

export const SUIT_INFO = {
  yellow: { chineseName: "寶藏箱", shortName: "黃" },
  green: { chineseName: "鸚鵡", shortName: "綠" },
  purple: { chineseName: "海盜地圖", shortName: "紫" },
  black: { chineseName: "骷髏旗", shortName: "黑" },
};

export const SPECIAL_INFO = {
  escape: { chineseName: "逃脫" },
  pirate: { chineseName: "海盜" },
  mermaid: { chineseName: "人魚" },
  tigress: { chineseName: "母老虎" },
  skullKing: { chineseName: "骷髏王" },
  kraken: { chineseName: "八爪魚" },
  whiteWhale: { chineseName: "白鯨" },
};

/** Short Cantonese explainers for first-time players. */
export const CARD_HELP = {
  escape: "永遠唔會搶回合（除非呢個回合全部都係逃脫，就由先出嗰張贏）。唔使跟花，想唔贏回合就出佢。",
  pirate: "大過人魚同所有數字牌，細過骷髏王。唔使跟花。如果海盜捕獲人魚（而且呢個回合冇骷髏王），估中叫牌可以加分。",
  mermaid: "大過所有數字牌，細過海盜；但人魚可以捕獲骷髏王（即使同時有海盜，都係人魚贏）。唔使跟花。",
  tigress: "母老虎係一張要「變身」嘅特殊牌：出嚟嗰陣你要即場宣布當海盜定逃脫。當海盜就可以搶回合；當逃脫就盡量唔贏回合。佢本身冇第三種打法。",
  skullKing: "大過海盜同所有數字牌，但會被人魚捕獲。唔使跟花。如果骷髏王捕獲海盜，估中叫牌可以加分。",
  kraken: "會食咗整個回合：無人贏、亦冇捕獲獎勵。下一回合由「如果冇出八爪魚會贏嗰個人」先出。唔使跟花。",
  whiteWhale: "特殊牌全部作廢，由點數最高嘅數字牌贏，唔分花色同王牌。如果淨係特殊牌，呢個回合作廢，下一回合由出白鯨嗰個人先出。唔使跟花。",
};

export function suitLabel(suit) {
  const info = SUIT_INFO[suit];
  if (!info) return "";
  return `${info.shortName}色（${info.chineseName}）`;
}

export function cardHelpText(card, { tigressAsPirate = null } = {}) {
  if (card?.special) {
    if (card.special === "tigress" && tigressAsPirate === true) {
      return "呢張母老虎已宣布當海盜：同普通海盜一樣可以搶回合。";
    }
    if (card.special === "tigress" && tigressAsPirate === false) {
      return "呢張母老虎已宣布當逃脫：通常唔會贏回合。";
    }
    return CARD_HELP[card.special] || "";
  }
  if (card?.suit) {
    const trump = card.suit === "black" ? "黑色骷髏旗係王牌，大過其他顏色嘅數字牌。" : "有花就要跟；黑色骷髏旗係王牌。";
    return `${suitLabel(card.suit)}，點數 ${card.rank}。${trump}`;
  }
  return "";
}

function kindClass(card) {
  if (card.special) return `special-${card.special}`;
  return `suit-${card.suit}`;
}


/** Every in-play face, used to preload art when the app opens. */
export const CARD_ART_FILES = [
  ...["yellow", "green", "purple"].flatMap((suit) => Array.from({ length: 14 }, (_, i) => `${suit}-${i + 1}`)),
  ...Array.from({ length: 13 }, (_, i) => `black-${i + 1}`),
  "black-14",
  "black-14-1",
  "escape",
  "tigress-0",
  "tigress-1",
  "skullKing",
  "mermaid-0",
  "mermaid-1",
  "kraken",
  "whiteWhale",
  ...Array.from({ length: 5 }, (_, i) => `pirate-${i}`),
];

export function allCardArtUrls() {
  return CARD_ART_FILES.map((name) => `/cards/${name}.webp`);
}

export function cardArtUrl(card) {
  if (!card) return "";
  if (card.special === "escape") return "/cards/escape.webp";
  if (card.special === "tigress") return `/cards/tigress-${card.copyIndex ?? 0}.webp`;
  if (card.special === "pirate") return `/cards/pirate-${card.copyIndex ?? 0}.webp`;
  if (card.special === "mermaid") return `/cards/mermaid-${card.copyIndex ?? 0}.webp`;
  if (card.special) return `/cards/${card.special}.webp`;
  if (card.suit === "black" && card.rank === 14 && (card.copyIndex ?? 0) > 0) {
    return "/cards/black-14-1.webp";
  }
  if (card.suit && card.rank) return `/cards/${card.suit}-${card.rank}.webp`;
  return "";
}

export function cardFaceLabel(card, { tigressAsPirate = null } = {}) {
  if (card?.special === "tigress" && tigressAsPirate != null) {
    return tigressAsPirate ? "母老虎（當海盜）" : "母老虎（當逃脫）";
  }
  if (card?.special) return SPECIAL_INFO[card.special]?.chineseName || "";
  if (card?.suit) return `${SUIT_INFO[card.suit].shortName}${card.rank}`;
  return "";
}

export function cardFaceHTML(card, { dimmed = false, tigressAsPirate = null, compact = false, animated = false } = {}) {
  const cls = [
    "sk-card",
    "has-art",
    kindClass(card),
    dimmed ? "dimmed" : "",
    compact ? "compact" : "",
    animated ? "is-preview-live" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const label = cardFaceLabel(card, { tigressAsPirate });
  const src = cardArtUrl(card);
  const declared = card.special === "tigress" && tigressAsPirate != null
    ? `<span class="sk-card-flag">${tigressAsPirate ? "當海盜" : "當逃脫"}</span>`
    : "";
  const live = animated
    ? `<div class="sk-card-bob-clip" aria-hidden="true"><img class="sk-card-bob" src="${escapeAttr(src)}" alt="" draggable="false" width="784" height="1100"></div><div class="sk-card-vfx" aria-hidden="true"></div>`
    : "";
  return `<div class="${cls}" data-id="${escapeAttr(card.id)}" role="img" aria-label="${escapeAttr(label)}">
    <div class="sk-card-inner">
      <img class="sk-card-art" src="${escapeAttr(src)}" alt="${escapeAttr(label)}" draggable="false" width="784" height="1100">
      ${live}
      ${declared}
    </div>
  </div>`;
}

export function cardBackHTML({ compact = false } = {}) {
  return `<div class="sk-card back ${compact ? "compact" : ""}">
    <div class="sk-card-inner">
      <div class="sk-back">
        <span class="sk-icon">${ICONS.crown}</span>
      </div>
    </div>
  </div>`;
}

export function iconSVG(name) {
  return ICONS[name] || ICONS.crown;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function escapeAttr(s) {
  return escapeHtml(s);
}
