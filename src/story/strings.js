// The labels of the story controls in the story languages (the page's language picks them; English otherwise).

export const STORY_STRINGS = {
  ja: { next: "次へ", auto: "オート", speed: "早送り", skip: "スキップ", cancel: "キャンセル",
        skipConfirm: "ストーリーをスキップしますか？", music: "音楽", effects: "効果音", voice: "ボイス",
        play: "再生", pause: "一時停止", line: "セリフ", start: "タップして開始", ended: "終了",
        loading: "読み込み中", error: "エラー" },
  en: { next: "Next", auto: "Auto", speed: "Fast-forward", skip: "Skip", cancel: "Cancel",
        skipConfirm: "Skip the story?", music: "Music", effects: "Sound effects", voice: "Voice",
        play: "Play", pause: "Pause", line: "Line", start: "Click to start", ended: "The end",
        loading: "Loading", error: "Error" },
  "zh-Hant": { next: "下一句", auto: "自動", speed: "快轉", skip: "跳過", cancel: "取消",
               skipConfirm: "要跳過劇情嗎？", music: "音樂", effects: "音效", voice: "語音",
               play: "播放", pause: "暫停", line: "台詞", start: "點擊開始", ended: "結束",
               loading: "載入中", error: "錯誤" },
  "zh-Hans": { next: "下一句", auto: "自动", speed: "快进", skip: "跳过", cancel: "取消",
               skipConfirm: "要跳过剧情吗？", music: "音乐", effects: "音效", voice: "语音",
               play: "播放", pause: "暂停", line: "台词", start: "点击开始", ended: "结束",
               loading: "加载中", error: "错误" },
  ko: { next: "다음", auto: "자동", speed: "빨리 감기", skip: "건너뛰기", cancel: "취소",
        skipConfirm: "스토리를 건너뛸까요?", music: "음악", effects: "효과음", voice: "음성",
        play: "재생", pause: "일시 정지", line: "대사", start: "눌러서 시작", ended: "끝",
        loading: "불러오는 중", error: "오류" },
};

// the strings of a language code ("ja", "en", "zh-Hant", "zh-Hans", "ko", or a BCP 47 tag such as "zh-TW")
export const storyStrings = (lang) => {
  const l = String(lang || "");
  if (STORY_STRINGS[l]) return STORY_STRINGS[l];
  const low = l.toLowerCase();
  if (/^zh-(hant|tw|hk|mo)/.test(low)) return STORY_STRINGS["zh-Hant"];
  if (low.startsWith("zh")) return STORY_STRINGS["zh-Hans"];
  return STORY_STRINGS[low.slice(0, 2)] || STORY_STRINGS.en;
};
