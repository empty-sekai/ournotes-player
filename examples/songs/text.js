// Chart data page: interface texts and the guide (the definitions, derivations and conditions behind every figure),
// in Chinese and English. The song texts themselves come from music-data.json in the language chosen on the page.

export const UI = {
  zh: {
    beta: "Beta", betaNote: "测试中，数值可能调整。幸运结果有采样误差，原生整局核对尚未完成。",
    app: "谱面数据", views: { rank: "排行", charts: "图表", guide: "说明" },
    all: "全部", search: "搜索曲名、读音、作者…", songs: (n) => `${n} 首`, chartsN: (n) => `${n} 张谱面`,
    jackets: "封面", jacketsHint: "显示或隐藏封面", theme: "切换浅色 / 深色", swap: "交换横纵轴",
    band: "乐队", difficulty: "难度",
    heads: { rank: "谱面排行", charts: "谱面图表" },
    lead: {
      rank: (songs, charts) => `${songs} 首歌、${charts} 张谱面的效率、活动评级、速度、等级与时长。得分数值按所选游玩场景计算：默认撃奏ライブ、三个区间都是第 1 名（最佳情况），也可切到不开激走的自由 Live，见说明。点任意一行看谱面详情；作词作曲、音频和谱面预览见 moenotes。`,
      charts: (songs, charts) => `${songs} 首歌、${charts} 张谱面的分布。散点图的两轴可任选，点任意一点看谱面详情。`,
    },
    empty: "没有符合条件的谱面", emptyHint: "当前的乐队、难度、搜索词或“只看前沿”把所有谱面都排除了。", clear: "清除筛选",
    diff: { easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert" },
    rankBy: {
      efficiency: "效率", event: "活动 · 评级", speed: "最快", level: "最高等级", notes: "Notes 最多", long: "最长",
      short: "最短", skip: "跳过得分",
    },
    speedBy: { density: "密度", bpmMax: "最高 BPM", bpm: "主 BPM" },
    rankHint: {
      efficiency: "期望得分 ÷ 一局耗时（每点综合力）。技能顺序每局随机，期望只取决于技能平均值；区间为 120 种顺序的最小–最大。",
      event: "活动积分只由评级决定。未填综合力时按达成目标评级所需综合力（期望得分）升序；填了则按每小时达成局数排序。",
      speed: "按音符密度或 BPM 排序。",
      level: "按显示等级（含小数）排序，同级按 Notes 数。",
      notes: "判定音符数，即全连所需连击数。",
      long: "按 BGM 时长排序。", short: "按 BGM 时长从短到长。",
      skip: "跳过时每点综合力的得分；与时长和技能无关。",
    },
    length: "时长", bgm: "BGM", chart: "谱面", overhead: "每局额外耗时", skills: "技能加成 %",
    meanSkill: (v) => `平均 ${v}%`,
    presets: [["全 150", "150,150,150,150,150"], ["全 100", "100,100,100,100,100"], ["无技能", "0,0,0,0,0"]],
    target: "目标评级", power: "综合力", powerHint: "不填则只看所需综合力",
    scen: {
      mode: "场景", battle: "撃奏ライブ", free: "自由 Live", battleHint: "多人（最多 5 人），激走开启", freeHint: "单人，激走关闭",
      ranks: "名次", range: (i, m) => `区间 ${i}${m ? ` · ${m}` : ""}`, rankBest: "名次 1 为最佳情况", ranksPending: "名次 2–5 数据待更新",
      accuracy: "准率", great: "Great 比例", just: "Just 率",
      accNote: "近似，不含断连；Great 比例作用于所有音符，Just 率只作用于 Just 任务区间", accNoteFree: "近似，不含断连；Great 比例作用于所有音符",
      pending: "数据待更新", room: "房间人数",
      roomHint: "按全员得分之和评级；假设全员与你同分，你的所需分数 = √(5/n) × 撃奏ライブ门槛", soloRanks: "自由 Live 用单人评级门槛",
    },
    aptitude: {
      title: "激走技能适性", pending: "适性数据待更新；排行和得分仍按不带激走技能计算。",
      empty: "没有适用于本谱任务的技能变体。", skill: "技能 / 等级", source: "来源", member: "成员", support: "支援",
      band: "乐队条件", match: "匹配", mismatch: "不匹配", noBand: "无条件", unknown: "未知形状",
      gain: "Δ得分", ratio: "占无技能得分", seeds: "种子 / 交叉项", changes: "区间指标变化", converted: "转换数 Δ",
      more: (n) => `同形状的其他 ${n} 个技能`,
      warning: "标准误未达目标", deterministic: "确定性检验通过", zero: "理论最佳打法下无增量", onlyMeasures: "只改变指标",
      power: "换算综合力", defaultPower: (p) => `未填综合力时按测量综合力 ${p} 显示`,
      note: "单个技能，不可相加。下表不会加进排行或本场景得分；普通技能按本页随机发动顺序取平均倍率。百分比的分母是同名次、同准率且不带普通技能或激走技能的基线分数。",
      accuracy: "Just 率插值、Great 比例缩放都是近似。Just < 100% 且普通技能非零时，缺少 Perfect 交叉权重，不提供完整增量。",
      missingPerfect: "缺少 Perfect 交叉权重；完整增量不可用。", baseOnly: "无普通技能增量（近似）", rawScore: "原始无普通技能 Δ分（P₀、全 Just、第 1 名）", rawPerfect: "原始全 Perfect Δ分（测量综合力）",
      se: "± 仅附在原始采样统计量上，表示标准误，不是置信区间。名次、准率或普通技能改变后的合成结果没有协方差，不附 ±。展开区间指标可看原始 Δscore ± 标准误；未达目标针对原始 Δscore，调整参数不会重测。",
      rank1: "此项缺少区间交叉权重，交叉项仍按名次 1，不能精确跟随当前名次。",
      missingCross: "没有可用的普通技能交叉项；将普通技能倍率设为 0 可看基础增量。",
      raw: "以下指标及转换数是全 Just、无 Great 的原始增量，不随准率滑块变化；名次由你指定，指标增量不直接换算成更高名次。",
      factors: "谱面因子（不带技能）", judgedNotes: "区间判定数", justNotes: "Just 音符", perfectNotes: "Just 区间 Perfect 音符",
      tailNotes: "尾部音符", comboAtStart: "进入时连击", lotteries: "抽签次数",
      factorNote: "区间计数为 Start 帧之后至 End 帧；尾部为 End 至 Complete，受技能影响但不计入区间分。抽签次数取基线种子均值 ± 标准误。",
    },
    frontier: "只看前沿", col: {
      rank: "#", song: "曲目", level: "等级", time: "时长", bpm: "BPM", notes: "Notes", density: "N/s",
      rate: "分/综合力", perMinute: "分/综合力/分钟", relative: "相对", dom: "支配", skip: "跳过系数", base: "基础系数",
      need: "所需综合力", chance: "达成率", perHour: "局/小时", goal: "达成局/小时",
    },
    onFrontier: "前沿", dominatedBy: (n) => `被 ${n} 张支配`,
    tipDom: (s) => `技能平均 0–150%、任意额外耗时下期望效率都不高于：${s}`,
    tipDomEvent: (s) => `任意评级、技能平均 0–150% 下所需综合力都不低于且时长不短于：${s}`,
    tipSpread: "120 种技能顺序下的最小–最大",
    noStats: "这份 music-data.json 不含 deck 统计（生成时用了 --no-deck），得分相关的数据不可用。",
    axes: {
      displayLevel: "等级", density: "密度 N/s", bpm: "主 BPM", bpmMax: "最高 BPM", notes: "Notes", bgmMs: "BGM 时长 (s)",
      perMinute: "分/综合力/分钟", rate: "分/综合力", base: "基础系数", skip: "跳过系数",
    },
    scatter: "散点图", x: "横轴", y: "纵轴", levelDist: "等级分布", bandShare: "各乐队曲目数",
    moenotes: "在 moenotes 查看", moenotesHint: "作词作曲、演唱、音频、封面和谱面预览见 moenotes 歌曲页",
    missions: { 1: "连击", 2: "幸运", 3: "Just" },
    detail: {
      musicType: "曲种", bgm: "BGM", musicId: "歌曲 ID", scoreId: "谱面 ID",
      notes: "Notes", fullCombo: "全连数", density: "密度", bpm: "BPM", bpmChanges: (n) => `${n} 次变速`,
      span: "音符区间", musicLength: "谱面长度", timeline: "时间轴", fever: "Fever", skill: "技能", mission: "激走任务",
      composition: "音符构成", weights: "技能位权重",
      weightsHint: "第 k 位成员带一个 +100% 普通加分技能时整局多得的分数 ÷ 综合力（整局模拟：窗口、帧、连击都算在内；撃奏ライブ另含 Just 与所选名次的排名加成），取种子平均，并按准率缩放；百分比为占 W 的份额。哪位成员落在哪个位置每局随机，所以期望只用到 W。",
      seeds: (n) => `${n} 个种子`, unplayable: "撃奏ライブ无法游玩", unplayableHint: "Fever 超过 3 个：从反编译代码看，游戏只保留 3 个激走区间，第 4 个 Fever 开始时会出错",
      unplayableFree: "；自由 Live 不开激走，可以照常游玩，切到自由 Live 可看它的数值",
      score: "得分（当前场景）", noFigures: "得分", twoScores: "撃奏ライブ的两套分数（每点综合力）",
      twoScoresHint: "撃奏ライブ同时上报两套分数：前者含激走，即本场景的数值（本页的卡组不带激走技能）；后者不含任何激走效果，卡上的激走技能也不计，存为歌曲最高分，约等于自由 Live 的分数",
      measures: "各区间的名次指标", mRange: "区间", mCompared: "比的指标",
      measure: { maxCombo: "最大连击", justCount: "Just 数", luckPoints: "幸运点数" },
      measuresHint: "撃奏ライブ的每个区间按该区间任务的指标与房间内其他人比名次：连击任务比最大连击，幸运任务比幸运点数，Just 任务比 Just 数（加粗的一格）。按本模型，理论最佳打法、不带激走技能，取种子平均，括号内为种子间的最小–最大；“–”表示数据里没有这一项。本页不模拟对手，名次由你选定。",
      orders: "顺序区间", sameOrder: "技能相同，顺序不影响得分", ranks: "评级门槛", rank: "评级", required: "所需分数", needPower: "所需综合力（期望）",
      needRange: "所需综合力（顺序区间）", chanceAt: (p) => `综合力 ${p} 达成率`, requiredRoom: (n) => `所需分数（${n} 人房间，每人）`,
      ranksHint: "门槛按歌定义，各难度共用；自由 Live 用单人门槛。所需综合力 = 门槛 ÷ 每点综合力的期望得分（已含准率）。",
      ranksHintRoom: (n) => `门槛按歌定义，各难度共用。撃奏ライブ按房间全员得分之和评级，这里假设房间 ${n} 人、全员与你同分：你的所需分数 = √(5/${n}) × 撃奏ライブ门槛。所需综合力 = 所需分数 ÷ 每点综合力的期望得分（已含准率）。`,
      efficiency: "效率（当前设置）", close: "关闭",
    },
    kinds: { tap: "点击", flick: "划键", slide: "长条", trace: "追踪", combo: "连击节点" },
    loading: "读取中…", error: "错误", source: (v) => `数据：国际服 / 日服 · 版本 ${v}`,
    sourceHint: (r, m, c) => `提取自 ${r} 区服 · master ${m} · 客户端 ${c}`, deckModel: "得分模型",
    caveat: "数值以游戏反编译为来源，尽量准确但不保证正确；与其它资料有出入时请以它们为准",
  },
  en: {
    beta: "Beta", betaNote: "In testing; figures may change. Luck results have sampling error, and whole-live checks against the native game are not yet complete.",
    app: "Chart data", views: { rank: "Rankings", charts: "Charts", guide: "Guide" },
    all: "All", search: "Search title, reading, credits…", songs: (n) => `${n} songs`, chartsN: (n) => `${n} charts`,
    jackets: "Jackets", jacketsHint: "Show or hide the jackets", theme: "Light / dark", swap: "Swap the axes",
    band: "Band", difficulty: "Difficulty",
    heads: { rank: "Chart rankings", charts: "Chart figures" },
    lead: {
      rank: (songs, charts) => `Efficiency, event ranks, speed, level and length of ${songs} songs and ${charts} charts. Score figures follow the play scenario chosen: by default Gekisou Live at rank 1 in all three ranges (the best case), or Free Live without Gekisou; see the guide. Open any row for the chart's details; credits, audio and chart previews are on moenotes.`,
      charts: (songs, charts) => `How ${songs} songs and ${charts} charts spread. Pick any two figures for the scatter; open any point for the chart's details.`,
    },
    empty: "No chart matches", emptyHint: "The band, difficulties, search or “frontier only” leave out every chart.", clear: "Clear filters",
    diff: { easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert" },
    rankBy: {
      efficiency: "Efficiency", event: "Event · rank", speed: "Fastest", level: "Highest level", notes: "Most notes",
      long: "Longest", short: "Shortest", skip: "Skip score",
    },
    speedBy: { density: "Density", bpmMax: "Max BPM", bpm: "Main BPM" },
    rankHint: {
      efficiency: "Expected score per minute per point of power. The skill order is drawn every live, so the expectation only depends on the mean skill value; the range is the min–max over the 120 orders.",
      event: "Event points depend on the rank only. Without a power: the power the expected score needs for the target rank, ascending; with one: target-rank plays per hour.",
      speed: "By note density or BPM.",
      level: "By display level (with decimals), then by notes.",
      notes: "Judged notes, the combo of a full combo.",
      long: "By BGM length.", short: "By BGM length, shortest first.",
      skip: "Score per point of power of a skipped live; length and skills do not matter.",
    },
    length: "Length", bgm: "BGM", chart: "Chart", overhead: "Overhead per play", skills: "Skill score up %",
    meanSkill: (v) => `mean ${v}%`,
    presets: [["All 150", "150,150,150,150,150"], ["All 100", "100,100,100,100,100"], ["None", "0,0,0,0,0"]],
    target: "Target rank", power: "Power", powerHint: "empty: required power only",
    scen: {
      mode: "Scenario", battle: "Gekisou Live", free: "Free Live", battleHint: "multiplayer (up to 5), Gekisou on", freeHint: "solo, Gekisou off",
      ranks: "Rank", range: (i, m) => `range ${i}${m ? ` · ${m}` : ""}`, rankBest: "rank 1 is the best case", ranksPending: "ranks 2–5: data pending",
      accuracy: "Accuracy", great: "Great share", just: "Just rate",
      accNote: "approximate, no combo breaks; the Great share applies to every note, the Just rate to Just mission ranges only",
      accNoteFree: "approximate, no combo breaks; the Great share applies to every note",
      pending: "data pending", room: "Players",
      roomHint: "the room's summed score is rated; with every player scoring the same as you, you need √(5/n) × the Gekisou Live threshold",
      soloRanks: "Free Live uses the solo rank thresholds",
    },
    aptitude: {
      title: "Gekisou skill aptitude", pending: "Aptitude data pending; rankings and scores still have no Gekisou skills.",
      empty: "No skill variants apply to this chart's missions.", skill: "Skill / level", source: "Source", member: "Member", support: "Support",
      band: "Band condition", match: "matched", mismatch: "unmatched", noBand: "none", unknown: "Unknown shape",
      gain: "Score Δ", ratio: "Share of no-skill score", seeds: "Seeds / cross terms", changes: "Range measure changes", converted: "Conversions Δ",
      more: (n) => `${n} other skills of this shape`,
      warning: "SE target not met", deterministic: "Passed determinism test", zero: "No gain in best play", onlyMeasures: "Measures only",
      power: "Power for conversion", defaultPower: (p) => `Empty power uses the measurement power ${p}`,
      note: "One skill at a time; gains cannot be added. This table does not change rankings or scenario scores. Ordinary skills use their mean value over the page's random activation order. The percentage divides by the baseline at the same ranks and accuracy, without ordinary or Gekisou skills.",
      accuracy: "Just interpolation and Great scaling are approximate. Below 100% Just with nonzero ordinary skills, Perfect cross weights are missing: no complete gain is provided.",
      missingPerfect: "Perfect cross weights missing; complete gain unavailable.", baseOnly: "No-ordinary-skill gain (approximate)", rawScore: "Raw no-ordinary-skill score Δ (P₀, all Just, rank 1)", rawPerfect: "Raw all-Perfect score Δ (measurement power)",
      se: "± labels raw sampled statistics only: standard error, not a confidence interval. Combined results after ranks, accuracy or ordinary skills change have no covariance data and no ±. Expand range measures for raw score gain ± SE. The target flag concerns original score gain; changing settings does not resample it.",
      rank1: "No range cross weights: cross terms stay at rank 1, not exactly at the chosen ranks.",
      missingCross: "Ordinary-skill cross terms unavailable; set ordinary skills to 0 to see the base gain.",
      raw: "Measures and conversions below are raw all-Just, no-Great gains, unchanged by accuracy sliders. Ranks are chosen by you; higher measures do not directly become higher ranks.",
      factors: "Chart factors (no skills)", judgedNotes: "Range judged notes", justNotes: "Just notes", perfectNotes: "Perfects in Just ranges",
      tailNotes: "Tail notes", comboAtStart: "Entry combo", lotteries: "Lotteries",
      factorNote: "Range counts cover after Start through End; the tail covers after End through Complete, affected by skills but outside the range score. Lottery counts are the baseline seed mean ± standard error.",
    },
    frontier: "Frontier only", col: {
      rank: "#", song: "Song", level: "Level", time: "Time", bpm: "BPM", notes: "Notes", density: "N/s",
      rate: "Score/power", perMinute: "Score/power/min", relative: "Rel.", dom: "Beaten", skip: "Skip", base: "Base",
      need: "Power needed", chance: "Chance", perHour: "Plays/h", goal: "Target/h",
    },
    onFrontier: "frontier", dominatedBy: (n) => `by ${n}`,
    tipDom: (s) => `No better in expected efficiency for any mean skill 0–150 % and any overhead than: ${s}`,
    tipDomEvent: (s) => `Needs no less power for any rank at any mean skill 0–150 %, and is no shorter, than: ${s}`,
    tipSpread: "min–max over the 120 skill orders",
    noStats: "This music-data.json has no deck statistics (made with --no-deck): the score figures are not available.",
    axes: {
      displayLevel: "Level", density: "Density N/s", bpm: "Main BPM", bpmMax: "Max BPM", notes: "Notes",
      bgmMs: "BGM length (s)", perMinute: "Score/power/min", rate: "Score/power", base: "Base", skip: "Skip",
    },
    scatter: "Scatter", x: "X", y: "Y", levelDist: "Levels", bandShare: "Songs per band",
    moenotes: "Open in moenotes", moenotesHint: "Credits, vocals, audio, jacket and chart previews on the moenotes song page",
    missions: { 1: "Combo", 2: "Luck", 3: "Just" },
    detail: {
      musicType: "Song type", bgm: "BGM", musicId: "Music id", scoreId: "Chart id", notes: "Notes", fullCombo: "Full combo", density: "Density", bpm: "BPM",
      bpmChanges: (n) => `${n} changes`, span: "Notes span", musicLength: "Chart length", timeline: "Timeline",
      fever: "Fever", skill: "Skill", mission: "Gekisou mission", composition: "Notes by kind", weights: "Skill position weights",
      weightsHint: "The score a +100 % plain score-up skill on the member at position k adds over the whole live, per point of power (whole-live simulation: windows, frames and combo included; in Gekisou Live also Just and the rank bonuses of the ranks chosen), averaged over the seeds and scaled by the accuracy; and its share of W. Which member lands on which position is drawn every live, so the expectation only uses W.",
      seeds: (n) => `${n} seeds`, unplayable: "Unplayable in Gekisou Live", unplayableHint: "More than 3 fevers: by the decompiled code the game keeps three Gekisou ranges and fails when a fourth fever starts",
      unplayableFree: "; Free Live has no Gekisou and plays it as usual: switch to Free Live for its figures",
      score: "Score (current scenario)", noFigures: "Score", twoScores: "Gekisou Live's two scores (per point of power)",
      twoScoresHint: "Gekisou Live reports two scores: the first with Gekisou, this scenario's figure (the page's decks have no Gekisou skills); the second without any Gekisou effect, the cards' Gekisou skills included, kept as the song's best score, about the Free Live score",
      measures: "Rank measures per range", mRange: "Range", mCompared: "Ranked by",
      measure: { maxCombo: "Max combo", justCount: "Just count", luckPoints: "Luck points" },
      measuresHint: "Every Gekisou Live range ranks the room by its mission's measure: combo missions by the max combo, luck missions by the luck points, Just missions by the Just count (the bold cell). By this model, in the theoretical best play without Gekisou skills: seed means, with the seeds' min–max in brackets; “–” where the data lacks the measure. The page does not model opponents and takes the ranks you pick.",
      orders: "Order range", sameOrder: "Equal skills: the order does not matter", ranks: "Score ranks", rank: "Rank", required: "Score", needPower: "Power (expected)",
      needRange: "Power (order range)", chanceAt: (p) => `Chance at ${p}`, requiredRoom: (n) => `Score (room of ${n}, each)`,
      ranksHint: "Thresholds are the song's, shared by every difficulty; Free Live uses the solo thresholds. Power needed = threshold ÷ expected score per power (accuracy included).",
      ranksHintRoom: (n) => `Thresholds are the song's, shared by every difficulty. Gekisou Live rates the room's summed score; here a room of ${n} players who all score the same as you: you need √(5/${n}) × the Gekisou Live threshold. Power needed = that score ÷ expected score per power (accuracy included).`,
      efficiency: "Efficiency (current settings)", close: "Close",
    },
    kinds: { tap: "Tap", flick: "Flick", slide: "Slide", trace: "Trace", combo: "Combo tick" },
    loading: "Loading…", error: "error", source: (v) => `Data: Global / Japan · version ${v}`,
    sourceHint: (r, m, c) => `extracted from region ${r} · master ${m} · client ${c}`, deckModel: "score model",
    caveat: "Figures sourced from the decompiled game client: we aim for accuracy but cannot guarantee it; where other sources disagree, trust them",
  },
};

// The guide: sections of {title, body: [paragraph], math: [formula], after: [paragraph], defs: [[term, text]]}.
export const GUIDE = {
  zh: {
    title: "定义、推导与成立条件",
    lead: "本页的数值以游戏客户端的反编译代码为来源：ournotes-deck 按反编译得到的得分逻辑对每张谱面做整局模拟（激走开启与关闭各一次），结果就是 music-data.json 的 deck 统计。"
      + "这里的模拟是我们照反编译代码重写的程序，不是在模拟器里直接运行游戏本身的代码；游戏自己的函数只用来分块核对这份重写（见“尚未纳入的机制”一节的“核对范围”）。"
      + "我们尽量保证正确，但对反编译代码的理解、模型的简化和数据版本都可能出错，所以不能保证。如果本页和其它站点、工具或实机结果有出入，多半是我们这边有误，请以它们为准。"
      + "下文给出每个量的定义、推导和成立条件；模型没有覆盖的机制单列一节。",
    sections: [
      {
        title: "得分模型",
        body: [
          "本页的得分数值按所选的游玩场景计算（第 2 节）。默认是撃奏ライブ（最多 5 人的多人模式）的最佳情况：激走开启，Fever 区间与歌曲的激走任务一起构成激走区间，三个区间都拿第 1 名的排名加成。另一个场景是自由 Live：从反编译代码看，自由 Live 和挑战 Live 不开激走（单人激走只有调试开关，发布版没有入口），按本模型单人游玩的得分会低很多。"
            + "两个场景都按理论最佳打法模拟：每个判定音符都在准确时刻命中，全连，生命不归零；撃奏ライブ的激走 Just 任务区间内为 Just，其它音符为 Perfect。准率的近似见第 6 节。"
            + "整局按反编译代码中的帧、得分帧（40 ms）、连击与激走连击系数、技能的发动与结束帧逐步模拟（ournotes-deck live::full）。本页的卡组模型是普通加分技能：效果 2000、持续 5 秒、作用于全体、无条件，卡组得分为",
        ],
        math: [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (位置 k 带因子 1 的技能时的得分 − score) / P₀,   P₀ = 300000",
        ],
        after: [
          "score 是模型算出的无技能得分（撃奏ライブ场景含区间排名加成），w_k 是第 k 位成员带一个因子 1（技能值 10000，即 +100%）的普通加分技能时整局多得的分数；两者都除以测量综合力 P₀。"
            + "技能值换算成因子时有取整（⌊值/10000 × 10⁵⌋/10⁵），各音符得分也有取整，所以上式在取整范围内成立：deck 对每个种子用一副真实技能值的随机卡组、在另一个综合力（1000003）下整局重算，偏差超过上界的谱面直接报错；现有 340 张全部通过。"
            + "这项核对只说明上式与模拟自洽，不能说明模拟与游戏一致。",
          "本页的卡组只有普通技能，不含成员卡的激走技能和小卡的激走支援技能，得分数值都按不带它们计算；它们的机制见第 7 节。",
          "每首歌有三个激走任务（连击、幸运或 Just，按歌定义，各难度共用），依次对应谱面的三个 Fever 区间。Just 判定只在 Just 任务区间内开启，所以三个任务里没有 Just 的歌（85 首中 41 首：21 首全是连击、20 首全是幸运）整局都没有 Just；"
            + "三个任务全是 Just 的有 27 首，另有 17 首连击、幸运、Just 各一个。",
          "按本模型，激走的影响很大：与激走关闭相比，Expert 谱面的无技能得分高 1.6–4.7 倍（中位 2.4 倍）。主要来源是区间排名加成（MasterLiveGekisouRankingScoreBonus）：每个完成的区间再加上该区间得分的一个百分比，按名次查表，默认按第 1 名计；"
            + "三个激走任务相同的歌（85 首中 68 首）为 250%，三个任务各不相同的（17 首）为 370%，多人游玩时即使是第 5 名也有 100%。按第 1 名计，Expert 谱面的 base 中有 36%–69%（中位 53%）来自它。"
            + "其次是 Just 任务区间内的 Just 判定（230%，Perfect 为 100%）：区间长、Just 音符多的谱面倍数最高，4.7 倍的那张三个 Just 区间共约 52 秒、233 个 Just 音符；连击任务区间的激走连击系数在没有激走技能时影响很小（约 1%）。"
            + "技能落在激走区间内时，排名加成随之放大，所以区间内的技能位权重明显更高。",
          "幸运任务区间的抽签与幸运冲刺取自本局的随机种子。含幸运区间的谱面（340 张中 148 张）给出前 8 个公开种子的结果，本页取种子平均，并在详情里给出种子间 base 的区间（中位相差 1.3%，最大 4.2%）。"
            + "游戏的种子规律未知，所以种子平均未必等于游戏内的真实期望。",
        ],
      },
      {
        title: "游玩场景与名次",
        body: [
          "撃奏ライブ中，每个激走区间按该区间的任务指标（连击、幸运点数或 Just 数）与房间内的其他玩家比名次，同值同名次；区间完成时，再加上该区间得分的一个百分比作为排名加成（MasterLiveGekisouRankingScoreBonus，按任务模式和名次查表，名次越靠后越少）。"
            + "页面上三个区间的名次可以分别选 1–5，默认都是 1，即最佳情况。名次不重新模拟，而是由名次 1 的模拟线性推出：",
        ],
        math: [
          "base_r = ( score − Σ_i B_i + Σ_i trunc( RS_i · p_i(r_i) / 100 ) ) / P₀",
          "w_r[k] = w[k] + Σ_i ( p_i(r_i) − p_i(1) ) / 100 · u_i[k]",
        ],
        after: [
          "RS_i 是区间 i 的得分，p_i(r) 是区间 i 在名次 r 时的加成百分比，B_i = trunc(RS_i · p_i(1) / 100) 是名次 1 的加成（现有数据的每个种子、每个区间都满足这个等式），u_i[k] 是位置 k 的技能让区间 i 多得的分数 ÷ P₀。"
            + "依据：从反编译代码看，加成在区间结束时一次性记入，不改变之后音符的得分系数；名次只影响一种技能条件（7012），现有主数据里没有技能用到它。所以按本模型，换名次只改变加成这一项，w_r 的误差来自技能加成的取整，小于 3/P₀。deck 另用随机名次整局实跑核对了这组线性式，现有数据全部落在误差上界内。"
            + "按本模型，三个区间全是第 1 名时的无技能得分是全是第 5 名时的 1.25–1.65 倍（340 张谱面，中位 1.46 倍）。",
          "自由 Live 场景的数值来自另一次激走关闭的整局模拟，不是从撃奏ライブ减去加成得到的：关闭激走时也没有 Just、激走连击系数和幸运冲刺。关闭激走时没有幸运抽签，本页用到的技能也没有概率条件，所以每张谱面只有一个种子；"
            + "Fever 超过 3 个、撃奏ライブ无法游玩的谱面，在自由 Live 场景照常计算。",
          "从反编译代码看，撃奏ライブ同时上报两套分数：一套含全部激走效果（Just、幸运、激走连击、排名加成和卡上的激走技能），本页撃奏ライブ场景的数值对应这一套（卡组不带激走技能时）；另一套不含任何激走效果（激走技能也不计），存为歌曲的最高分，按本模型约等于自由 Live 的分数。谱面详情里两个数字都列出。"
            + "服务器怎样使用这两套分数（例如计算活动积分），客户端代码里看不到。",
        ],
      },
      {
        title: "技能顺序是随机变量",
        body: [
          "从反编译代码看，客户端在每局开始时构造 MemberDataContainer：先把技能顺序置为 0…n−1，再用 MemberShuffle 随机流做 Fisher–Yates 洗牌；种子取自客户端时钟，单人重试沿用同一种子（顺序也不变）。"
            + "第 e 个技能事件触发洗牌后第 e 位成员的技能，Snap 技能的列表按同一顺序构建。因此本页把 π 当作在 5! = 120 种排列上均匀分布，卡组里的站位不是可选变量。",
        ],
        math: [
          "E[S] / P = base + x̄ · W,   x̄ = (1/n) Σ_i x_i,   W = Σ_k W_k",
          "Var[S / P] = (1/(n−1)) · Σ_i (x_i − x̄)² · Σ_k (W_k − W̄)²",
        ],
        after: [
          "推论一：期望只取决于技能平均值 x̄，与技能在成员间如何分配、谁在第几位无关。“最强技能放在权重最高的位置”只是 120 种排列中最好的一种，是上界，不是期望。",
          "推论二：离散度等于技能离散度与位置权重离散度的乘积；5 个技能相同时，每一局得分都相同。按本模型，以技能 [140, 100, 60, 30, 0]% 为例，在全部 Expert 谱面上，最好与最差排列相差中位 15.4%、最大 29.2%，最佳排列比期望高中位 7.6%；激走区间让位置权重差距拉大，顺序的影响远大于不计激走时。"
            + "页面给出期望、120 种排列的区间和 P10。",
        ],
      },
      {
        title: "效率与支配",
        body: ["一局耗时 T = L + c。L 有两种取法：BGM 时长（ACB cue 长度，未解码音频），或谱面长度（末音 + 1 s，也就是得分代码使用的乐曲长度）；c 是打歌以外的时间。"
          + "实机上一局从哪一刻进入结算尚未测定，所以两种 L 都提供，结论分别成立。"],
        math: [
          "效率 = E[S] / (P · T) = (base + x̄ W) / (L + c)",
          "a ≻ b  ⇔  ∀ x̄ ∈ [0, x_max], ∀ c ≥ 0:  S_a(x̄)/(L_a + c) ≥ S_b(x̄)/(L_b + c)，且至少一处严格",
        ],
        after: [
          "固定 x̄ 时，两边之差乘以 (L_a + c)(L_b + c) 后对 c 是线性的；固定 c 时对 x̄ 也是线性的。所以只需检查四个角点：S_a ≥ S_b 与 S_a/L_a ≥ S_b/L_b 在 x̄ = 0 和 x̄ = x_max 处成立。"
            + "x_max = 150%，取自主数据中单个技能的最大值（MasterLiveSkillEffect，满级）。不设上界时，一些 Easy 谱面只能靠不存在的 500% 以上技能值留在前沿上。",
          "在本模型内，前沿（不被任何谱面支配的集合）与 x̄ 和 c 无关：无论它们取何值，最优谱面都在前沿上；给定参数时的名次只是其中一种排序。"
            + "换游玩场景、名次或 Just 率会改变各谱面的数值，前沿也可能随之变化；Great 比例对所有谱面是同一个系数，不改变前沿。现有数据中，撃奏ライブ名次 1 时两种 L 下前沿都只有 340 张里的 2 张。",
          "比较的前提是同一卡组在两首歌上综合力相同。卡牌的曲种加成（musicType）和标签加成会使 P 随歌曲变化，这时应比较 P_a S_a 与 P_b S_b。",
        ],
      },
      {
        title: "评级与活动",
        body: [
          "评级门槛按歌定义：MasterLiveMusic._liveScoreRankGroup 指向 MasterLiveScoreRank 的一组行，同一首歌的所有难度共用；得分达到的最高门槛就是评级。"
            + "自由 Live 用单人门槛 R（_requiredScore）。撃奏ライブ用另一组门槛 R_battle（_battleLiveRequiredScore），按房间内全员得分之和评级：总分对比 trunc(√(5/n) · R_battle · n)（n 为未断线人数），E 计作 D。"
            + "页面在撃奏ライブ场景下假设房间 n 人（默认 5，可选 1–5）且全员与你同分，于是你的所需分数约为 √(5/n) · R_battle；队友得分高于或低于你时，你实际需要的分数会随之变低或变高。",
          "反编译代码中的活动积分计算如下，其中 v 由（活动，评级）查表，加成来自卡组，倍率在消耗 k 个 boost 时为 5k、不消耗时为 1：",
        ],
        math: [
          "积分 = trunc( (10000 + 加成) · 倍率 · v(活动, 评级) / 10000 )",
          "按时间:  max_s  Σ_r v(r) · Pr_s(评级 = r) / (L_s + c)",
          "a ≻_活动 b  ⇔  L_a ≤ L_b  且  ∀ r, ∀ x̄ ∈ [0, x_max]:  S_a(x̄)/R_a(r) ≥ S_b(x̄)/R_b(r)",
        ],
        after: [
          "歌曲只通过评级进入积分，所以每个 boost 换到的积分与选哪首歌无关；歌曲的差别只在于各评级的达成概率和一局的时长。"
            + "活动支配只要求 v 随评级不减，不需要知道积分表：满足上式时，任何卡组达成任何评级在 a 上所需的综合力都不高于 b，而 a 不更长。",
          "积分表可以反推，不必等主数据：一局的加成和倍率已知，所以 v = 积分 × 10000 / ((10000 + 加成) × 倍率)，截断带来的误差小于 1/倍率；每个评级一条样本就能唯一确定 v。",
          "达成率是在 120 种技能顺序上 P · S_π ≥ R 成立的比例（S 已含第 6 节的准率近似）；所需综合力取期望，区间取最好与最差排列。"
            + "按本模型，技能全 140%、撃奏ライブ名次 1、5 人房间时，Expert 达到 SS 所需综合力从 27 万到 205 万，相差 7.5 倍。SS 门槛对本模型的得分容量做过原点的最小二乘拟合，中位相对残差约 32%：门槛看来不是按容量定的，所以活动选曲最好逐曲计算，不宜直接拿效率排行代替。"
            + "85 首歌里有 20 首的 Hard 比 Expert 更容易拿到 SS。",
        ],
      },
      {
        title: "判定与准率",
        body: ["判定系数：Perfect 100%，Great 80%，Good 50%，Bad 与 Miss 为 0 且断连；Just 为 230%，只在撃奏ライブ的 Just 任务区间内可能出现。页面上的两个准率滑块都是近似，都不含断连："],
        math: [
          "g(q) = 1 − 0.2 q",
          "X(j) = X_P + j · (X_J − X_P),   X ∈ { 不含名次加成的整局得分 N,  区间得分 RS_i }",
          "S ≈ g(q) · [ N(j) + Σ_i trunc( RS_i(j) · p_i(r_i) / 100 ) ]",
          "w_k ≈ g(q) · [ w_r[k] + Σ_i ( ρ_i − 1 ) · ( 1 + p_i(r_i) / 100 ) · u_i[k] ],   ρ_i = RS_i(j) / RS_i",
        ],
        after: [
          "Great 比例 q 作用于所有音符：若只出现 Perfect 与 Great（不断连），且每个音符为 Great 的概率 q 与位置无关，那么普通音符与排名加成都按 g(q) 缩放，页面把这个系数乘进所有得分数值（效率、所需综合力、达成率和详情）。"
            + "Just 区间内的音符不完全是这样：一个 Great 从 230% 降到 80%，按比例损失远大于 20%，所以 Just 区间多的谱面上这个系数偏乐观。",
          "Just 率 j 只作用于撃奏ライブ的 Just 任务区间：deck 另做一次 Just 区间内全打 Perfect 的无技能模拟（X_P），页面在它与全 Just 的模拟（X_J）之间按 j 线性插值，名次加成按插值后的区间得分重算（第 2 节的截断公式），再乘 g(q)。"
            + "技能位权重在各区间内的部分按同一比例 ρ_i 缩放，这也是近似。j = 100%、q = 0 时回到第 1、2 节的数值；自由 Live 没有 Just，只有 Great 比例。",
          "断连不满足上述条件：连击系数和激走连击系数取决于当前连击数，连击任务区间还会因断连失败，断在不同位置损失不同（deck 统计尚未导出每张谱面的断连损失分布）。"
            + "判定转换技能（12006 把 Great 转为 Perfect，13005 转为 Just）相当于降低 q；回复和护盾只在生命归零之后才影响得分（此后每个音符 × 0.3）。",
        ],
      },
      {
        title: "激走技能",
        body: [
          "成员卡带激走技能，与它配对的小卡带激走支援技能。从反编译代码看，它们只在激走开启时建立，只加进含激走的那套分数（battleLiveScore），不进不含激走的那套（soloScore），自由 Live 里也没有。"
            + "技能按激走任务（连击、幸运、Just，或全部）门控，只在适用任务的区间里触发，与演奏位置和洗牌无关；支援技能可以带乐队条件（条件 5000），看配对的成员是否属于指定乐队。"
            + "ournotes-deck 的整局模拟可以带上激走技能，它们的效果（激走连击加成、幸运槽与幸运点、Just 数加成、支援技能的加分等）都逐帧计算。",
          "本页的排行和场景得分仍不带激走技能。适性表单独显示每个激走技能或支援技能带上时的得分增量与区间指标变化，不是推荐编成。成员技能取最高等级，支援技能取小卡最高突破时的等级；计分效果参数相同的技能归为同一形状，名字合列。成员技能只给一名演奏者装备，其余位置空。支援技能挂在合成的空激走技能宿主上（负 id、没有效果行，任务与支援技能相同），不借用真卡。有乐队条件的支援技能分匹配和不匹配两种变体：宿主设为目标乐队或乐队 0。",
        ],
        math: [
          "Δ(x) = P · ( Δscore / P₀ + x̄ · Σ_k Δw_k )",
          "Δscore(r) = Δtail + Σ_i ΔrangeScore_i · (1 + p_i(r_i)/100)",
          "Δw_k(r) = Δw_k + Σ_i (p_i(r_i) − p_i(1))/100 · ΔrangeWeights_k,i",
        ],
        after: [
          "精确与近似。带上激走技能再按第 1、2、6 节的式子计算时：名次 1、全 Just、无 Great 的得分是整局模拟的结果，普通技能那部分沿用第 1 节的线性式，与不带激走技能时是同一个近似。"
            + "名次沿用第 2 节的线性式：从反编译代码看，名次加成是区间结束时记入的一笔固定分，不改变任何得分系数，所以适性名次增量可按尾部加各区间增量乘名次系数得到，每区间有约 ±1 分的两次取整差；若没有区间交叉权重，交叉项只能按名次 1 显示并注明。"
            + "Just 率低于 100% 时沿用第 6 节的插值，带激走技能时这是近似：转 Just（13005）、每个 Just 加分的支援技能（2001）和累计 Just（13002）对 Just 数都不是线性的。Great 比例沿用 1 − 0.2 q，同样是近似。",
          "理论最佳打法下不起作用的技能。连击保护（12004）和 Great 转 Perfect（12006）只在出现 Great 或 Miss 时起作用，理论最佳打法下为 0，Great 比例的近似里也没有计入它们；每个音符都在准确时刻命中时，放宽 Just 判定（4004）也不起作用。"
            + "另有一些激走技能只提高名次指标，不直接加分（Just 数加成 13000、累计 Just 13002、加幸运点 11002）：本页不模拟对手，名次由你选定，所以它们不改变本页的得分；实际对局里它们可能帮你拿到更好的名次。"
            + "以上零效果类型已按适性数据的核对记录在全部谱面整局实跑确认；这仍是模型内部核对，不等于与游戏原生实现一致。",
          "种子。先用 4 个种子检验确定性，各项增量完全相同则只报 1 个种子、标准误为 0。其余按 32、64、128、256、512、1024 逐级增加，直到 Δscore 标准误不超过“增量均值绝对值的 1%”与“同种子基线均值的 0.1%”中较宽的目标；到上限仍未达到就标注。普通技能交叉项至多用前 64 个种子。不同形状可用不同种子数；均值不是游戏期望，真实种子分布未知。表中 ± 仅表示原始统计量的标准误；组合后的值没有协方差数据，不显示标准误。表内 Δscore 是按相同种子、相同打法得到的差值；每位置另带单位普通技能测交叉项，随机名次与随机普通技能卡组再做 check 核对。Just 率低于 100% 且普通技能非零时，因缺少 Perfect 交叉权重，不提供完整适性增量。"
            + "演奏位置每局洗牌，但激走技能与位置无关；洗牌只改变单个种子里概率判定的抽取次序，不改变期望。",
          "不可相加。连击加成存在饱和，多技能增量直接相加会高估；rush 支援与幸运槽技能（11001、11003、11005）会互相放大；13005 的判定转换也可能改变其它技能的触发与收益。不能只因 13000/13002 增加 Just 计数，就认定它们会改变按 Just 判定触发的支援得分；已有一组整局实跑未见这种交互，但也不能据此推广所有组合都无交互。单技能适性不能用于推算多技能编成，两个乐队变体也不能相加。",
          "核对现状。激走技能这一层按反编译代码逐项审计，与重写一致；整局与游戏原生代码的对照正在做，结果出来之前，这一层的数值尚在核对。按本模型得出的结论也都以此为前提。",
        ],
      },
      {
        title: "尚未纳入的机制",
        defs: [
          ["其它技能类型", "music-data.json 的 deck.kinds 列出主数据里所有与因子线性相关的加分类别（效果 2000、2002、2004、2005，按持续时间、目标和条件区分），每张谱面都给出了各类别的位置权重；"
            + "本页只用普通加分这一类。判定加分（2004，目标判定 41/46）和带条件的 2000（条件组 14、15）权重不同，需要按具体卡组逐类求和；累计加分（2001、2003）和判定转换不是线性的，只能整局模拟，激走技能与激走支援技能也是这样（第 7 节）。"],
          ["撃奏ライブ的对手", "名次由房间里其他玩家在各区间的任务指标决定。本页不模拟对手，而是让你直接选名次（名次 1 为最佳情况）；同值时加成表按哪一种名次查尚未完全核实，直接选名次时不受影响。房间不满 5 人时服务器是否补位，客户端代码里看不到。游戏没有协力模式。"],
          ["Snap 技能（普通支援技能）", "跟随所属成员一起被洗牌；效果多由条件触发（成员乐队、生命、判定数等），取决于具体卡组，本页不计入。条件在整局都满足的加分，相当于在 base 上乘 (1 + y)。小卡的激走支援技能另算，见第 7 节。"],
          ["概率发动（条件 4011）", "若发动概率 p 与其它量独立，它的期望贡献等于把该技能值换成 p · x，可以直接填进技能输入；方差会比表中给出的更大。"],
          ["实机一局耗时", "进入结算的时刻、加载时间都依赖设备和网络，由每局额外耗时 c 表示；支配关系对所有 c ≥ 0 成立。"],
          ["核对范围", "本页的数值不是直接运行游戏代码得到的：ournotes-deck 是我们照反编译代码重写的模拟，每张谱面的整局都由它计算。"
            + "游戏自己的函数只用来分块核对这份重写：在 ARM64 模拟器里单独运行客户端的相关函数（计分、技能的发动与结束、激走连击等），和重写的实现逐例比较，已核对的部分没有发现差异。"
            + "没有核对过的部分可能有错；整局从没有用游戏代码跑过，也还没有拿实机成绩逐局核对。"
            + "激走技能这一层（第 7 节）：按反编译代码逐项审计，与重写一致；整局与原生代码的对照正在做，结果出来之前尚在核对。"
            + "判定窗口类技能（4000–4003、13001）尚未接入整局模拟，另有少数激走条件只有合成测试；本页只用普通加分技能，不受这两项影响，激走技能可能用到这些条件，这也在上面的“尚在核对”之内。游戏更新或热更新补丁也可能改变这些规则。"],
        ],
      },
      {
        title: "谱面事实的口径",
        defs: [
          ["等级", "显示等级（_musicScoreDisplayLevel，可带小数）；得分使用整数等级（_musicScoreLevel）。"],
          ["Notes", "判定音符数，也就是全连连击数；不含隐藏音符、导引终点和不判定的长条节点。音符构成按 NoteOperateType 归类：点击 {1, 101}、划键 {40, 41, 42, 102}、长条 {20, 21, 22}、追踪 {60–63, 104, 105}、连击节点 {120}。"],
          ["主 BPM、密度", "主 BPM 是第一个到最后一个判定音符之间持续时间最长的 BPM；密度 = 判定音符数 ÷ 这段区间的秒数。"],
          ["基础系数、W、跳过系数", "base 与 W 定义见第 1、3 节：撃奏ライブ场景下 base 含所选名次的激走区间排名加成，自由 Live 场景没有；两者都按准率缩放。跳过系数是跳过时每点综合力的得分（全部按 Great、连击为 0、无技能），与时长无关，本页不随场景变化。"],
          ["与其它资料不一致时", "本页的数值来自我们对反编译代码的理解，没有官方资料可以对照，可能有错；和其它站点、工具或实机结果不一致时，请优先相信它们。"
            + "口径不同（时长的取法、游玩场景与名次、准率、卡组设定、是否带激走技能）也会带来差别，可以先把页面上的参数调成对方的设定再比较。"],
        ],
      },
    ],
  },
  en: {
    title: "Definitions, derivations and conditions",
    lead: "The figures on this page are sourced from the game client's decompiled code: ournotes-deck simulates every chart's whole live (once with Gekisou on, once off) after the score logic read from it, and the results are music-data.json's deck statistics. "
      + "The simulation is our own program, rewritten after the decompiled code; it does not run the game's code in an emulator. The game's own functions are used only to check the rewrite piece by piece (see Scope of the checks under the mechanisms left out). "
      + "We aim for them to be correct but cannot guarantee it: our reading of the decompiled code, the model's simplifications and the data version can all be wrong. Where this page disagrees with other sites, tools or real plays, the mistake is most likely ours; trust them. "
      + "Below: each quantity's definition, derivation and conditions; the mechanisms the model leaves out have their own section.",
    sections: [
      {
        title: "Score model",
        body: [
          "The page's score figures follow the play scenario chosen (section 2). The default is the best case of Gekisou Live (撃奏ライブ, the multiplayer mode of up to 5 players): Gekisou on, the fevers with the song's Gekisou missions make the Gekisou ranges, and all three ranges take the rank-1 bonus. The other scenario is Free Live: by the decompiled code, Free Live and Challenge Live play without Gekisou (solo Gekisou is a debug switch with no way in in the release), and by this model solo scores are much lower. "
            + "Both are simulated in theoretical best play: every judged note hit at its exact time, a full combo, life never at zero; in Gekisou Live Just inside the Gekisou Just mission ranges and Perfect elsewhere. Section 6 has the accuracy approximations. "
            + "The live is simulated frame by frame after the decompiled code (ournotes-deck live::full): frames, score frames (40 ms), combo and Gekisou combo factors, the skills' execute and finish frames. The page's deck model is the plain score-up skill: effect 2000, 5 s, the whole deck, no condition. A deck scores",
        ],
        math: [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (score with a factor-1 skill at position k − score) / P₀,   P₀ = 300000",
        ],
        after: [
          "score is the model's no-skill score (in Gekisou Live with the range rank bonuses), w_k the score a factor-1 plain skill (value 10000, +100 %) on the member at position k adds over the whole live; both per point of the measurement power P₀. "
            + "The value becomes a factor with a floor (⌊value/10000 × 10⁵⌋/10⁵) and every note score is floored, so the formula holds up to the floors: for every seed deck plays a random deck of real skill values at another power (1000003) through the whole live, and a chart whose deviation exceeds the bound fails. All 340 current charts pass. "
            + "This check only shows that the formula agrees with the simulation, not that the simulation agrees with the game.",
          "The page's decks have plain skills only, no member Gekisou skills and no snap Gekisou support skills, and every score figure is without them; section 7 has how they work.",
          "Every song has three Gekisou missions (combo, luck or Just, set per song and shared by every difficulty), one for each of the chart's three fevers in order. Just judgements are only on inside Just mission ranges, so the songs without a Just mission (41 of 85: 21 all combo, 20 all luck) have no Just all live; "
            + "27 songs have three Just missions, and 17 have one each of combo, luck and Just.",
          "By this model Gekisou weighs a lot: against Gekisou off, an Expert chart's no-skill score is 1.6–4.7 times higher (median 2.4). Most of it is the range rank bonus (MasterLiveGekisouRankingScoreBonus): every completed range adds a percentage of its own score, looked up by rank, rank 1 by default; "
            + "that is 250 % on the songs whose three missions are the same (68 of 85) and 370 % on those whose three missions all differ (17), and in multiplayer even rank 5 gets 100 %. At rank 1 it makes 36–69 % (median 53 %) of an Expert chart's base. "
            + "Next come the Just judgements inside Just mission ranges (230 %, against 100 % for a Perfect): charts with long ranges and many Just notes gain the most, and the 4.7 times chart has three Just ranges of about 52 s in all with 233 Just notes; the Gekisou combo factor of combo mission ranges matters little without Gekisou skills (about 1 %). "
            + "A skill inside a Gekisou range raises the rank bonus too, so the positions inside ranges weigh much more.",
          "Luck mission ranges draw their lottery and luck rushes from the live's random seed. Charts with a luck range (148 of 340) come with the first 8 published seeds; the page takes the mean over the seeds and shows the seeds' base range in the details (1.3 % apart at the median, 4.2 % at most). "
            + "The game's seed law is unknown, so the seed mean need not equal the game's own expectation.",
        ],
      },
      {
        title: "Play scenarios and ranks",
        body: [
          "In Gekisou Live every Gekisou range ranks the players of the room by that range's mission measure (combo, luck points or Just count), equal values sharing a rank; a completed range adds a percentage of its own score as the rank bonus (MasterLiveGekisouRankingScoreBonus, looked up by mission mode and rank, smaller for lower ranks). "
            + "The page takes a rank 1–5 for each of the three ranges, rank 1 everywhere by default, the best case. The ranks are not simulated again but follow from the rank-1 simulation linearly:",
        ],
        math: [
          "base_r = ( score − Σ_i B_i + Σ_i trunc( RS_i · p_i(r_i) / 100 ) ) / P₀",
          "w_r[k] = w[k] + Σ_i ( p_i(r_i) − p_i(1) ) / 100 · u_i[k]",
        ],
        after: [
          "RS_i is range i's score, p_i(r) range i's bonus percent at rank r, B_i = trunc(RS_i · p_i(1) / 100) the rank-1 bonus (every range of every seed of the current data meets this), and u_i[k] the score the skill at position k adds to range i, per P₀. "
            + "Why: by the decompiled code the bonus is added once at the range's end and leaves the score factors of the notes after it alone, and the rank reaches one skill condition only (7012), which no skill of the current master data uses. So by this model a rank changes the bonus term only; w_r is off by the skill floors, less than 3/P₀. deck also runs whole lives at random ranks against these formulas, and the current data stays within the error bound. "
            + "By this model the no-skill score at rank 1 in all three ranges is 1.25–1.65 times that at rank 5 (340 charts, median 1.46).",
          "The Free Live figures come from a separate whole-live simulation with Gekisou off, not from Gekisou Live minus the bonuses: without Gekisou there are no Just judgements, Gekisou combo factor or luck rushes either. Without Gekisou there is no luck lottery, and the page's skill has no probability condition, so every chart has one seed; "
            + "charts with more than 3 fevers, unplayable in Gekisou Live, are computed as usual in Free Live.",
          "By the decompiled code, Gekisou Live reports two scores: one with every Gekisou effect (Just, luck, the Gekisou combo, the rank bonuses and the cards' Gekisou skills), which the page's Gekisou Live figures stand for (with a deck without Gekisou skills); the other without any Gekisou effect (no Gekisou skills either), kept as the song's best score, by this model about the Free Live score. The chart details show both. "
            + "How the server uses the two (for event points, say) is not in the client code.",
        ],
      },
      {
        title: "The skill order is random",
        body: [
          "From the decompiled code: at the start of every live the client builds MemberDataContainer; the skill order is set to 0…n−1 and Fisher–Yates shuffled with the MemberShuffle random stream, seeded from the client clock (a solo retry keeps the seed, and the order). "
            + "Skill event e fires the member at position e of the shuffled order, and the snap skill lists follow the same order. So the page takes π as uniform over the 5! = 120 orders; the deck's slot order is not a choice.",
        ],
        math: [
          "E[S] / P = base + x̄ · W,   x̄ = (1/n) Σ_i x_i,   W = Σ_k W_k",
          "Var[S / P] = (1/(n−1)) · Σ_i (x_i − x̄)² · Σ_k (W_k − W̄)²",
        ],
        after: [
          "First: the expectation depends on the mean skill value only, not on how the values are spread over members or who stands where. The strongest skill on the heaviest position is the best of the 120 orders, an upper bound, not the expectation.",
          "Second: the spread is the product of the skills' spread and the position weights' spread; five equal skills score the same every live. By this model, with skills [140, 100, 60, 30, 0] % over every Expert chart, the best and the worst order differ by 15.4 % at the median and 29.2 % at most, and the best order is 7.6 % (median) above the expectation; the Gekisou ranges pull the position weights apart, so the order matters far more than without Gekisou. "
            + "The page shows the expectation, the range over the 120 orders and P10.",
        ],
      },
      {
        title: "Efficiency and dominance",
        body: ["A play takes T = L + c: L is the BGM length (the ACB cue length, audio not decoded) or the chart length (last note + 1 s, the music length of the score code), c the time outside the song. "
          + "When a live hands over to the results on a device is not measured yet, so both L are offered and every result holds for each."],
        math: [
          "efficiency = E[S] / (P · T) = (base + x̄ W) / (L + c)",
          "a ≻ b  ⇔  ∀ x̄ ∈ [0, x_max], ∀ c ≥ 0:  S_a(x̄)/(L_a + c) ≥ S_b(x̄)/(L_b + c), strictly somewhere",
        ],
        after: [
          "For a fixed x̄ the difference times (L_a + c)(L_b + c) is linear in c, and for a fixed c it is linear in x̄, so four corners decide: S_a ≥ S_b and S_a/L_a ≥ S_b/L_b at x̄ = 0 and at x̄ = x_max. "
            + "x_max = 150 %, the largest single skill value in the master data (MasterLiveSkillEffect, level 5). Without a bound, some Easy charts stay on the frontier only for skill values above 500 %, which do not exist.",
          "Within this model the frontier (the charts nothing beats) does not depend on x̄ and c: for any of them the best chart is on it; a ranking for given parameters is one ordering of it. "
            + "Another play scenario, rank or Just rate changes every chart's figures, and the frontier may change with them; the Great share is one factor for every chart and leaves it alone. On the current data, Gekisou Live at rank 1, the frontier holds 2 of the 340 charts for either L.",
          "The comparison assumes the deck has the same power on both songs. Card song-type (musicType) and tag bonuses make P depend on the song; then compare P_a S_a with P_b S_b.",
        ],
      },
      {
        title: "Score ranks and events",
        body: [
          "Rank thresholds are per song: MasterLiveMusic._liveScoreRankGroup selects rows of MasterLiveScoreRank, shared by every difficulty; the rank is the highest threshold the score reaches. "
            + "Free Live uses the solo threshold R (_requiredScore). Gekisou Live has thresholds of its own, R_battle (_battleLiveRequiredScore), and rates the sum of every player's score in the room against trunc(√(5/n) · R_battle · n) for n connected players, E counting as D. "
            + "In Gekisou Live the page takes a room of n players (5 by default, 1–5) who all score the same as you, so you need about √(5/n) · R_battle; teammates scoring above or below you lower or raise what you actually need.",
          "In the decompiled code event points are computed as below; v comes from the (event, rank) table, the bonus from the deck, and the rate is 5k for k boosts spent, 1 for none:",
        ],
        math: [
          "points = trunc( (10000 + bonus) · rate · v(event, rank) / 10000 )",
          "by time:  max_s  Σ_r v(r) · Pr_s(rank = r) / (L_s + c)",
          "a ≻_event b  ⇔  L_a ≤ L_b  and  ∀ r, ∀ x̄ ∈ [0, x_max]:  S_a(x̄)/R_a(r) ≥ S_b(x̄)/R_b(r)",
        ],
        after: [
          "The song enters the points only through the rank, so the points a boost buys do not depend on the song; songs differ only in their rank chances and their length. "
            + "Event dominance needs no point table, only v non-decreasing in the rank: when it holds, any deck needs no more power on a than on b for any rank, and a is no longer.",
          "The table can be recovered without the master data: bonus and rate of a live are known, so v = points × 10000 / ((10000 + bonus) × rate) with a truncation error below 1/rate; one result per rank determines v.",
          "The chance is the share of the 120 skill orders with P · S_π ≥ R (S with the accuracy approximation of section 6); the power needed uses the expectation, its range the best and the worst order. "
            + "By this model, with every skill at 140 %, in Gekisou Live at rank 1 in a room of 5, SS on Expert needs 0.27 to 2.05 million power, a factor 7.5. A least-squares fit through the origin of the SS thresholds against this model's score capacity leaves a median relative residual of about 32 %: the thresholds do not seem to be set by capacity, so event choices are best computed song by song rather than read straight off the efficiency ranking. "
            + "For 20 of the 85 songs SS is easier on Hard than on Expert.",
        ],
      },
      {
        title: "Judgements and accuracy",
        body: ["Judgement factors: Perfect 100 %, Great 80 %, Good 50 %, Bad and Miss 0 and a combo break; Just 230 %, only possible inside the Just mission ranges of Gekisou Live. The page's two accuracy sliders are both approximations, and neither has combo breaks:"],
        math: [
          "g(q) = 1 − 0.2 q",
          "X(j) = X_P + j · (X_J − X_P),   X ∈ { the whole-live score without rank bonuses N,  the range scores RS_i }",
          "S ≈ g(q) · [ N(j) + Σ_i trunc( RS_i(j) · p_i(r_i) / 100 ) ]",
          "w_k ≈ g(q) · [ w_r[k] + Σ_i ( ρ_i − 1 ) · ( 1 + p_i(r_i) / 100 ) · u_i[k] ],   ρ_i = RS_i(j) / RS_i",
        ],
        after: [
          "The Great share q applies to every note: with Perfects and Greats only (no break) and a Great chance q that does not depend on the note, plain notes and rank bonuses scale by g(q), and the page applies that factor to every score figure (efficiency, the power needed, the chance and the details). "
            + "Notes inside Just ranges do not quite: a Great there falls from 230 % to 80 %, far more than 20 %, so the factor is optimistic on charts with much Just range.",
          "The Just rate j applies to the Just mission ranges of Gekisou Live only: deck runs the live once more with Perfects instead of Justs in those ranges and no skills (X_P), the page interpolates linearly by j between it and the all-Just run (X_J), recomputes the rank bonuses on the interpolated range scores (the floor formula of section 2) and applies g(q). "
            + "The skill position weights are scaled by the same ratio ρ_i inside every range, again an approximation. At j = 100 % and q = 0 the figures are those of sections 1 and 2; Free Live has no Just, only the Great share.",
          "Breaks do not meet the condition: the combo and Gekisou combo factors depend on the running combo and a break fails a combo mission range, so a break costs differently at different notes (the deck statistics do not export a chart's break-cost distribution yet). "
            + "Judgement conversion (12006 turns Greats into Perfects, 13005 into Justs) lowers q; recovery and guard skills change the score only once life reaches zero (every note × 0.3 after that).",
        ],
      },
      {
        title: "Gekisou skills",
        body: [
          "Member cards carry a Gekisou skill and the snap paired with them a Gekisou support skill. By the decompiled code they exist only with Gekisou on and add to the score with Gekisou (battleLiveScore) only, never to the score without it (soloScore), and Free Live has none. "
            + "Skills are gated by their Gekisou mission (combo, luck, Just or all) and fire only in applicable ranges, whatever the performance position and the shuffle; a support skill may carry a band condition (condition 5000) on the member it is paired with. "
            + "ournotes-deck's whole-live simulation can take Gekisou skills, and computes their effects (the Gekisou combo boost, the luck gauge and luck points, Just count boosts, the support skills' score ups and others) frame by frame.",
          "The rankings and scenario scores still have no Gekisou skills. The aptitude table separately shows the score and range-measure gains of one Gekisou or support skill, not a recommended formation. Member skills use their highest level; support skills use their snap’s highest-rank level. Equal scoring-effect parameters form one shape whose skill names are listed together. A member skill is equipped on one performer, leaving the others empty. A support skill uses a synthetic empty Gekisou-skill host (negative id, no effect rows, the same mission), never a real card. Band conditions have matched and unmatched variants, using the target band or band 0.",
        ],
        math: [
          "Δ(x) = P · ( Δscore / P₀ + x̄ · Σ_k Δw_k )",
          "Δscore(r) = Δtail + Σ_i ΔrangeScore_i · (1 + p_i(r_i)/100)",
          "Δw_k(r) = Δw_k + Σ_i (p_i(r_i) − p_i(1))/100 · ΔrangeWeights_k,i",
        ],
        after: [
          "Exact and approximate. With Gekisou skills taken and the formulas of sections 1, 2 and 6 applied: at rank 1, all Just and no Great the score is the whole-live simulation's, and the plain skills' part keeps the linear formula of section 1, the same approximation as without Gekisou skills. "
            + "The ranks keep the linear formula of section 2: by the decompiled code the rank bonus is a fixed amount added at the range's end that changes no score factor, so aptitude gains at other ranks follow from the tail plus range gains times rank factors, with about ±1 point per range from the two floors. Without range cross weights, cross terms remain at rank 1 and are labelled accordingly. "
            + "A Just rate below 100 % keeps the interpolation of section 6, an approximation with Gekisou skills: Just conversion (13005), the per-Just support score up (2001) and cumulative Just (13002) are not linear in the Just count. The Great share keeps 1 − 0.2 q, an approximation too.",
          "Skills that do nothing in the theoretical best play. The combo guard (12004) and Great to Perfect (12006) act only on Greats or Misses: 0 in the theoretical best play, and the Great share approximation leaves them out; with every note hit at its exact time, the wider Just window (4004) does nothing either. "
            + "Some Gekisou skills raise a rank measure only and add no score (Just count boost 13000, cumulative Just 13002, luck points 11002): the page does not model opponents and takes the ranks you pick, so they leave the page's scores alone; in a real room they may win you a better rank. "
            + "The aptitude verification records report whole-live confirmation of these zero-effect types on all charts. This is still an internal model check, not proof of agreement with the native game.",
          "Seeds. Four seeds first test determinism; identical gains in every field are reported with one seed and zero SE. Otherwise batches of 32, 64, 128, 256, 512 and 1024 stop when score-gain SE is within the larger of 1% of the absolute mean gain or 0.1% of the baseline mean on the same seeds. A flag warns when the cap still misses the target. Cross terms use at most the first 64 seeds. Shapes can use different counts. Seed means are not the game’s expectation; its seed distribution is unknown. ± denotes SE on raw statistics only; combined values have no SE because covariances are unavailable. Deltas compare the same seeds and play; unit ordinary skills at each position measure cross terms, checked with random ranks and a random ordinary-skill deck. Below full Just with nonzero ordinary skills, missing Perfect cross weights prevent a complete aptitude gain. "
            + "The performance positions are shuffled every live, but the Gekisou skills do not depend on the position; the shuffle changes only the order of the chance draws within a seed, not the expectation.",
          "Gains cannot be added. Combo boosts saturate, so adding single-skill gains can overestimate a combination. Rush support and luck-gauge skills (11001, 11003, 11005) reinforce each other; judgement conversion by 13005 may also change other skills’ triggers and gains. Raising the Just counter with 13000/13002 does not by itself establish an effect on support triggered by Just judgements. One set of whole-live runs found no such interaction, but this does not establish independence for every combination. Single-skill aptitude cannot predict a multi-skill formation; the two band variants cannot be added either.",
          "State of the checks. This layer has been audited item by item against the decompiled code and agrees with the rewrite; the whole-live comparison with the game's native code is in progress, and until it is done the figures of this layer are still being checked. The conclusions “by this model” rest on that too.",
        ],
      },
      {
        title: "Mechanisms not modelled yet",
        defs: [
          ["Other skill types", "music-data.json's deck.kinds lists every score-up kind of the master data whose score is linear in the factor (effects 2000, 2002, 2004, 2005, told apart by duration, targets and conditions), with each chart's position weights per kind; "
            + "the page uses the plain score-up kind only. Judgement score up (2004, target judgements 41/46) and conditional 2000s (condition groups 14, 15) weigh differently and need a deck's own kinds summed; cumulative score up (2001, 2003) and judgement conversion are not linear and need the simulation itself, and so do Gekisou skills and Gekisou support skills (section 7)."],
          ["Gekisou Live opponents", "The ranks depend on the other players' mission measures in every range. The page does not model opponents and lets you pick the ranks instead (rank 1 is the best case); which kind of rank the bonus table takes on equal values is not fully checked, and picking the ranks directly does not depend on it. Whether the server fills a room of fewer than 5 is not in the client code. The game has no co-op mode."],
          ["Snap skills (plain support skills)", "Shuffled with their member; mostly conditional (the member's band, life, judgement counts), so deck-specific and left out here. A score up whose condition holds all live multiplies base by (1 + y). A snap's Gekisou support skill is another matter, see section 7."],
          ["Probability skills (condition 4011)", "With an activation chance p independent of the rest, the expected contribution is that of the value p · x, which can be entered as the skill value; the spread is larger than shown."],
          ["Real play time", "When the results start and how long loading takes depend on the device and the network; the overhead c stands for them, and dominance holds for every c ≥ 0."],
          ["Scope of the checks", "The figures on this page do not come from running the game's code: ournotes-deck is our simulation, rewritten after the decompiled code, and it computes every chart's whole live. "
            + "The game's own functions only check the rewrite piece by piece: the client's relevant functions (scoring, skill execute and finish, the Gekisou combo and others) run alone in an ARM64 emulator and are compared case by case with the rewrite; the parts checked so far show no difference. "
            + "Parts not checked may be wrong; no whole live has been run with the game's code, and none has been checked against real play results yet. "
            + "The Gekisou skill layer (section 7) has been audited item by item against the decompiled code and agrees with the rewrite; the whole-live comparison with the native code is in progress, and until it is done the layer is still being checked. "
            + "Judgement window skills (4000–4003, 13001) are not in the whole-live simulation yet, and a few Gekisou conditions only have synthetic tests; the page uses the plain score-up skill only and is affected by neither, the Gekisou skills may use those conditions, and that is part of the check still under way. A game update or hotfix patch may also change these rules."],
        ],
      },
      {
        title: "Chart facts",
        defs: [
          ["Level", "The display level (_musicScoreDisplayLevel, with decimals); the score uses the whole level (_musicScoreLevel)."],
          ["Notes", "Judged notes, the combo of a full combo; hidden notes, guide ends and unjudged slide ticks are left out. By NoteOperateType: tap {1, 101}, flick {40, 41, 42, 102}, slide {20, 21, 22}, trace {60–63, 104, 105}, combo tick {120}."],
          ["Main BPM, density", "The main BPM holds longest from the first to the last judged note; density = judged notes ÷ that span in seconds."],
          ["Base, W, skip", "Base and W as in sections 1 and 3: in Gekisou Live base includes the range rank bonuses of the ranks chosen, in Free Live it has none; both scale with the accuracy. Skip: score per point of power of a skipped live (every note Great, combo 0, no skills), independent of the length, and the same in every scenario on this page."],
          ["Where other sources disagree", "The figures come from our reading of the decompiled code, with no official data to check them against, and may be wrong; where other sites, tools or real plays disagree, trust them first. "
            + "Different conventions (how the length is taken, the play scenario and ranks, the accuracy, the deck, Gekisou skills or none) also make differences; set the page's parameters to theirs before comparing."],
        ],
      },
    ],
  },
};
