// Chart data page: interface texts and the guide (the definitions, derivations and conditions behind every figure),
// in Chinese and English. The song texts themselves come from music-data.json in the language chosen on the page.

export const UI = {
  zh: {
    beta: "Beta", betaNote: "Rust 模型计算；ARM64 原生核对与逐音符单局计算见说明。",
    referenceEstimate: "参考估算",
    developmentData: "本地开发数据",
    uncommittedModel: "模型含未提交修改",
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
    allColumns: "全部列", allColumnsHint: "可左右滚动对比",
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
    pareto: "帕累托前沿",
    approximateShort: "近似",
    paretoHelp: "前沿说明",
    lowerBetter: "越低越好",
    higherBetter: "越高越好",
    xGoal: "横轴目标",
    yGoal: "纵轴目标",
    plotted: (n) => "{n} 张候选谱面".replace("{n}", n),
    paretoCount: (n) => "{n} 张在前沿".replace("{n}", n),
    paretoHint: "前沿按当前筛选、参数与两轴目标计算。连线连接离散候选，不表示中间存在谱面；它不同于排行中跨技能均值、跨额外耗时的支配关系。",
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
    beta: "Beta", betaNote: "Rust model calculations; see the guide for native ARM64 checks and per-note replay.",
    referenceEstimate: "Reference estimate",
    developmentData: "Local development data",
    uncommittedModel: "Uncommitted model changes",
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
    allColumns: "All columns", allColumnsHint: "Scroll sideways to compare",
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
    pareto: "Pareto frontier",
    approximateShort: "Approximate",
    paretoHelp: "About this frontier",
    lowerBetter: "Lower is better",
    higherBetter: "Higher is better",
    xGoal: "X objective",
    yGoal: "Y objective",
    plotted: (n) => "{n} candidate charts".replace("{n}", n),
    paretoCount: (n) => "{n} on the frontier".replace("{n}", n),
    paretoHint: "The frontier uses the current filters, parameters and two objectives. Lines connect discrete candidates; they do not imply intermediate charts. This differs from ranking dominance across every skill mean and overhead.",
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
export const REPLAY_UI = {
  "zh": {
    "title": "单局计算",
    "loading": "正在载入模型…",
    "hint": "设置技能转换前的判定，再计算这一局。默认无技能；结果列出转换后的判定数量。",
    "power": "综合力",
    "seed": "随机种子",
    "clock": "帧率",
    "mode": "场景",
    "free": "自由 Live",
    "fixedRanks": "撃奏 · 固定名次",
    "reset": "重置判定",
    "run": "计算",
    "export": "导出 JSON",
    "advanced": "导入 / 导出",
    "advancedHint": "JSON 保留音符时刻、帧内顺序、技能和名次确认。导入的输入由 Rust 检查。",
    "import": "导入 JSON",
    "error": "计算失败",
    "ready": "可计算",
    "calculating": "正在计算…",
    "score": "最终得分",
    "frameScore": "最后一帧显示分",
    "life": "生命",
    "combo": "连击",
    "note": "音符",
    "time": "时刻",
    "type": "类型",
    "judgement": "判定",
    "range": "区间",
    "just": "Just",
    "luck": "幸运点数",
    "complete": "已计算",
    "wrongChart": "文件的谱面或格式不匹配。",
    "importedMode": "导入的场景",
    "incomplete": "输入未完成，不能作为整局结果。",
    "importedClock": "导入的时钟",
    "exactPlan": "逐音符计算",
    "greatShare": "Great 概率",
    "justShare": "Just 率",
    "presetHint": "剩余概率为 Perfect，Just 仅用于可判为 Just 的音符。段落覆盖全曲设定，后面的段落优先。种子生成一局可复现的判定，结果不是平均得分。",
    "rawPreset": "原始输入请先重置再用滑块。",
    "wholeSong": "全曲默认",
    "planSeed": "判定种子",
    "generate": "生成判定",
    "editNotes": "查看／逐音符修改",
    "segment": "段落",
    "customSegment": "自定义段落",
    "start": "开始（秒）",
    "end": "结束（秒）",
    "remove": "删除",
    "probabilityTotal": "Great、Good、Bad、Miss 概率之和不能超过 100%。"
  },
  "en": {
    "title": "One live",
    "loading": "Loading model…",
    "hint": "Set judgements before skill conversion. No skills by default; result counts include conversion.",
    "power": "Power",
    "seed": "Seed",
    "clock": "Frame rate",
    "mode": "Mode",
    "free": "Free Live",
    "fixedRanks": "Gekisou · fixed ranks",
    "reset": "Reset notes",
    "run": "Calculate",
    "export": "Export JSON",
    "advanced": "Import / export",
    "advancedHint": "JSON preserves note times, frame order, skills and rank confirmations. Imported inputs are validated by Rust.",
    "import": "Import JSON",
    "error": "Calculation failed",
    "ready": "Ready",
    "calculating": "Calculating…",
    "score": "Final score",
    "frameScore": "Last frame display",
    "life": "Life",
    "combo": "Combo",
    "note": "Note",
    "time": "Time",
    "type": "Type",
    "judgement": "Judgement",
    "range": "Range",
    "just": "Just",
    "luck": "Luck points",
    "complete": "Calculated",
    "wrongChart": "The file has another chart or an unsupported format.",
    "importedMode": "Imported mode",
    "incomplete": "Incomplete inputs cannot be shown as a whole-live result.",
    "importedClock": "Imported clock",
    "exactPlan": "Per-note calculation",
    "greatShare": "Great probability",
    "justShare": "Just rate",
    "presetHint": "Perfect takes the remaining probability; Just applies only where eligible. Segments override the whole-song settings; later rows take priority. The seed generates one reproducible play, not an average score.",
    "rawPreset": "Reset the raw input before using these sliders.",
    "wholeSong": "Whole song",
    "planSeed": "Judgement seed",
    "generate": "Generate judgements",
    "editNotes": "View / edit individual notes",
    "segment": "Segment",
    "customSegment": "Custom segment",
    "start": "Start (s)",
    "end": "End (s)",
    "remove": "Remove",
    "probabilityTotal": "Great, Good, Bad and Miss probabilities must add up to at most 100%."
  }
};

export const GUIDE = {
  "zh": {
    "title": "定义、推导与成立条件",
    "lead": "排行与适性展示理论最佳打法的统计参考；谱面详情还可逐音符计算给定输入的一局。两者使用同一套 ournotes-deck Rust 模型，原生逐帧核对的案例见下表。",
    "sections": [
      {
        "title": "得分模型",
        "body": [
          "排行与图表按所选场景计算理论最佳基线：激走开启时，Just 任务区间内为 Just，其余为 Perfect，三个区间默认第 1 名；自由 Live 则关闭激走，全部为 Perfect。基线全连、生命不归零，不带卡上激走技能。详情中的单局计算按你给出的逐音符判定、技能顺序与种子重新运行，第 6 节说明输入方法。整局使用 ournotes-deck live::full 逐帧处理，计分帧为 40 ms。统计表的普通技能模型为效果 2000、持续 5 秒、作用于全体、无条件，卡组得分为"
        ],
        "math": [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (位置 k 带因子 1 的技能时的得分 − score) / P₀,   P₀ = 300000"
        ],
        "after": [
          "score 是模型算出的无技能得分（撃奏ライブ场景含区间排名加成），w_k 是第 k 位成员带一个因子 1（技能值 10000，即 +100%）的普通加分技能时整局多得的分数；两者都除以测量综合力 P₀。技能值换算成因子时有取整（⌊值/10000 × 10⁵⌋/10⁵），各音符得分也有取整，所以上式在取整范围内成立：deck 对每个种子用一副真实技能值的随机卡组、在另一个综合力（1000003）下整局重算，偏差超过上界的谱面直接报错；现有 340 张全部通过。这项核对只说明上式与模拟自洽，不能说明模拟与游戏一致。",
          "每首歌有三个激走任务（连击、幸运或 Just，按歌定义，各难度共用），依次对应谱面的三个 Fever 区间。Just 判定只在 Just 任务区间内开启，所以三个任务里没有 Just 的歌（85 首中 41 首：21 首全是连击、20 首全是幸运）整局都没有 Just；三个任务全是 Just 的有 27 首，另有 17 首连击、幸运、Just 各一个。",
          "按本模型，激走的影响很大：与激走关闭相比，Expert 谱面的无技能得分高 1.6–4.7 倍（中位 2.4 倍）。主要来源是区间排名加成（MasterLiveGekisouRankingScoreBonus）：每个完成的区间再加上该区间得分的一个百分比，按名次查表，默认按第 1 名计；三个激走任务相同的歌（85 首中 68 首）为 250%，三个任务各不相同的（17 首）为 370%，多人游玩时即使是第 5 名也有 100%。按第 1 名计，Expert 谱面的 base 中有 36%–69%（中位 53%）来自它。其次是 Just 任务区间内的 Just 判定（230%，Perfect 为 100%）：区间长、Just 音符多的谱面倍数最高，4.7 倍的那张三个 Just 区间共约 52 秒、233 个 Just 音符；连击任务区间的激走连击系数在没有激走技能时影响很小（约 1%）。技能落在激走区间内时，排名加成随之放大，所以区间内的技能位权重明显更高。",
          "幸运任务区间的抽签与幸运冲刺取自本局的随机种子。含幸运区间的谱面（340 张中 148 张）给出前 8 个公开种子的结果，本页取种子平均，并在详情里给出种子间 base 的区间（中位相差 1.3%，最大 4.2%）。游戏的种子规律未知，所以种子平均未必等于游戏内的真实期望。"
        ]
      },
      {
        "title": "游玩场景与名次",
        "body": [
          "每个激走区间按任务指标（连击、幸运点数或 Just 数）决定名次，再按任务模式与名次查表加入区间得分的百分比。排行和适性允许三个区间各选 1–5 名，默认均为第 1 名；这些固定名次参考由原 Solo 区间计分方法得出，名次调整使用下式：",
          "单局 JSON 可给出固定 Solo 名次，由完整引擎结算；外部排名输入则明确给出确认帧、区间、名次与加成百分比，采用客户端的帧快照计分。两种方式不同。本页不模拟对手、网络延迟或服务器裁定。"
        ],
        "math": [
          "base_r = ( score − Σ_i B_i + Σ_i trunc( RS_i · p_i(r_i) / 100 ) ) / P₀",
          "w_r[k] = w[k] + Σ_i ( p_i(r_i) − p_i(1) ) / 100 · u_i[k]"
        ],
        "after": [
          "RS_i 是区间 i 的得分，p_i(r) 是区间 i 在名次 r 时的加成百分比，B_i = trunc(RS_i · p_i(1) / 100) 是名次 1 的加成（现有数据的每个种子、每个区间都满足这个等式），u_i[k] 是位置 k 的技能让区间 i 多得的分数 ÷ P₀。依据：从反编译代码看，加成在区间结束时一次性记入，不改变之后音符的得分系数；名次只影响一种技能条件（7012），现有主数据里没有技能用到它。所以按本模型，换名次只改变加成这一项，w_r 的误差来自技能加成的取整，小于 3/P₀。deck 另用随机名次整局实跑核对了这组线性式，现有数据全部落在误差上界内。按本模型，三个区间全是第 1 名时的无技能得分是全是第 5 名时的 1.25–1.65 倍（340 张谱面，中位 1.46 倍）。",
          "自由 Live 场景的数值来自另一次激走关闭的整局模拟，不是从撃奏ライブ减去加成得到的：关闭激走时也没有 Just、激走连击系数和幸运冲刺。关闭激走时没有幸运抽签，本页用到的技能也没有概率条件，所以每张谱面只有一个种子；Fever 超过 3 个、撃奏ライブ无法游玩的谱面，在自由 Live 场景照常计算。",
          "从反编译代码看，撃奏ライブ同时上报两套分数：一套含全部激走效果（Just、幸运、激走连击、排名加成和激走技能），本页撃奏ライブ场景的数值对应这一套（暂不含激走技能，第 7 节）；另一套不含任何激走效果（激走技能也不计），存为歌曲的最高分，按本模型约等于自由 Live 的分数。谱面详情里两个数字都列出。服务器怎样使用这两套分数（例如计算活动积分），客户端代码里看不到。"
        ]
      },
      {
        "title": "技能顺序是随机变量",
        "body": [
          "从反编译代码看，客户端在每局开始时构造 MemberDataContainer：先把技能顺序置为 0…n−1，再用 MemberShuffle 随机流做 Fisher–Yates 洗牌；种子取自客户端时钟，单人重试沿用同一种子（顺序也不变）。第 e 个技能事件触发洗牌后第 e 位成员的技能，Snap 技能的列表按同一顺序构建。因此本页把 π 当作在 5! = 120 种排列上均匀分布，卡组里的站位不是可选变量。"
        ],
        "math": [
          "E[S] / P = base + x̄ · W,   x̄ = (1/n) Σ_i x_i,   W = Σ_k W_k",
          "Var[S / P] = (1/(n−1)) · Σ_i (x_i − x̄)² · Σ_k (W_k − W̄)²"
        ],
        "after": [
          "推论一：期望只取决于技能平均值 x̄，与技能在成员间如何分配、谁在第几位无关。“最强技能放在权重最高的位置”只是 120 种排列中最好的一种，是上界，不是期望。",
          "推论二：离散度等于技能离散度与位置权重离散度的乘积；5 个技能相同时，每一局得分都相同。按本模型，以技能 [140, 100, 60, 30, 0]% 为例，在全部 Expert 谱面上，最好与最差排列相差中位 15.4%、最大 29.2%，最佳排列比期望高中位 7.6%；激走区间让位置权重差距拉大，顺序的影响远大于不计激走时。页面给出期望、120 种排列的区间和 P10。",
          "单局计算不取 120 种顺序的平均。JSON 明确列出成员、skillOrder 与 seed；技能事件依次映射到该顺序，成员属性与配对支援仍随成员记录。相同数据与输入可以重放同一局。"
        ]
      },
      {
        "title": "效率与支配",
        "body": [
          "一局耗时 T = L + c。L 有两种取法：BGM 时长（ACB cue 长度，未解码音频），或谱面长度（末音 + 1 s，也就是得分代码使用的乐曲长度）；c 是打歌以外的时间。实机上一局从哪一刻进入结算尚未测定，所以两种 L 都提供，结论分别成立。"
        ],
        "math": [
          "效率 = E[S] / (P · T) = (base + x̄ W) / (L + c)",
          "a ≻ b  ⇔  ∀ x̄ ∈ [0, x_max], ∀ c ≥ 0:  S_a(x̄)/(L_a + c) ≥ S_b(x̄)/(L_b + c)，且至少一处严格"
        ],
        "after": [
          "固定 x̄ 时，两边之差乘以 (L_a + c)(L_b + c) 后对 c 是线性的；固定 c 时对 x̄ 也是线性的。所以只需检查四个角点：S_a ≥ S_b 与 S_a/L_a ≥ S_b/L_b 在 x̄ = 0 和 x̄ = x_max 处成立。x_max = 150%，取自主数据中单个技能的最大值（MasterLiveSkillEffect，满级）。不设上界时，一些 Easy 谱面只能靠不存在的 500% 以上技能值留在前沿上。",
          "上述前沿结论适用于同一理论最佳统计基线。更换场景或固定名次须重新比较；任意混合判定、断连与技能组合的单局结果不能套用同一个准率系数。",
          "比较的前提是同一卡组在两首歌上综合力相同。卡牌的曲种加成（musicType）和标签加成会使 P 随歌曲变化，这时应比较 P_a S_a 与 P_b S_b。"
        ]
      },
      {
        "title": "评级与活动",
        "body": [
          "评级门槛按歌定义：MasterLiveMusic._liveScoreRankGroup 指向 MasterLiveScoreRank 的一组行，同一首歌的所有难度共用；得分达到的最高门槛就是评级。自由 Live 用单人门槛 R（_requiredScore）。撃奏ライブ用另一组门槛 R_battle（_battleLiveRequiredScore），按房间内全员得分之和评级：总分对比 trunc(√(5/n) · R_battle · n)（n 为未断线人数），E 计作 D。页面在撃奏ライブ场景下假设房间 n 人（默认 5，可选 1–5）且全员与你同分，于是你的所需分数约为 √(5/n) · R_battle；队友得分高于或低于你时，你实际需要的分数会随之变低或变高。",
          "反编译代码中的活动积分计算如下，其中 v 由（活动，评级）查表，加成来自卡组，倍率在消耗 k 个 boost 时为 5k、不消耗时为 1："
        ],
        "math": [
          "积分 = trunc( (10000 + 加成) · 倍率 · v(活动, 评级) / 10000 )",
          "按时间:  max_s  Σ_r v(r) · Pr_s(评级 = r) / (L_s + c)",
          "a ≻_活动 b  ⇔  L_a ≤ L_b  且  ∀ r, ∀ x̄ ∈ [0, x_max]:  S_a(x̄)/R_a(r) ≥ S_b(x̄)/R_b(r)"
        ],
        "after": [
          "歌曲只通过评级进入积分，所以每个 boost 换到的积分与选哪首歌无关；歌曲的差别只在于各评级的达成概率和一局的时长。活动支配只要求 v 随评级不减，不需要知道积分表：满足上式时，任何卡组达成任何评级在 a 上所需的综合力都不高于 b，而 a 不更长。",
          "积分表可以反推，不必等主数据：一局的加成和倍率已知，所以 v = 积分 × 10000 / ((10000 + 加成) × 倍率)，截断带来的误差小于 1/倍率；每个评级一条样本就能唯一确定 v。",
          "达成率是在 120 种技能顺序上 P · S_π ≥ R 成立的比例（S 为所选场景的理论最佳基线）；所需综合力取期望，区间取最好与最差排列。按本模型，技能全 140%、撃奏ライブ名次 1、5 人房间时，Expert 达到 SS 所需综合力从 27 万到 205 万，相差 7.5 倍。SS 门槛对本模型的得分容量做过原点的最小二乘拟合，中位相对残差约 32%：门槛看来不是按容量定的，所以活动选曲最好逐曲计算，不宜直接拿效率排行代替。85 首歌里有 20 首的 Hard 比 Expert 更容易拿到 SS。"
        ]
      },
      {
        "title": "判定与单局计算",
        "body": [
          "判定倍率为 Perfect 100%、Great 80%、Good 50%、Bad 与 Miss 0；Bad 与 Miss 断连。Just 为 230%，客户端通常在 Just 任务区间开启，判定转换技能也可能改变结果。相同比例的判定落在不同音符上，得分可能不同。",
          "排行的准度滑块用于参考估算：Great 比例按整体得分缩放，Just 率在两种基线之间插值，不处理断连，也不能完整反映判定转换和累计技能。详情中的单局计算使用具体的逐音符判定，由 Rust 完整模拟；同一准率在不同音符位置出现，结果也可能不同。"
        ],
        "math": [
          "Perfect 100% · Great 80% · Good 50% · Bad / Miss 0% · Just 230%"
        ],
        "after": [
          "谱面详情的单局计算默认无技能、判定音符全 Perfect，不计分的节点保留 Pass。可逐音符修改判定；要指定普通／支援／激走技能、技能顺序、种子、名次或逐帧时间，可导出模板 JSON 后编辑并导入。未知音符、重复结果、缺失音符及非法时钟会报错，不会默补 Miss。",
          "浏览器的 WASM 直接调用与数据工具相同的 Rust 引擎，逐帧处理判定转换、连击、生命、技能与激走结算。音频长度与计分表长度分别传入；默认模板为 60 Hz，也支持 30／120 Hz，时钟会影响发动与结算时机。结果给出同帧分数与结算计算器分数、生命、当前连击、逐帧连击峰值、转换后各判定数量及区间任务指标。",
          "这是按明确判定流得到的该局结果。它不从触控动作推导判定，也不保证与设备上的真实触控相同。带窗口效果时须提供原始判定元数据；引擎不支持的输入或效果会报错。排行与适性仍用理论最佳统计基线，不再用 Great／Just 比例或两端插值替代这一局。"
        ]
      },
      {
        "title": "激走技能",
        "body": [
          "建模了什么。成员卡带激走技能，与它配对的支援卡带激走支援技能。从反编译代码看，它们只在激走开启时建立，只加进含激走的那套分数（battleLiveScore），不进不含激走的那套（soloScore），自由 Live 里也没有。每个技能属于一种激走任务（连击、幸运或 Just），只在同任务的区间里触发，与演奏位置和洗牌无关；支援技能可以带乐队条件（条件 5000），看配对的成员是否属于指定乐队。效果按类型有激走连击加成、幸运槽倍率、加幸运点、加满槽、Just 数加成与累计 Just、幸运冲刺期间的得分加成、每 10 连击或每个 Just 的加分，以及连击保护、Great 转 Perfect、转 Just、放宽 Just 判定等，ournotes-deck 在整局模拟里逐帧计算这些效果。",
          "名次与判定。固定名次的统计参考使用第 2 节的区间加成公式；实际单局按给定判定流运行。判定转换、每个 Just 加分与累计 Just 可能改变后续状态，不能用平均准率缩放这些效果。",
          "理论最佳基线不能体现所有技能的收益。连击保护与判定转换需要对应的断连或判定输入，窗口放宽需要原始判定元数据；只提高任务指标的技能可能帮助真实对局取得更高名次，但固定名次参考不会自动改变名次。可用单局 JSON 核对具体输入下的效果。",
          "种子。幸运区间的抽签取自本局的随机种子，幸运类激走技能的效果也随种子变化，所以带激走技能时幸运区间的种子间差别可能更大。页面取所给种子的平均，这不是游戏里的期望，游戏的种子规律未知。演奏位置每局洗牌，但激走技能与位置无关；洗牌只改变单个种子里概率判定的抽取次序，不改变期望。",
          "原生覆盖按场景记录在验证表中。普通技能和不带卡上激走技能的更新链已有逐帧证据；这不代表每种卡上激走技能及所有组合都已验证。未核对的效果和条件仍是未核对。",
          "适性只测单个技能。每个成员卡激走技能取最高等级，每个支援卡激走支援技能取最高突破时的等级；计分参数相同的技能合并成形状，乐队条件分匹配与不匹配。成员技能由一名演奏者单独携带；支援技能搭配同任务、无效果的合成空激走技能，统一测量，不借用真卡。数据缺失时显示“数据待更新”，不会当作零。排行与图表的默认基线仍不带卡上激走技能。",
          "适性增量由同一随机种子下带与不带单个技能的整局相减得到。理论最佳、名次 1 使用 score 增量均值；普通技能倍率与名次调整使用已导出的权重和区间增量，是受取整与线性假设限制的参考。具体技能与混合判定的一局使用第 6 节的完整引擎。",
          "多个技能的增量不能相加：激走连击系数会饱和，幸运冲刺支援与幸运槽技能存在交互，判定转换也可能改变其它效果的触发；这些不能用单技能增量拼出整副编成。适性是单个技能的响应，不是组卡结果。谱面因子列出区间判定音符、Just 音符、Just 区间只能 Perfect 的音符、End 至 Complete 的尾部音符、开始时连击及无技能抽签次数，用来解释差异。",
          "每项 [均值, 标准误] 的标准误是样本标准差除以种子数的平方根，不是模型误差。先检查随机依赖，再做四种子探测；四次相等不能单独证明确定性。随机变体从 32 个种子逐批加倍，护栏为 65536；理论最佳与全 Perfect 两端的 score 增量都须达到目标：增量绝对值的 1% 与同种子无技能基线的 0.1% 中较宽者。可能只满足基线目标，不表示增量达到 1%。正式产物要求两端都达标，护栏内未收敛就拒绝生成。交叉项最多取前 64 个种子，缺少协方差，不能当作独立误差合成。",
          "适性没有全 Perfect 打法的普通技能交叉权重。缺少对应权重的统计调整只能作有限精度参考；任意判定与多技能组合须交给单局计算，不能拼接端点增量。"
        ],
        "defs": [
          [
            "概率发动（条件 4011）",
            "模型按技能随机流抽取 float32 值，再与发动门槛比较。当前主数据的条件 4011 用于幸运激走成员技能 11003 与支援技能 11005。两组真实卡与支援的原生整局核对已通过，包含发动、未发动及 5% 概率成功分支，结果见下表。给定种子的单局结果由完整模型计算；种子平均与标准误用于描述适性。普通技能输入表示无条件加分，不能用 p × 技能值替代概率效果。"
          ]
        ]
      },
      {
        "title": "统计表的范围",
        "defs": [
          [
            "其它技能类型",
            "统计表的 deck.kinds 列出与因子线性相关的加分类别（2000、2002、2004、2005），本页倍率输入只用普通加分。累计加分、判定转换、支援与激走技能的具体组合需完整模拟，可在单局 JSON 中提供模型支持的技能 ID、等级及成员属性；未知 ID 或不支持的效果会报错。"
          ],
          [
            "撃奏ライブ的对手",
            "本页不推演房间内其他玩家的任务指标。统计参考直接选择固定名次；单局的外部排名必须显式输入确认。线上同分顺序、掉线、补位与服务器结算不能由固定名次结果推断。"
          ],
          [
            "Snap 技能",
            "统计表不计 Snap 技能的具体条件组合。单局可明确提供配对支援技能与成员属性，完整引擎按生命、判定数、乐队等条件逐帧处理。"
          ],
          [
            "实机一局耗时",
            "进入结算的时刻、加载时间都依赖设备和网络，由每局额外耗时 c 表示；支配关系对所有 c ≥ 0 成立。"
          ]
        ]
      },
      {
        "title": "谱面事实的口径",
        "defs": [
          [
            "等级",
            "显示等级（_musicScoreDisplayLevel，可带小数）；得分使用整数等级（_musicScoreLevel）。"
          ],
          [
            "Notes",
            "判定音符数，也就是全连连击数；不含隐藏音符、导引终点和不判定的长条节点。音符构成按 NoteOperateType 归类：点击 {1, 101}、划键 {40, 41, 42, 102}、长条 {20, 21, 22}、追踪 {60–63, 104, 105}、连击节点 {120}。"
          ],
          [
            "主 BPM、密度",
            "主 BPM 是第一个到最后一个判定音符之间持续时间最长的 BPM；密度 = 判定音符数 ÷ 这段区间的秒数。"
          ],
          [
            "基础系数、W、跳过系数",
            "base 与 W 定义见第 1、3 节，均属于所选场景的理论最佳统计基线：激走开启时含固定名次的区间加成，自由 Live 没有。跳过系数是每点综合力的跳过得分（全部 Great、连击为 0、无技能），与时长无关，本页不随场景变化。"
          ]
        ]
      },
      {
        "title": "原生代码核对",
        "body": [],
        "table": {
          "headers": [
            "场景 / 输入",
            "实际核对内容",
            "结果",
            "尚未核对的情况"
          ],
          "rows": [
            [
              "10000201；综合力 300000；无技能；激走关闭",
              "5500 帧、13 字段、71500 项比较；364 次判定事件",
              "零差异；六项 float32 因子逐位相等",
              "全新无回退流程；模拟器最大连击不等于受保护的 live 最大连击"
            ],
            [
              "五成员普通技能 1；全 Perfect 与混合 P/Great/Good/Bad/Miss",
              "每例 5500 帧、253000 项核心比较；原生 SkillExecutor 触发、池、阶段与应用分派",
              "零差异；float32 最大 ULP 为 0",
              "只覆盖无条件 2000 家族；排除 elapsed 镜像；并非完整游戏生命周期"
            ],
            [
              "真实技能 1/4/6/7/5；高/中/低准度 × 30/60/120 fps",
              "九组共 57750 帧；35 个效果池实例；18826500 项核心比较；谱面事件与转换判定同序",
              "零差异；float32 最大 ULP 为 0",
              "覆盖指定目标与生命条件，未覆盖全部技能或输入窗口"
            ],
            [
              "非零逐音符击打偏移",
              "原生实际 P274 / Great58 / Good32；5500 帧、1793000 项核心比较",
              "零差异；float32 最大 ULP 为 0",
              "原生自动输入窗口分类；Rust 仍消费原生判定，不是独立触摸重放"
            ],
            [
              "生命条件边界 700→600",
              "5500 帧；45 个效果池实例；2288000 项核心比较",
              "零差异；float32 最大 ULP 为 0",
              "700 时选择高生命效果；降至 600 后已有效果继续，不切换低生命效果"
            ],
            [
              "真实高等级技能 3/5/1/2/7，等级 5",
              "5500 帧、1545500 项核心比较；覆盖实际 float32 技能因子",
              "零差异；已比较 float32 最大 ULP 为 0",
              "限定此技能组合；13000 的转换结果为 1.29999…，不能手填成 1.3"
            ],
            [
              "真实卡上激走与支援；八组高中低准度及 30/60/120 fps",
              "48750 帧、35777250 项比较；效果池、转换判定、连击保护、累计 Just、幸运槽与 rush",
              "声明字段零差异；float32 逐位一致",
              "指定卡与支援配置；成员综合力相关效果、完整失败与结算转场另需核对"
            ],
            [
              "Just 动态窗口；发布模型的公共 API",
              " 1600 帧原生捕获；9 类窗口、39 个 unit；388800 项窗口及 62400 项核心比较",
              "451200 项零差异；启闭与窗口宽度均相同",
              "窗口状态与宽度、计分、生命和当前连击；输入为已分类判定"
            ],
            [
              "概率发动 4011；真实成员卡 43 / 支援 66；高生命与生命 600 + 4 Miss",
              "两组共 15000 帧、10680000 项核心比较；72 项随机值、门槛与布尔结果核对",
              "零差异；终分分别 2835163 / 2760861",
              "seed 14 定向覆盖 5% 成功分支；这是固定输入核对，不是概率分布测量"
            ],
            [
              "单人激走：连击 / Just / 幸运；无卡上技能",
              "10000103 / 10000201 / 10000303；19000 帧、646000 项整数比较",
              "所列双分数、生命、连击、随机次数及区间状态零差异",
              "部分区间计数与 float32 字段尚缺同义对应；帧分数观察与 score() 分开"
            ],
            [
              "离线多人：连击 / Just / 幸运；实际混判及生命归零",
              "19000 帧、646000 项核心比较；76000 项排名推导比较另列",
              "零差异；幸运场景实际原生随机抽取 431 次",
              "无卡上技能、独立触摸窗口、完整失败转场或服务器奖励；排名推导字段不是生产观察接口"
            ],
            [
              "原生多人排名",
              "572 组调用案例，含同分、次指标、缺输入与错误边界",
              "15259 项精确比较，零差异",
              "是子系统测试，不是 572 局；同分组内原始成员顺序不属 Rust API 承诺"
            ],
            [
              "挑战 Live：无辅助 / FullCombo / AllPerfect；实际混判",
              "三组 5858 帧、1382503 项核心比较；原生进入、更新与退出",
              "声明字段零差异；另核对 Bad / Good 导致的原生重试分支",
              "重试条件为原生端观察；动画采用零延迟完成，未核对完整结算页或服务器"
            ],
            [
              "Mission / SoloGekisou；混判、断连与生命归零",
              "5502 帧、1469049 项核心比较；22008 项排名推导比较另列",
              "零差异；终分 439015；同帧显示分与计分器分数分别核对",
              "未核对完整结果页/服务器；派生排名不是独立的生产观察字段"
            ],
            [
              "自由 / 单人激走 / 挑战 / 任务 / 多人 / Arena / 教程",
              "执行七种原生设置入口及谱面、启动分支",
              "仅入口证据；全模式覆盖仍待完成",
              "进入模式不等于整局通过；真实活动、Arena master 与服务器生命周期另需验证"
            ]
          ],
          "caption": "客户端 1.0.1-25 · 核对记录 2026-09-30"
        },
        "after": [
          "表中核对的整数全部相等，float32 按位一致。模型通过 272 项回归测试，逐音符计算的 Rust 与 WASM 结果也已在全部 340 张谱面核对一致。"
        ]
      }
    ],
    "reminder": {
      "title": "与其它资料不一致时",
      "text": "比较时请对齐版本、谱面、场景、综合力、判定流、技能、顺序、种子和帧时钟；反馈差异时请附输入 JSON 与结果。统计采样误差、有限精度参考与原生核对范围各见上文。",
      "priority": "当你发现和其他资料不一致时，那就是其他资料是对的。"
    },
    "contentsLabel": "目录",
    "methodsLabel": "核对方法与尚未覆盖的情况",
    "method": {
      "title": "来源与核对方法",
      "text": "谱面与主数据来自游戏资源，经 nnnotes 提取；数值由 ournotes-deck 的 Rust 模型计算。我们在离线 ARM64 模拟器 Unicorn 中直接运行游戏客户端的 libil2cpp 二进制，固定谱面、技能、种子和帧时钟，与 Rust 模型逐帧核对计分、生命、连击、技能与排名。文件、音频、显示和 Unity JSON 对象装配使用替身，计分运算仍执行原生指令。表中核对的整数完全相等、float32 按位一致，说明模型在这些条件下重现了客户端的计算；范围不包含真实设备或服务器结算。"
    }
  },
  "en": {
    "title": "Definitions, derivations and conditions",
    "lead": "Rankings and aptitude show statistical references for theoretical best play. Chart details can also calculate one play from per-note inputs. Both use the same ournotes-deck Rust model; the native frame checks are listed below.",
    "sections": [
      {
        "title": "Score model",
        "body": [
          "Rankings and charts use the selected scenario’s theoretical best baseline: with Gekisou on, Just inside Just missions and Perfect elsewhere, all ranges at rank 1 by default; Free Live disables Gekisou and uses Perfect throughout. The baseline has a full combo, life above zero and no card Gekisou skills. The single-play calculator runs your per-note judgements, skill order and seed again; section 6 explains its inputs. ournotes-deck live::full processes the whole live frame by frame, with 40 ms score frames. The statistics use ordinary effect 2000: 5 seconds, all members, no condition. A deck scores"
        ],
        "math": [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (score with a factor-1 skill at position k − score) / P₀,   P₀ = 300000"
        ],
        "after": [
          "score is the model's no-skill score (in Gekisou Live with the range rank bonuses), w_k the score a factor-1 plain skill (value 10000, +100 %) on the member at position k adds over the whole live; both per point of the measurement power P₀. The value becomes a factor with a floor (⌊value/10000 × 10⁵⌋/10⁵) and every note score is floored, so the formula holds up to the floors: for every seed deck plays a random deck of real skill values at another power (1000003) through the whole live, and a chart whose deviation exceeds the bound fails. All 340 current charts pass. This check only shows that the formula agrees with the simulation, not that the simulation agrees with the game.",
          "Every song has three Gekisou missions (combo, luck or Just, set per song and shared by every difficulty), one for each of the chart's three fevers in order. Just judgements are only on inside Just mission ranges, so the songs without a Just mission (41 of 85: 21 all combo, 20 all luck) have no Just all live; 27 songs have three Just missions, and 17 have one each of combo, luck and Just.",
          "By this model Gekisou weighs a lot: against Gekisou off, an Expert chart's no-skill score is 1.6–4.7 times higher (median 2.4). Most of it is the range rank bonus (MasterLiveGekisouRankingScoreBonus): every completed range adds a percentage of its own score, looked up by rank, rank 1 by default; that is 250 % on the songs whose three missions are the same (68 of 85) and 370 % on those whose three missions all differ (17), and in multiplayer even rank 5 gets 100 %. At rank 1 it makes 36–69 % (median 53 %) of an Expert chart's base. Next come the Just judgements inside Just mission ranges (230 %, against 100 % for a Perfect): charts with long ranges and many Just notes gain the most, and the 4.7 times chart has three Just ranges of about 52 s in all with 233 Just notes; the Gekisou combo factor of combo mission ranges matters little without Gekisou skills (about 1 %). A skill inside a Gekisou range raises the rank bonus too, so the positions inside ranges weigh much more.",
          "Luck mission ranges draw their lottery and luck rushes from the live's random seed. Charts with a luck range (148 of 340) come with the first 8 published seeds; the page takes the mean over the seeds and shows the seeds' base range in the details (1.3 % apart at the median, 4.2 % at most). The game's seed law is unknown, so the seed mean need not equal the game's own expectation."
        ]
      },
      {
        "title": "Play scenarios and ranks",
        "body": [
          "Each Gekisou range awards a percentage of its score using the mission pattern and placement derived from combo, luck points or Just count. Rankings and aptitude let you select rank 1–5 for each range, rank 1 by default. These fixed-rank references use the original Solo range scoring method; the statistical adjustment is:",
          "A single-play JSON can specify fixed Solo ranks and let the complete engine settle them. External ranking instead supplies the confirmation frame, range, group rank and bonus percentage, using client frame snapshots. These are different inputs. The page does not simulate opponents, network delays or server decisions."
        ],
        "math": [
          "base_r = ( score − Σ_i B_i + Σ_i trunc( RS_i · p_i(r_i) / 100 ) ) / P₀",
          "w_r[k] = w[k] + Σ_i ( p_i(r_i) − p_i(1) ) / 100 · u_i[k]"
        ],
        "after": [
          "RS_i is range i's score, p_i(r) range i's bonus percent at rank r, B_i = trunc(RS_i · p_i(1) / 100) the rank-1 bonus (every range of every seed of the current data meets this), and u_i[k] the score the skill at position k adds to range i, per P₀. Why: by the decompiled code the bonus is added once at the range's end and leaves the score factors of the notes after it alone, and the rank reaches one skill condition only (7012), which no skill of the current master data uses. So by this model a rank changes the bonus term only; w_r is off by the skill floors, less than 3/P₀. deck also runs whole lives at random ranks against these formulas, and the current data stays within the error bound. By this model the no-skill score at rank 1 in all three ranges is 1.25–1.65 times that at rank 5 (340 charts, median 1.46).",
          "The Free Live figures come from a separate whole-live simulation with Gekisou off, not from Gekisou Live minus the bonuses: without Gekisou there are no Just judgements, Gekisou combo factor or luck rushes either. Without Gekisou there is no luck lottery, and the page's skill has no probability condition, so every chart has one seed; charts with more than 3 fevers, unplayable in Gekisou Live, are computed as usual in Free Live.",
          "By the decompiled code, Gekisou Live reports two scores: one with every Gekisou effect (Just, luck, the Gekisou combo, the rank bonuses and the Gekisou skills), which the page's Gekisou Live figures stand for (without the Gekisou skills for now, section 7); the other without any Gekisou effect (Gekisou skills included), kept as the song's best score, by this model about the Free Live score. The chart details show both. How the server uses the two (for event points, say) is not in the client code."
        ]
      },
      {
        "title": "The skill order is random",
        "body": [
          "From the decompiled code: at the start of every live the client builds MemberDataContainer; the skill order is set to 0…n−1 and Fisher–Yates shuffled with the MemberShuffle random stream, seeded from the client clock (a solo retry keeps the seed, and the order). Skill event e fires the member at position e of the shuffled order, and the snap skill lists follow the same order. So the page takes π as uniform over the 5! = 120 orders; the deck's slot order is not a choice."
        ],
        "math": [
          "E[S] / P = base + x̄ · W,   x̄ = (1/n) Σ_i x_i,   W = Σ_k W_k",
          "Var[S / P] = (1/(n−1)) · Σ_i (x_i − x̄)² · Σ_k (W_k − W̄)²"
        ],
        "after": [
          "First: the expectation depends on the mean skill value only, not on how the values are spread over members or who stands where. The strongest skill on the heaviest position is the best of the 120 orders, an upper bound, not the expectation.",
          "Second: the spread is the product of the skills' spread and the position weights' spread; five equal skills score the same every live. By this model, with skills [140, 100, 60, 30, 0] % over every Expert chart, the best and the worst order differ by 15.4 % at the median and 29.2 % at most, and the best order is 7.6 % (median) above the expectation; the Gekisou ranges pull the position weights apart, so the order matters far more than without Gekisou. The page shows the expectation, the range over the 120 orders and P10.",
          "A single play does not average the 120 orders. Its JSON specifies performers, skillOrder and seed. Chart skill events map to that order; member attributes and paired supports remain with their performer record. The same data and inputs replay the same play."
        ]
      },
      {
        "title": "Efficiency and dominance",
        "body": [
          "A play takes T = L + c: L is the BGM length (the ACB cue length, audio not decoded) or the chart length (last note + 1 s, the music length of the score code), c the time outside the song. When a live hands over to the results on a device is not measured yet, so both L are offered and every result holds for each."
        ],
        "math": [
          "efficiency = E[S] / (P · T) = (base + x̄ W) / (L + c)",
          "a ≻ b  ⇔  ∀ x̄ ∈ [0, x_max], ∀ c ≥ 0:  S_a(x̄)/(L_a + c) ≥ S_b(x̄)/(L_b + c), strictly somewhere"
        ],
        "after": [
          "For a fixed x̄ the difference times (L_a + c)(L_b + c) is linear in c, and for a fixed c it is linear in x̄, so four corners decide: S_a ≥ S_b and S_a/L_a ≥ S_b/L_b at x̄ = 0 and at x̄ = x_max. x_max = 150 %, the largest single skill value in the master data (MasterLiveSkillEffect, level 5). Without a bound, some Easy charts stay on the frontier only for skill values above 500 %, which do not exist.",
          "This frontier result applies to one theoretical-best statistical baseline. A different scenario or fixed rank needs a new comparison. Arbitrary mixed judgements, breaks and skill combinations cannot share one accuracy multiplier.",
          "The comparison assumes the deck has the same power on both songs. Card song-type (musicType) and tag bonuses make P depend on the song; then compare P_a S_a with P_b S_b."
        ]
      },
      {
        "title": "Score ranks and events",
        "body": [
          "Rank thresholds are per song: MasterLiveMusic._liveScoreRankGroup selects rows of MasterLiveScoreRank, shared by every difficulty; the rank is the highest threshold the score reaches. Free Live uses the solo threshold R (_requiredScore). Gekisou Live has thresholds of its own, R_battle (_battleLiveRequiredScore), and rates the sum of every player's score in the room against trunc(√(5/n) · R_battle · n) for n connected players, E counting as D. In Gekisou Live the page takes a room of n players (5 by default, 1–5) who all score the same as you, so you need about √(5/n) · R_battle; teammates scoring above or below you lower or raise what you actually need.",
          "In the decompiled code event points are computed as below; v comes from the (event, rank) table, the bonus from the deck, and the rate is 5k for k boosts spent, 1 for none:"
        ],
        "math": [
          "points = trunc( (10000 + bonus) · rate · v(event, rank) / 10000 )",
          "by time:  max_s  Σ_r v(r) · Pr_s(rank = r) / (L_s + c)",
          "a ≻_event b  ⇔  L_a ≤ L_b  and  ∀ r, ∀ x̄ ∈ [0, x_max]:  S_a(x̄)/R_a(r) ≥ S_b(x̄)/R_b(r)"
        ],
        "after": [
          "The song enters the points only through the rank, so the points a boost buys do not depend on the song; songs differ only in their rank chances and their length. Event dominance needs no point table, only v non-decreasing in the rank: when it holds, any deck needs no more power on a than on b for any rank, and a is no longer.",
          "The table can be recovered without the master data: bonus and rate of a live are known, so v = points × 10000 / ((10000 + bonus) × rate) with a truncation error below 1/rate; one result per rank determines v.",
          "The chance is the share of the 120 skill orders with P · S_π ≥ R (S from the selected theoretical-best baseline); the power needed uses the expectation, its range the best and the worst order. By this model, with every skill at 140 %, in Gekisou Live at rank 1 in a room of 5, SS on Expert needs 0.27 to 2.05 million power, a factor 7.5. A least-squares fit through the origin of the SS thresholds against this model's score capacity leaves a median relative residual of about 32 %: the thresholds do not seem to be set by capacity, so event choices are best computed song by song rather than read straight off the efficiency ranking. For 20 of the 85 songs SS is easier on Hard than on Expert."
        ]
      },
      {
        "title": "Judgements and one-play calculation",
        "body": [
          "Judgement factors are Perfect 100%, Great 80%, Good 50%, Bad and Miss 0%; Bad and Miss break combo. Just is 230%, normally enabled by the client inside Just missions, and conversion skills may change the result. The same grade proportions on different notes can produce different scores.",
          "Ranking accuracy sliders are estimates: Great scales the overall score and Just interpolates between two baselines. They do not model combo breaks or all judgement-conversion and cumulative effects. The detail’s one-live calculator simulates explicit per-note results in Rust; equal accuracy percentages at different notes can produce different scores."
        ],
        "math": [
          "Perfect 100% · Great 80% · Good 50% · Bad / Miss 0% · Just 230%"
        ],
        "after": [
          "The chart’s single-play calculator defaults to no skills and Perfect on judged notes, retaining Pass on unscored nodes. Edit individual judgements, or export the template JSON and import it after setting ordinary, support and Gekisou skills, order, seed, ranks or frame times. Unknown notes, duplicate or missing results and invalid clocks fail; missing notes are not silently turned into Miss.",
          "Browser WASM calls the same Rust engine as the data tools. It processes conversion, combo, life, skills and Gekisou settlement frame by frame. Audio length and score-table length are separate inputs. The default clock is 60 Hz; 30/120 Hz are also supported, and the clock can affect activation and settlement. Results include same-frame score and settled calculator score, life, current combo, maximum sampled frame combo, converted judgement counts and range mission measures.",
          "This is the result for the declared judgement stream. It does not derive judgements from touch actions or guarantee the same results as physical play on a device. Window effects require original result metadata; unsupported inputs or effects fail. Rankings and aptitude retain their theoretical-best baseline, without Great/Just share scaling or endpoint interpolation replacing that play."
        ]
      },
      {
        "title": "Gekisou skills",
        "body": [
          "What is modelled. Member cards carry Gekisou skills, and the support cards paired with them Gekisou support skills. By the decompiled code they are only set up with Gekisou on and only add to the score with Gekisou (battleLiveScore), never to the one without (soloScore), and Free Live has none of them. Every skill belongs to one Gekisou mission (combo, luck or Just) and only triggers in the ranges of that mission, independent of the performance position and the shuffle; a support skill can carry a band condition (condition 5000) on whether its paired member is in a given band. By type the effects are the Gekisou combo bonus, the luck gauge multiplier, luck points, a full gauge, the Just count bonus and cumulative Just, a score up during luck rushes, points per 10 combo or per Just, and combo protection, Great to Perfect, conversion to Just, a looser Just judgement and a few more; ournotes-deck computes them frame by frame in the whole-live simulation.",
          "Ranks and judgements. Fixed-rank statistical references use the range bonus formula in section 2; a single play runs its declared judgement stream. Conversion, per-Just scoring and cumulative Just can change later state, so an average accuracy multiplier does not calculate these effects.",
          "A theoretical-best baseline cannot show every skill’s benefit. Protection and conversion need the relevant breaks or grades, and wider windows need original result metadata. A skill that raises mission measures may improve a real placement, but a fixed-rank reference does not change its placement automatically. Single-play JSON can check a concrete input.",
          "Seeds. Luck ranges draw from the live's random seed, and so do the luck Gekisou skills' effects, so with Gekisou skills the luck ranges may spread wider between seeds. The page takes the mean over the seeds given, which is not the game's own expectation; the game's seed law is unknown. The performance positions are shuffled every live, but Gekisou skills do not depend on the position; the shuffle only reorders a seed's probability draws and leaves the expectation alone.",
          "Native coverage is now documented by case in the validation table. Ordinary-skill and no-card-Gekisou update chains have frame comparisons; this does not certify every card Gekisou skill or every combination. Unchecked effects and conditions remain unchecked.",
          "Aptitude measures one skill at a time. Member Gekisou skills use their highest level, support skills their highest limit-break level. Equal scoring parameters share a shape; band conditions have matched and unmatched variants. One performer carries a member skill alone; a support skill uses a synthetic empty Gekisou skill of its mission, not a real card. Missing data is pending, not zero. The ranking and chart baseline still carries no Gekisou skills.",
          "Aptitude subtracts complete runs with and without one skill on the same seed. The theoretical-best rank-1 value uses the mean score increment. Ordinary skill and rank adjustments use exported weights and range increments, as references limited by rounding and linear assumptions. A concrete mix of skills and judgements uses the complete engine in section 6.",
          "Gains of several skills cannot be added: the Gekisou combo factor saturates, rush supports interact with luck-gauge skills, and judgement conversion can change other effects; single-skill increments do not reconstruct a whole formation. Aptitude is a single-skill response, not a formation result. Chart factors give judged notes, Just notes, notes that can only be Perfect in Just ranges, tail notes from End to Complete, starting combo and no-skill lotteries to help explain differences.",
          "Each [mean, standard error] uses sample standard deviation divided by the square root of the seed count; SE is not model error. Random dependencies are checked before the four-seed probe, and four equal results alone do not prove determinism. Random variants double from 32 seeds up to a guard of 65536. Both theoretical-best and all-Perfect score increments must meet the larger of 1% of the absolute increment and 0.1% of the same-seed no-skill baseline. Meeting the baseline target need not mean 1% relative precision. A formal artifact requires both endpoints to pass; failure to converge within the guard rejects generation. Cross terms use at most the first 64 seeds; covariance is unavailable, so errors cannot be combined as independent.",
          "All-Perfect ordinary-skill cross weights are unavailable. Statistical adjustments without corresponding weights remain limited-precision references; arbitrary judgements and multiple skills use single-play calculation, rather than combined endpoint increments."
        ],
        "defs": [
          [
            "Probability activation (condition 4011)",
            "The model compares a float32 draw from the skill random stream with the activation threshold. In the current master, condition 4011 is used by luck Gekisou member skill 11003 and support skill 11005. Two native whole-live checks with real cards and supports passed, covering activation, rejection and a successful 5% branch; see the table below. The full model calculates one live for a given seed; seed means and standard errors describe aptitude. Ordinary skill inputs are unconditional score up: p × value cannot substitute for probability effects."
          ]
        ]
      },
      {
        "title": "Scope of the statistics",
        "defs": [
          [
            "Other skill types",
            "The statistics’ deck.kinds lists score effects linear in their factor (2000, 2002, 2004, 2005); the page’s skill sliders use ordinary score up. Cumulative scoring, conversion, support and Gekisou combinations need a complete simulation. Single-play JSON accepts supported skill IDs, levels and member attributes; unknown IDs or unsupported effects fail."
          ],
          [
            "Gekisou Live opponents",
            "The page does not predict other players’ range measures. Statistics select fixed placements; single-play external ranking requires explicit confirmations. Fixed-rank results do not determine online tie order, disconnects, room filling or server settlement."
          ],
          [
            "Snap skills",
            "Statistics omit specific Snap condition combinations. A single play can supply paired supports and member attributes; the complete engine processes life, grade counts, band and other conditions frame by frame."
          ],
          [
            "Real play time",
            "When the results start and how long loading takes depend on the device and the network; the overhead c stands for them, and dominance holds for every c ≥ 0."
          ]
        ]
      },
      {
        "title": "Chart facts",
        "defs": [
          [
            "Level",
            "The display level (_musicScoreDisplayLevel, with decimals); the score uses the whole level (_musicScoreLevel)."
          ],
          [
            "Notes",
            "Judged notes, the combo of a full combo; hidden notes, guide ends and unjudged slide ticks are left out. By NoteOperateType: tap {1, 101}, flick {40, 41, 42, 102}, slide {20, 21, 22}, trace {60–63, 104, 105}, combo tick {120}."
          ],
          [
            "Main BPM, density",
            "The main BPM holds longest from the first to the last judged note; density = judged notes ÷ that span in seconds."
          ],
          [
            "Base, W, skip",
            "Base and W are defined in sections 1 and 3 for the selected theoretical-best baseline: Gekisou includes fixed-rank range bonuses, Free Live does not. Skip is score per point of power for a skipped live (all Great, combo 0, no skills), independent of duration and unchanged by the page’s scenario."
          ]
        ]
      },
      {
        "title": "Checks against native code",
        "body": [],
        "table": {
          "headers": [
            "Case / input",
            "What was checked",
            "Result",
            "What remains unchecked"
          ],
          "rows": [
            [
              "10000201; power 300000; no skills; Gekisou off",
              "5500 frames, 13 fields, 71500 comparisons; 364 judgement events",
              "0 differences; six float32 factor states match by bits",
              "Fresh, no rewind; simulator max combo is not protected live max combo"
            ],
            [
              "Five ordinary skill-1 members; Perfect and mixed P/Great/Good/Bad/Miss",
              "5500 frames per case; 253000 core comparisons per case; native SkillExecutor trigger/pool/phases and applier dispatch",
              "0 differences; float32 max ULP 0",
              "One unconditional 2000 skill family; elapsed mirror excluded; not a complete game lifecycle"
            ],
            [
              "Real skills 1/4/6/7/5; high/medium/low accuracy × 30/60/120 fps",
              "Nine cases: 57750 frames; 35 effect-pool instances; 18826500 core comparisons; chart events and converted judgements in order",
              "0 differences; float32 max ULP 0",
              "Selected target and life-condition effects; not all skills or input windows"
            ],
            [
              "Nonzero per-note timing offsets",
              "Native actual P274 / Great58 / Good32; 5500 frames; 1793000 core comparisons",
              "0 differences; float32 max ULP 0",
              "Native auto-input window classification; Rust still consumes native judgements, not independent touch replay"
            ],
            [
              "Life condition boundary 700→600",
              "5500 frames; 45 effect-pool instances; 2288000 core comparisons",
              "0 differences; float32 max ULP 0",
              "The high-life effect is selected at 700 and continues at 600; the active effect does not switch to the low-life branch"
            ],
            [
              "Real skills 3/5/1/2/7 at level 5",
              "5500 frames; 1545500 core comparisons, including actual float32 skill factors",
              "0 differences; compared float32 max ULP 0",
              "This skill combination only; value 13000 converts to 1.29999…, not a hand-entered 1.3"
            ],
            [
              "Real card Gekisou and support skills; eight high/medium/low accuracy and 30/60/120 fps cases",
              "48750 frames, 35777250 checks: pools, converted results, combo protection, cumulative Just, luck gauge and rush",
              "Zero differences in declared fields; exact float32 bits",
              "Specified configurations; member-power effects and complete failure/result transitions need separate checks"
            ],
            [
              "Dynamic Just windows through the published model’s public API",
              "1600-frame native capture; 9 window types, 39 units; 388800 window and 62400 core checks",
              "451200 checks, zero differences; enable state and window widths match",
              "Window states and widths, scoring, life and current combo; consumes classified judgements"
            ],
            [
              "Probability 4011; real member card 43 / support 66; high life and life 600 + 4 Miss",
              "Two cases: 15000 frames, 10680000 core checks; 72 random-value, threshold and boolean checks",
              "Zero differences; final scores 2835163 / 2760861",
              "Seed 14 was selected to cover 5% success; fixed-input checks do not measure the probability distribution"
            ],
            [
              "Solo Gekisou combo / Just / luck; no card skills",
              "10000103 / 10000201 / 10000303; 19000 frames; 646000 integer comparisons",
              "0 differences in the listed score channels, life, combo, random count and range states",
              "Some range counters and float32 fields remain unpaired; frame score observation is separate from score()"
            ],
            [
              "Offline multiplayer combo / Just / luck; actual mixed judgements and life zero",
              "19000 frames; 646000 core comparisons; 76000 ranking-derived comparisons listed separately",
              "0 differences; 431 native random draws in the luck case",
              "No card skills, independent touch windows, full failure transition or server rewards; ranking-derived fields are not production observers"
            ],
            [
              "Native multiplayer ranking",
              "572 invocation cases, including ties, secondary measures, missing inputs and error boundaries",
              "15259 exact comparisons, 0 differences",
              "A subsystem test, not 572 lives; within-tie raw member order is outside the Rust API contract"
            ],
            [
              "Challenge: None / FullCombo / AllPerfect assists; actual mixed grades",
              "Three cases, 5858 frames and 1382503 core checks; native Enter/Update/Exit",
              "Declared fields match; native Bad/Good retry branches also observed",
              "Retry decisions are native-side observations; zero-latency animation substitutes, no full result screen/server check"
            ],
            [
              "Mission / SoloGekisou; mixed grades, combo breaks and zero life",
              "5502 frames, 1469049 core checks; 22008 derived ranking checks listed separately",
              "Zero differences; final score 439015; frame display and calculator scores checked separately",
              "No full result screen/server check; derived ranks are not independent production observers"
            ],
            [
              "Free / Solo Gekisou / challenge / mission / battle / arena / tutorial",
              "Seven native setup entries and chart/bootstrap branches executed",
              "Entry evidence only; full mode coverage pending",
              "Entering a mode is not a whole-live verdict; actual event/arena master and server lifecycle remain separate"
            ]
          ],
          "caption": "Client 1.0.1-25 · Checked 2026-09-30"
        },
        "after": [
          "All declared integers match and float32 bits are identical. The model passes 272 regression tests; per-note Rust and WASM results also match across all 340 charts."
        ]
      }
    ],
    "reminder": {
      "title": "When other results disagree",
      "text": "For comparisons, align version, chart, scenario, power, judgement stream, skills, order, seed and frame clock. Include the request JSON and result when reporting a difference. Statistical sampling error, limited-precision references and native check coverage are explained above.",
      "priority": "When you find a disagreement with other sources, the other sources are correct."
    },
    "contentsLabel": "Contents",
    "methodsLabel": "Method and remaining gaps",
    "method": {
      "title": "Sources and verification",
      "text": "Charts and master data come from game resources extracted by nnnotes; ournotes-deck’s Rust model calculates the figures. We run the game client’s libil2cpp binary directly in the offline ARM64 emulator Unicorn. With the chart, skills, seed and clock fixed, we compare scoring, life, combo, skills and ranking against Rust frame by frame. Files, audio, display and Unity JSON object assembly use substitutes; scoring still executes native instructions. The table’s checked integers and float32 bits match exactly, showing that the model reproduces client calculations under these conditions. Real devices and server results are outside this comparison."
    }
  }
};
