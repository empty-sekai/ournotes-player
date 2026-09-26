// UI strings of the player's controls and settings panel, by language: English, Japanese, Korean, Simplified and
// Traditional Chinese. The wording is the player's own. playerStrings(tag) picks the table for a BCP 47 language tag
// (the page's `lang` or the `lang` option); keys missing from a table and unknown languages fall back to English.

const en = {
  play: "Play", pause: "Pause", position: "Position", speed: "Playback", settings: "Settings",
  noteSpeedDown: "Lower the note speed", noteSpeedUp: "Raise the note speed", noteSpeedValue: "Note speed ({min}–{max})",
  settingsTitle: "Live settings", close: "Close", reset: "Reset all", mute: "Mute", applying: "Applying…",
  restartNote: "Some changes replay the chart up to the current time, which can take a moment.",
  loading: "Loading…", loadingMB: "Loading {loaded} / {total} MB", error: "Error: {message}", ms: "{v} ms",
  groups: { basic: "Basic", detail: "Detail", display1: "Display 1", display2: "Display 2", sound: "Sound" },
  sections: {
    basicNote: "Notes", basicLive: "Live", detailLane: "Judgement", detailNote: "Notes", display1Background: "Background",
    display1Combo: "Combo", display2Lane: "Lane", display2Note: "Notes", soundLive: "Volume", soundNoteSe: "Note sounds",
  },
  options: {
    NoteSpeed: "Note speed",
    NoteTiming: "Judgement timing",
    ChartPosition: "Note timing",
    MirrorChart: "Mirror the chart",
    LiveQuality: "Graphics quality",
    JudgeResultPositionType: "Judgement text",
    JudgePosition: "Judgement line position",
    SlideOpacity: "Slide opacity",
    GuideOpacity: "Guide opacity",
    SimultaneousLineDisplay: "Lines between simultaneous notes",
    BackgroundBrightness: "Background brightness",
    ComboCountDisplay: "Show the combo",
    ContinuationEffectDisplay: "Combo colours for full combo / all perfect",
    LaneOpacity: "Lane opacity",
    GuidelineOpacity: "Lane divider opacity",
    GuidelineCount: "Lane dividers",
    NoteDesignId: "Note design",
    NoteEffectId: "Hit effect",
    LiveMusicVolume: "Music",
    LiveNoteSeVolume: "Note sounds",
    LiveSeVolume: "Sound effects",
    LiveVoiceVolume: "Voices",
    NoteSePatternId: "Note sound set",
    UseIndividualNoteSe: "Choose a sound per note type",
    TapSeId: "Tap sound", TapSeVolume: "Tap volume",
    FlickSeId: "Flick sound", FlickSeVolume: "Flick volume",
    SideFlickSeId: "Directional flick sound", SideFlickSeVolume: "Directional flick volume",
    SlideSeId: "Slide sound", SlideSeVolume: "Slide volume",
    TraceSeId: "Trace sound", TraceSeVolume: "Trace volume",
  },
  hints: {
    NoteTiming: "Judgements and hit sounds come later (+) or earlier (−) than the notes reach the line.",
    ChartPosition: "The notes reach the line later (+) or earlier (−) against the music.",
    JudgePosition: "Moves the line where the notes are hit: − lower, + higher.",
    GuidelineCount: "Number of sections the lane is divided into.",
  },
  values: {
    quality: { 0: "High", 1: "Medium", 2: "Low" }, judgement: { 0: "Center", 2: "Hidden" }, off: "None",
    design: "Design {n}", effect: { 1: "Standard", 2: "Simple" }, effectN: "Effect {n}", soundSet: "Set {n}",
  },
};

const ja = {
  play: "再生", pause: "一時停止", position: "再生位置", speed: "再生速度", settings: "設定",
  noteSpeedDown: "ノーツの速度を下げる", noteSpeedUp: "ノーツの速度を上げる", noteSpeedValue: "ノーツの速度（{min}〜{max}）",
  settingsTitle: "ライブ設定", close: "閉じる", reset: "すべて初期値に戻す", mute: "ミュート", applying: "反映中…",
  restartNote: "一部の変更は、現在の時点まで譜面を計算し直して反映するため、少し時間がかかることがあります。",
  loading: "読み込み中…", loadingMB: "読み込み中 {loaded} / {total} MB", error: "エラー: {message}", ms: "{v} ms",
  groups: { basic: "基本", detail: "詳細", display1: "表示1", display2: "表示2", sound: "サウンド" },
  sections: {
    basicNote: "ノーツ", basicLive: "ライブ", detailLane: "判定", detailNote: "ノーツ", display1Background: "背景",
    display1Combo: "コンボ", display2Lane: "レーン", display2Note: "ノーツ", soundLive: "音量", soundNoteSe: "ノーツ音",
  },
  options: {
    NoteSpeed: "ノーツの速度",
    NoteTiming: "判定のタイミング",
    ChartPosition: "ノーツのタイミング",
    MirrorChart: "譜面を左右反転",
    LiveQuality: "画質",
    JudgeResultPositionType: "判定の表示",
    JudgePosition: "判定ラインの位置",
    SlideOpacity: "スライドの不透明度",
    GuideOpacity: "ガイドの不透明度",
    SimultaneousLineDisplay: "同時押しのライン",
    BackgroundBrightness: "背景の明るさ",
    ComboCountDisplay: "コンボを表示",
    ContinuationEffectDisplay: "フルコンボ・オールパーフェクト中のコンボの色",
    LaneOpacity: "レーンの不透明度",
    GuidelineOpacity: "レーン区切り線の不透明度",
    GuidelineCount: "レーン区切り線",
    NoteDesignId: "ノーツのデザイン",
    NoteEffectId: "タップエフェクト",
    LiveMusicVolume: "楽曲",
    LiveNoteSeVolume: "ノーツ音",
    LiveSeVolume: "効果音",
    LiveVoiceVolume: "ボイス",
    NoteSePatternId: "ノーツ音のセット",
    UseIndividualNoteSe: "ノーツの種類ごとに音を選ぶ",
    TapSeId: "タップの音", TapSeVolume: "タップの音量",
    FlickSeId: "フリックの音", FlickSeVolume: "フリックの音量",
    SideFlickSeId: "方向フリックの音", SideFlickSeVolume: "方向フリックの音量",
    SlideSeId: "スライドの音", SlideSeVolume: "スライドの音量",
    TraceSeId: "トレースの音", TraceSeVolume: "トレースの音量",
  },
  hints: {
    NoteTiming: "判定とタップ音が、ノーツが判定ラインに届くより遅く (+)・早く (−) なります。",
    ChartPosition: "楽曲に対して、ノーツが判定ラインに届くのが遅く (+)・早く (−) なります。",
    JudgePosition: "ノーツを判定するラインを動かします (− で下、+ で上)。",
    GuidelineCount: "レーンを区切る数です。",
  },
  values: {
    quality: { 0: "高", 1: "中", 2: "低" }, judgement: { 0: "中央", 2: "表示しない" }, off: "なし",
    design: "デザイン{n}", effect: { 1: "標準", 2: "シンプル" }, effectN: "エフェクト{n}", soundSet: "セット{n}",
  },
};

const ko = {
  play: "재생", pause: "일시 정지", position: "재생 위치", speed: "재생 속도", settings: "설정",
  noteSpeedDown: "노트 속도 낮추기", noteSpeedUp: "노트 속도 높이기", noteSpeedValue: "노트 속도 ({min}~{max})",
  settingsTitle: "라이브 설정", close: "닫기", reset: "모두 기본값으로", mute: "음소거", applying: "적용 중…",
  restartNote: "일부 변경은 현재 시점까지 채보를 다시 계산해 반영하므로 잠시 걸릴 수 있습니다.",
  loading: "불러오는 중…", loadingMB: "불러오는 중 {loaded} / {total} MB", error: "오류: {message}", ms: "{v} ms",
  groups: { basic: "기본", detail: "상세", display1: "표시 1", display2: "표시 2", sound: "사운드" },
  sections: {
    basicNote: "노트", basicLive: "라이브", detailLane: "판정", detailNote: "노트", display1Background: "배경",
    display1Combo: "콤보", display2Lane: "레인", display2Note: "노트", soundLive: "볼륨", soundNoteSe: "노트음",
  },
  options: {
    NoteSpeed: "노트 속도",
    NoteTiming: "판정 타이밍",
    ChartPosition: "노트 타이밍",
    MirrorChart: "채보 좌우 반전",
    LiveQuality: "그래픽 품질",
    JudgeResultPositionType: "판정 표시",
    JudgePosition: "판정선 위치",
    SlideOpacity: "슬라이드 불투명도",
    GuideOpacity: "가이드 불투명도",
    SimultaneousLineDisplay: "동시 노트 연결선",
    BackgroundBrightness: "배경 밝기",
    ComboCountDisplay: "콤보 표시",
    ContinuationEffectDisplay: "풀 콤보·올 퍼펙트 중 콤보 색상",
    LaneOpacity: "레인 불투명도",
    GuidelineOpacity: "레인 구분선 불투명도",
    GuidelineCount: "레인 구분선",
    NoteDesignId: "노트 디자인",
    NoteEffectId: "타격 이펙트",
    LiveMusicVolume: "음악",
    LiveNoteSeVolume: "노트음",
    LiveSeVolume: "효과음",
    LiveVoiceVolume: "보이스",
    NoteSePatternId: "노트음 세트",
    UseIndividualNoteSe: "노트 종류별로 소리 선택",
    TapSeId: "탭 소리", TapSeVolume: "탭 볼륨",
    FlickSeId: "플릭 소리", FlickSeVolume: "플릭 볼륨",
    SideFlickSeId: "방향 플릭 소리", SideFlickSeVolume: "방향 플릭 볼륨",
    SlideSeId: "슬라이드 소리", SlideSeVolume: "슬라이드 볼륨",
    TraceSeId: "트레이스 소리", TraceSeVolume: "트레이스 볼륨",
  },
  hints: {
    NoteTiming: "판정과 타격음이 노트가 판정선에 닿는 순간보다 늦게(+) 또는 빠르게(−) 일어납니다.",
    ChartPosition: "음악에 비해 노트가 판정선에 늦게(+) 또는 빠르게(−) 도착합니다.",
    JudgePosition: "노트를 판정하는 선을 옮깁니다(− 아래, + 위).",
    GuidelineCount: "레인을 나누는 구간 수입니다.",
  },
  values: {
    quality: { 0: "높음", 1: "보통", 2: "낮음" }, judgement: { 0: "가운데", 2: "표시 안 함" }, off: "없음",
    design: "디자인 {n}", effect: { 1: "기본", 2: "심플" }, effectN: "이펙트 {n}", soundSet: "세트 {n}",
  },
};

const zhHans = {
  play: "播放", pause: "暂停", position: "播放位置", speed: "播放速度", settings: "设置",
  noteSpeedDown: "降低音符速度", noteSpeedUp: "提高音符速度", noteSpeedValue: "音符速度（{min}–{max}）",
  settingsTitle: "Live 设置", close: "关闭", reset: "全部恢复默认", mute: "静音", applying: "正在应用…",
  restartNote: "部分更改会将谱面重新计算到当前时间后生效，可能需要片刻。",
  loading: "正在加载…", loadingMB: "正在加载 {loaded} / {total} MB", error: "错误：{message}", ms: "{v} 毫秒",
  groups: { basic: "基本", detail: "详细", display1: "显示 1", display2: "显示 2", sound: "声音" },
  sections: {
    basicNote: "音符", basicLive: "Live", detailLane: "判定", detailNote: "音符", display1Background: "背景",
    display1Combo: "连击", display2Lane: "轨道", display2Note: "音符", soundLive: "音量", soundNoteSe: "音符音效",
  },
  options: {
    NoteSpeed: "音符速度",
    NoteTiming: "判定时机",
    ChartPosition: "音符时机",
    MirrorChart: "谱面左右镜像",
    LiveQuality: "画质",
    JudgeResultPositionType: "判定文字",
    JudgePosition: "判定线位置",
    SlideOpacity: "滑条不透明度",
    GuideOpacity: "引导线不透明度",
    SimultaneousLineDisplay: "同时音符连线",
    BackgroundBrightness: "背景亮度",
    ComboCountDisplay: "显示连击数",
    ContinuationEffectDisplay: "全连 / 全完美时的连击颜色",
    LaneOpacity: "轨道不透明度",
    GuidelineOpacity: "轨道分隔线不透明度",
    GuidelineCount: "轨道分隔线",
    NoteDesignId: "音符样式",
    NoteEffectId: "击打特效",
    LiveMusicVolume: "音乐",
    LiveNoteSeVolume: "音符音效",
    LiveSeVolume: "效果音",
    LiveVoiceVolume: "语音",
    NoteSePatternId: "音符音效组",
    UseIndividualNoteSe: "按音符种类选择音效",
    TapSeId: "点击音效", TapSeVolume: "点击音量",
    FlickSeId: "划动音效", FlickSeVolume: "划动音量",
    SideFlickSeId: "方向划动音效", SideFlickSeVolume: "方向划动音量",
    SlideSeId: "滑条音效", SlideSeVolume: "滑条音量",
    TraceSeId: "轨迹音效", TraceSeVolume: "轨迹音量",
  },
  hints: {
    NoteTiming: "判定和击打音效比音符到达判定线更晚（+）或更早（−）。",
    ChartPosition: "相对于音乐，音符到达判定线更晚（+）或更早（−）。",
    JudgePosition: "移动判定音符的那条线（− 向下，+ 向上）。",
    GuidelineCount: "轨道被分成的区段数。",
  },
  values: {
    quality: { 0: "高", 1: "中", 2: "低" }, judgement: { 0: "居中", 2: "不显示" }, off: "无",
    design: "样式 {n}", effect: { 1: "标准", 2: "简洁" }, effectN: "特效 {n}", soundSet: "音效组 {n}",
  },
};

const zhHant = {
  play: "播放", pause: "暫停", position: "播放位置", speed: "播放速度", settings: "設定",
  noteSpeedDown: "降低音符速度", noteSpeedUp: "提高音符速度", noteSpeedValue: "音符速度（{min}–{max}）",
  settingsTitle: "Live 設定", close: "關閉", reset: "全部恢復預設", mute: "靜音", applying: "正在套用…",
  restartNote: "部分變更會將譜面重新計算到目前時間後生效，可能需要片刻。",
  loading: "正在載入…", loadingMB: "正在載入 {loaded} / {total} MB", error: "錯誤：{message}", ms: "{v} 毫秒",
  groups: { basic: "基本", detail: "詳細", display1: "顯示 1", display2: "顯示 2", sound: "聲音" },
  sections: {
    basicNote: "音符", basicLive: "Live", detailLane: "判定", detailNote: "音符", display1Background: "背景",
    display1Combo: "連擊", display2Lane: "軌道", display2Note: "音符", soundLive: "音量", soundNoteSe: "音符音效",
  },
  options: {
    NoteSpeed: "音符速度",
    NoteTiming: "判定時機",
    ChartPosition: "音符時機",
    MirrorChart: "譜面左右鏡像",
    LiveQuality: "畫質",
    JudgeResultPositionType: "判定文字",
    JudgePosition: "判定線位置",
    SlideOpacity: "滑條不透明度",
    GuideOpacity: "引導線不透明度",
    SimultaneousLineDisplay: "同時音符連線",
    BackgroundBrightness: "背景亮度",
    ComboCountDisplay: "顯示連擊數",
    ContinuationEffectDisplay: "全連／全完美時的連擊顏色",
    LaneOpacity: "軌道不透明度",
    GuidelineOpacity: "軌道分隔線不透明度",
    GuidelineCount: "軌道分隔線",
    NoteDesignId: "音符樣式",
    NoteEffectId: "擊打特效",
    LiveMusicVolume: "音樂",
    LiveNoteSeVolume: "音符音效",
    LiveSeVolume: "效果音",
    LiveVoiceVolume: "語音",
    NoteSePatternId: "音符音效組",
    UseIndividualNoteSe: "依音符種類選擇音效",
    TapSeId: "點擊音效", TapSeVolume: "點擊音量",
    FlickSeId: "劃動音效", FlickSeVolume: "劃動音量",
    SideFlickSeId: "方向劃動音效", SideFlickSeVolume: "方向劃動音量",
    SlideSeId: "滑條音效", SlideSeVolume: "滑條音量",
    TraceSeId: "軌跡音效", TraceSeVolume: "軌跡音量",
  },
  hints: {
    NoteTiming: "判定和擊打音效比音符到達判定線更晚（+）或更早（−）。",
    ChartPosition: "相對於音樂，音符到達判定線更晚（+）或更早（−）。",
    JudgePosition: "移動判定音符的那條線（− 向下，+ 向上）。",
    GuidelineCount: "軌道被分成的區段數。",
  },
  values: {
    quality: { 0: "高", 1: "中", 2: "低" }, judgement: { 0: "置中", 2: "不顯示" }, off: "無",
    design: "樣式 {n}", effect: { 1: "標準", 2: "簡潔" }, effectN: "特效 {n}", soundSet: "音效組 {n}",
  },
};

export const PLAYER_STRINGS = { en, ja, ko, "zh-Hans": zhHans, "zh-Hant": zhHant };
export const PLAYER_LANGUAGES = Object.keys(PLAYER_STRINGS);

// the table key for a BCP 47 tag: zh with Hant / TW / HK / MO -> zh-Hant, other zh -> zh-Hans, ja, ko, en; else en
export const playerLanguage = (tag) => {
  const t = String(tag || "").toLowerCase();
  if (t === "zh" || t.startsWith("zh-")) return /(^|-)(hant|tw|hk|mo)(-|$)/.test(t) ? "zh-Hant" : "zh-Hans";
  for (const l of ["ja", "ko", "en"]) if (t === l || t.startsWith(`${l}-`)) return l;
  return "en";
};

// the strings for a tag, English for keys the table lacks
export const playerStrings = (tag) => {
  const t = PLAYER_STRINGS[playerLanguage(tag)];
  if (t === en) return en;
  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] || {}, v) : v;
    return out;
  };
  return merge(en, t);
};

// "{name}" placeholders filled from vars
export const formatString = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
