/** Official 2021 Advanced Pirate Abilities, bound to the five house-art pirates. */

export const PIRATE_ABILITIES = {
  0: {
    id: "harry",
    officialName: "Harry the Giant",
    chineseName: "巨人哈利",
    artName: "Edward Newgate",
    artFile: "pirate-0",
    skill: "bid",
  },
  1: {
    id: "juanita",
    officialName: "Juanita Jade",
    chineseName: "胡安妮塔",
    artName: "Kaido",
    artFile: "pirate-1",
    skill: "peek",
  },
  2: {
    id: "rosie",
    officialName: "Rosie D'Laney",
    chineseName: "蘿茜·德蘭尼",
    artName: "Big Mum",
    artFile: "pirate-2",
    skill: "lead",
  },
  3: {
    id: "rascal",
    officialName: "Rascal of Roatan",
    chineseName: "羅阿坦惡漢",
    artName: "Shanks",
    artFile: "pirate-3",
    skill: "bet",
  },
  4: {
    id: "bendt",
    officialName: "Bendt the Bandit",
    chineseName: "大盜賓特",
    artName: "Marshall D. Teach",
    artFile: "pirate-4",
    skill: "drawDiscard",
  },
};

export function pirateAbilityByCopyIndex(copyIndex = 0) {
  return PIRATE_ABILITIES[copyIndex] || null;
}

/**
 * The official trigger: you must win the trick with that named pirate yourself.
 * Tigress-as-pirate and merely capturing a pirate do not count.
 * Only Harry may be used after the last trick of a 局.
 */
export function winningPirateAbility(played, { lastTrickOfRound = false } = {}) {
  if (!played || played.card?.special !== "pirate") return null;
  const info = pirateAbilityByCopyIndex(played.card.copyIndex ?? 0);
  if (!info) return null;
  if (lastTrickOfRound && info.id !== "harry") return null;
  return info;
}

export function pirateAbilityHelp(info) {
  if (!info) return "";
  const who = `${info.chineseName}（${info.officialName}）`;
  if (info.id === "harry") {
    return `${who}：如果你用呢張海盜贏回合，可以將自己嘅叫牌 +1、−1，或者保持不變。呢個能力喺一局最後一回合贏咗都可以用。`;
  }
  if (info.id === "juanita") {
    return `${who}：如果你用呢張海盜贏回合（唔可以係最後一回合），可以私下睇呢一局未發嘅牌。`;
  }
  if (info.id === "rosie") {
    return `${who}：如果你用呢張海盜贏回合（唔可以係最後一回合），可以揀邊個做下一回合領牌，包括你自己。`;
  }
  if (info.id === "rascal") {
    return `${who}：如果你用呢張海盜贏回合（唔可以係最後一回合），可以旁注 0、10 或 20 分：呢局估中叫牌就加呢啲分，估唔中就扣。`;
  }
  if (info.id === "bendt") {
    return `${who}：如果你用呢張海盜贏回合（唔可以係最後一回合），會從剩低未發嘅牌加 2 張入手，然後從手牌棄 2 張。`;
  }
  return "";
}
