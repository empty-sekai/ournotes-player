// Chart data page: interface texts and the guide (the definitions, derivations and conditions behind every figure),
// in Chinese and English. The song texts themselves come from music-data.json in the language chosen on the page.

export const UI = {
  zh: {
    app: "谱面数据", views: { rank: "排行", charts: "图表", guide: "说明" },
    all: "全部", search: "搜索曲名、读音、作者…", songs: (n) => `${n} 首`, chartsN: (n) => `${n} 张谱面`,
    jackets: "封面", jacketsHint: "显示或隐藏封面", theme: "切换浅色 / 深色", swap: "交换横纵轴",
    band: "乐队", difficulty: "难度",
    heads: { rank: "谱面排行", charts: "谱面图表" },
    lead: {
      rank: (songs, charts) => `${songs} 首歌、${charts} 张谱面的效率、活动评级、速度、等级与时长。得分数值目前按撃奏ライブ每区间第 1 名（最佳情况）计算，单人自由 Live 不开激走，见说明。点任意一行看谱面详情；作词作曲、音频和谱面预览见 moenotes。`,
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
    target: "目标评级", power: "综合力", powerHint: "不填则只看所需综合力", great: "Great 比例",
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
      weightsHint: "第 k 位成员带一个 +100% 普通加分技能时整局多得的分数 ÷ 综合力（整局模拟：窗口、帧、连击、Just 与激走排名加成都算在内），取种子平均；百分比为占 W 的份额。哪位成员落在哪个位置每局随机，所以期望只用到 W。",
      seeds: (n) => `${n} 个种子`, unplayable: "无法游玩", unplayableHint: "Fever 超过 3 个：从反编译代码看，游戏只保留 3 个激走区间，第 4 个 Fever 开始时会出错",
      orders: "顺序区间", sameOrder: "技能相同，顺序不影响得分", ranks: "评级门槛", rank: "评级", required: "所需分数", needPower: "所需综合力（期望）",
      needRange: "所需综合力（顺序区间）", chanceAt: (p) => `综合力 ${p} 达成率`,
      ranksHint: "门槛按歌定义，各难度共用。所需综合力 = 门槛 ÷ (每点综合力得分 × Great 比例系数)。",
      efficiency: "效率（当前设置）", close: "关闭",
    },
    kinds: { tap: "点击", flick: "划键", slide: "长条", trace: "追踪", combo: "连击节点" },
    loading: "读取中…", error: "错误", source: (v) => `数据：国际服 / 日服 · 版本 ${v}`,
    sourceHint: (r, m, c) => `提取自 ${r} 区服 · master ${m} · 客户端 ${c}`, deckModel: "得分模型",
    caveat: "数值以游戏反编译为来源，尽量准确但不保证正确；与其它资料有出入时请以它们为准",
  },
  en: {
    app: "Chart data", views: { rank: "Rankings", charts: "Charts", guide: "Guide" },
    all: "All", search: "Search title, reading, credits…", songs: (n) => `${n} songs`, chartsN: (n) => `${n} charts`,
    jackets: "Jackets", jacketsHint: "Show or hide the jackets", theme: "Light / dark", swap: "Swap the axes",
    band: "Band", difficulty: "Difficulty",
    heads: { rank: "Chart rankings", charts: "Chart figures" },
    lead: {
      rank: (songs, charts) => `Efficiency, event ranks, speed, level and length of ${songs} songs and ${charts} charts. Score figures are currently the Gekisou Live best case (rank 1 in every range); solo Free Live has no Gekisou, see the guide. Open any row for the chart's details; credits, audio and chart previews are on moenotes.`,
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
    target: "Target rank", power: "Power", powerHint: "empty: required power only", great: "Great share",
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
      weightsHint: "The score a +100 % plain score-up skill on the member at position k adds over the whole live, per point of power (whole-live simulation: windows, frames, combo, Just and the Gekisou rank bonuses included), averaged over the seeds; and its share of W. Which member lands on which position is drawn every live, so the expectation only uses W.",
      seeds: (n) => `${n} seeds`, unplayable: "Unplayable", unplayableHint: "More than 3 fevers: by the decompiled code the game keeps three Gekisou ranges and fails when a fourth fever starts",
      orders: "Order range", sameOrder: "Equal skills: the order does not matter", ranks: "Score ranks", rank: "Rank", required: "Score", needPower: "Power (expected)",
      needRange: "Power (order range)", chanceAt: (p) => `Chance at ${p}`,
      ranksHint: "Thresholds are the song's, shared by every difficulty. Power needed = threshold ÷ (score per power × Great factor).",
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
    lead: "本页的数值以游戏客户端的反编译代码为来源：ournotes-deck 按反编译得到的得分逻辑对每张谱面做整局模拟（激走开启），结果就是 music-data.json 的 deck 统计。"
      + "我们尽量保证正确，但对反编译代码的理解、模型的简化和数据版本都可能出错，所以不能保证。如果本页和其它站点、工具或实机结果有出入，多半是我们这边有误，请以它们为准。"
      + "下文给出每个量的定义、推导和成立条件；模型没有覆盖的机制单列一节。",
    sections: [
      {
        title: "得分模型",
        body: [
          "本页目前的得分数值对应撃奏ライブ（最多 5 人的多人模式）的最佳情况，即理论最佳打法：激走开启，每个判定音符都在准确时刻命中，激走 Just 任务区间内为 Just、其它为 Perfect，全连，生命不归零；Fever 区间与歌曲的激走任务一起构成激走区间，每个区间都拿第 1 名的排名加成。从反编译代码看，自由 Live 和挑战 Live 不开激走（单人激走只有调试开关，发布版没有入口），所以单人游玩的得分会低很多；激走关闭的数据和名次 1–5 的切换正在制作。"
            + "整局按反编译代码中的帧、得分帧（40 ms）、连击与激走连击系数、技能的发动与结束帧逐步模拟（ournotes-deck live::full）。本页的卡组模型是普通加分技能：效果 2000、持续 5 秒、作用于全体、无条件，卡组得分为",
        ],
        math: [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (位置 k 带因子 1 的技能时的得分 − score) / P₀,   P₀ = 300000",
        ],
        after: [
          "score 是模型算出的无技能得分（含区间排名加成），w_k 是第 k 位成员带一个因子 1（技能值 10000，即 +100%）的普通加分技能时整局多得的分数；两者都除以测量综合力 P₀。"
            + "技能值换算成因子时有取整（⌊值/10000 × 10⁵⌋/10⁵），各音符得分也有取整，所以上式在取整范围内成立：deck 对每个种子用一副真实技能值的随机卡组、在另一个综合力（1000003）下整局重算，偏差超过上界的谱面直接报错；现有 340 张全部通过。"
            + "这项核对只说明上式与模拟自洽，不能说明模拟与游戏一致。",
          "每首歌有三个激走任务（连击、幸运或 Just，按歌定义，各难度共用），依次对应谱面的三个 Fever 区间。Just 判定只在 Just 任务区间内开启，所以三个任务里没有 Just 的歌（85 首中 41 首：21 首全是连击、20 首全是幸运）整局都没有 Just；"
            + "三个任务全是 Just 的有 27 首，另有 17 首连击、幸运、Just 各一个。",
          "按本模型，激走的影响很大：与激走关闭相比，Expert 谱面的无技能得分高 1.6–4.7 倍（中位 2.4 倍）。主要来源是区间排名加成（MasterLiveGekisouRankingScoreBonus）：每个完成的区间再加上该区间得分的一个百分比，按名次查表，本页按第 1 名计；"
            + "三个激走任务相同的歌（85 首中 68 首）为 250%，三个任务各不相同的（17 首）为 370%，多人游玩时即使是第 5 名也有 100%。Expert 谱面的 base 中有 36%–69%（中位 53%）来自它。"
            + "其次是 Just 任务区间内的 Just 判定（230%，Perfect 为 100%）：区间长、Just 音符多的谱面倍数最高，4.7 倍的那张三个 Just 区间共约 52 秒、233 个 Just 音符；连击任务区间的激走连击系数在没有激走技能时影响很小（约 1%）。"
            + "技能落在激走区间内时，排名加成随之放大，所以区间内的技能位权重明显更高。",
          "幸运任务区间的抽签与幸运冲刺取自本局的随机种子。含幸运区间的谱面（340 张中 148 张）给出前 8 个公开种子的结果，本页取种子平均，并在详情里给出种子间 base 的区间（中位相差 1.3%，最大 4.2%）。"
            + "游戏的种子规律未知，所以种子平均未必等于游戏内的真实期望。",
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
          "在本模型内，前沿（不被任何谱面支配的集合）与参数无关：无论 x̄ 和 c 取何值，最优谱面都在前沿上；给定参数时的名次只是其中一种排序。"
            + "现有数据中，两种 L 下前沿都只有 340 张里的 2 张。",
          "比较的前提是同一卡组在两首歌上综合力相同。卡牌的曲种加成（musicType）和标签加成会使 P 随歌曲变化，这时应比较 P_a S_a 与 P_b S_b。",
        ],
      },
      {
        title: "评级与活动",
        body: [
          "评级门槛按歌定义：MasterLiveMusic._liveScoreRankGroup 指向 MasterLiveScoreRank 的一组行，同一首歌的所有难度共用；得分达到的最高门槛就是评级。"
            + "撃奏ライブ按房间内全员得分之和评级，门槛为 trunc(√(5/n) · R_battle · n)（n 为未断线人数），E 计作 D。",
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
          "达成率是在 120 种技能顺序上 P · f · S_π ≥ R 成立的比例，f 为下节的判定系数；所需综合力取期望，区间取最好与最差排列。"
            + "按本模型，技能全 140% 时，Expert 达到 SS 所需综合力从 27 万到 128 万，相差 4.7 倍。SS 门槛对本模型的得分容量做过原点的最小二乘拟合，相对残差约 30%：门槛看来不是按容量定的，所以活动选曲最好逐曲计算，不宜直接拿效率排行代替。"
            + "85 首歌里有 20 首的 Hard 比 Expert 更容易拿到 SS。",
        ],
      },
      {
        title: "判定精度",
        body: ["判定系数：Perfect 100%，Great 80%，Good 50%，Bad 与 Miss 为 0 且断连；Just 为 230%，只在激走的 Just 任务区间内可能出现。"],
        math: ["E[S | Great 比例 q] = (1 − 0.2 q) · S"],
        after: [
          "近似：若只出现 Perfect 与 Great（不断连），且每个音符为 Great 的概率 q 与位置无关，那么普通音符与排名加成都按 (1 − 0.2 q) 缩放，页面“Great 比例”就是把这个系数乘进所需综合力和达成率。"
            + "Just 区间内的音符不是这样：一个 Great 从 230% 降到 80%，按比例损失远大于 20%，所以 Just 区间多的谱面上这个系数偏乐观，效率排序也可能随 q 变化。",
          "断连不满足上述条件：连击系数和激走连击系数取决于当前连击数，连击任务区间还会因断连失败，断在不同位置损失不同（deck 统计尚未导出每张谱面的断连损失分布）。"
            + "判定转换技能（12006、13005）把 Great 转为 Perfect，相当于降低 q；回复和护盾只在生命归零之后才影响得分（此后每个音符 × 0.3）。",
        ],
      },
      {
        title: "尚未纳入的机制",
        defs: [
          ["其它技能类型", "music-data.json 的 deck.kinds 列出主数据里所有与因子线性相关的加分类别（效果 2000、2002、2004、2005，按持续时间、目标和条件区分），每张谱面都给出了各类别的位置权重；"
            + "本页只用普通加分这一类。判定加分（2004，目标判定 41/46）和带条件的 2000（条件组 14、15）权重不同，需要按具体卡组逐类求和；累计加分（2001、2003）、判定转换、激走技能与 Snap 技能不是线性的，只能整局模拟。"],
          ["撃奏ライブ的名次", "撃奏ライブ最多 5 人，每个区间按该区间的任务指标（连击、幸运点数或 Just 数）与房间内其他玩家比名次，名次越靠后加成越少；本页按第 1 名计算，是最佳情况。游戏没有协力模式。从反编译代码看，撃奏ライブ同时上报两套分数，存为歌曲最高分的那一套不含任何激走效果。"],
          ["Snap 技能", "跟随所属成员一起被洗牌；效果多由条件触发（成员乐队、生命、判定数等），取决于具体卡组，本页不计入。条件在整局都满足的加分，相当于在 base 上乘 (1 + y)。"],
          ["概率发动（条件 4011）", "若发动概率 p 与其它量独立，它的期望贡献等于把该技能值换成 p · x，可以直接填进技能输入；方差会比表中给出的更大。"],
          ["实机一局耗时", "进入结算的时刻、加载时间都依赖设备和网络，由每局额外耗时 c 表示；支配关系对所有 c ≥ 0 成立。"],
          ["核对范围", "deck 的各项规则是对照反编译得到的客户端代码核对的（在模拟器里运行游戏自己的函数，比对输出），还没有拿实机成绩逐局核对。"
            + "判定窗口类技能（4000–4003、13001）尚未接入整局模拟，另有少数激走条件只有合成测试；本页只用普通加分技能，不受这两项影响。游戏更新或热更新补丁也可能改变这些规则。"],
        ],
      },
      {
        title: "谱面事实的口径",
        defs: [
          ["等级", "显示等级（_musicScoreDisplayLevel，可带小数）；得分使用整数等级（_musicScoreLevel）。"],
          ["Notes", "判定音符数，也就是全连连击数；不含隐藏音符、导引终点和不判定的长条节点。音符构成按 NoteOperateType 归类：点击 {1, 101}、划键 {40, 41, 42, 102}、长条 {20, 21, 22}、追踪 {60–63, 104, 105}、连击节点 {120}。"],
          ["主 BPM、密度", "主 BPM 是第一个到最后一个判定音符之间持续时间最长的 BPM；密度 = 判定音符数 ÷ 这段区间的秒数。"],
          ["基础系数、W、跳过系数", "base 与 W 定义见第 1、2 节（base 含激走区间排名加成）。跳过系数是跳过时每点综合力的得分（全部按 Great、连击为 0、无技能），与时长无关。"],
          ["与其它资料不一致时", "本页的数值来自我们对反编译代码的理解，没有官方资料可以对照，可能有错；和其它站点、工具或实机结果不一致时，请优先相信它们。"
            + "口径不同（时长的取法、是否计入激走、卡组设定）也会带来差别，可以先把页面上的参数调成对方的设定再比较。"],
        ],
      },
    ],
  },
  en: {
    title: "Definitions, derivations and conditions",
    lead: "The figures on this page are sourced from the game client's decompiled code: ournotes-deck simulates every chart's whole live (Gekisou on) after the score logic read from it, and the results are music-data.json's deck statistics. "
      + "We aim for them to be correct but cannot guarantee it: our reading of the decompiled code, the model's simplifications and the data version can all be wrong. Where this page disagrees with other sites, tools or real plays, the mistake is most likely ours; trust them. "
      + "Below: each quantity's definition, derivation and conditions; the mechanisms the model leaves out have their own section.",
    sections: [
      {
        title: "Score model",
        body: [
          "The page's score figures are currently the best case of Gekisou Live (撃奏ライブ, the multiplayer mode of up to 5 players), in theoretical best play: Gekisou on, every judged note hit at its exact time, Just inside the Gekisou Just mission ranges and Perfect elsewhere, a full combo, life never at zero; the fevers with the song's Gekisou missions make the Gekisou ranges, and every range takes the rank-1 bonus. By the decompiled code, Free Live and Challenge Live play without Gekisou (solo Gekisou is a debug switch with no way in in the release), so solo scores are much lower; Gekisou-off figures and a rank 1–5 switch are in the works. "
            + "The live is simulated frame by frame after the decompiled code (ournotes-deck live::full): frames, score frames (40 ms), combo and Gekisou combo factors, the skills' execute and finish frames. The page's deck model is the plain score-up skill: effect 2000, 5 s, the whole deck, no condition. A deck scores",
        ],
        math: [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (score with a factor-1 skill at position k − score) / P₀,   P₀ = 300000",
        ],
        after: [
          "score is the model's no-skill score (rank bonuses included), w_k the score a factor-1 plain skill (value 10000, +100 %) on the member at position k adds over the whole live; both per point of the measurement power P₀. "
            + "The value becomes a factor with a floor (⌊value/10000 × 10⁵⌋/10⁵) and every note score is floored, so the formula holds up to the floors: for every seed deck plays a random deck of real skill values at another power (1000003) through the whole live, and a chart whose deviation exceeds the bound fails. All 340 current charts pass. "
            + "This check only shows that the formula agrees with the simulation, not that the simulation agrees with the game.",
          "Every song has three Gekisou missions (combo, luck or Just, set per song and shared by every difficulty), one for each of the chart's three fevers in order. Just judgements are only on inside Just mission ranges, so the songs without a Just mission (41 of 85: 21 all combo, 20 all luck) have no Just all live; "
            + "27 songs have three Just missions, and 17 have one each of combo, luck and Just.",
          "By this model Gekisou weighs a lot: against Gekisou off, an Expert chart's no-skill score is 1.6–4.7 times higher (median 2.4). Most of it is the range rank bonus (MasterLiveGekisouRankingScoreBonus): every completed range adds a percentage of its own score, looked up by rank, rank 1 on this page; "
            + "that is 250 % on the songs whose three missions are the same (68 of 85) and 370 % on those whose three missions all differ (17), and in multiplayer even rank 5 gets 100 %. It makes 36–69 % (median 53 %) of an Expert chart's base. "
            + "Next come the Just judgements inside Just mission ranges (230 %, against 100 % for a Perfect): charts with long ranges and many Just notes gain the most, and the 4.7 times chart has three Just ranges of about 52 s in all with 233 Just notes; the Gekisou combo factor of combo mission ranges matters little without Gekisou skills (about 1 %). "
            + "A skill inside a Gekisou range raises the rank bonus too, so the positions inside ranges weigh much more.",
          "Luck mission ranges draw their lottery and luck rushes from the live's random seed. Charts with a luck range (148 of 340) come with the first 8 published seeds; the page takes the mean over the seeds and shows the seeds' base range in the details (1.3 % apart at the median, 4.2 % at most). "
            + "The game's seed law is unknown, so the seed mean need not equal the game's own expectation.",
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
          "Within this model the frontier (the charts nothing beats) does not depend on the parameters: for any x̄ and c the best chart is on it; a ranking for given parameters is one ordering of it. "
            + "On the current data the frontier holds 2 of the 340 charts for either L.",
          "The comparison assumes the deck has the same power on both songs. Card song-type (musicType) and tag bonuses make P depend on the song; then compare P_a S_a with P_b S_b.",
        ],
      },
      {
        title: "Score ranks and events",
        body: [
          "Rank thresholds are per song: MasterLiveMusic._liveScoreRankGroup selects rows of MasterLiveScoreRank, shared by every difficulty; the rank is the highest threshold the score reaches. "
            + "Gekisou Live rates the sum of every player's score in the room, against trunc(√(5/n) · R_battle · n) for n connected players, E counting as D.",
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
          "The chance is the share of the 120 skill orders with P · f · S_π ≥ R, f the judgement factor of the next section; the power needed uses the expectation, its range the best and the worst order. "
            + "By this model, with every skill at 140 %, SS on Expert needs 0.27 to 1.28 million power, a factor 4.7. A least-squares fit through the origin of the SS thresholds against this model's score capacity leaves about 30 % relative residuals: the thresholds do not seem to be set by capacity, so event choices are best computed song by song rather than read straight off the efficiency ranking. "
            + "For 20 of the 85 songs SS is easier on Hard than on Expert.",
        ],
      },
      {
        title: "Judgement accuracy",
        body: ["Judgement factors: Perfect 100 %, Great 80 %, Good 50 %, Bad and Miss 0 and a combo break; Just 230 %, only possible inside Gekisou Just mission ranges."],
        math: ["E[S | Great share q] = (1 − 0.2 q) · S"],
        after: [
          "Approximation: with Perfects and Greats only (no break) and a Great chance q that does not depend on the note, plain notes and rank bonuses scale by (1 − 0.2 q); the page's Great share applies that factor to the power needed and the chance. "
            + "Notes inside Just ranges do not: a Great there falls from 230 % to 80 %, far more than 20 %, so the factor is optimistic on charts with much Just range, and the efficiency order may change with q.",
          "Breaks do not meet the condition: the combo and Gekisou combo factors depend on the running combo and a break fails a combo mission range, so a break costs differently at different notes (the deck statistics do not export a chart's break-cost distribution yet). "
            + "Judgement conversion (12006, 13005) turns Greats into Perfects, lowering q; recovery and guard skills change the score only once life reaches zero (every note × 0.3 after that).",
        ],
      },
      {
        title: "Mechanisms not modelled yet",
        defs: [
          ["Other skill types", "music-data.json's deck.kinds lists every score-up kind of the master data whose score is linear in the factor (effects 2000, 2002, 2004, 2005, told apart by duration, targets and conditions), with each chart's position weights per kind; "
            + "the page uses the plain score-up kind only. Judgement score up (2004, target judgements 41/46) and conditional 2000s (condition groups 14, 15) weigh differently and need a deck's own kinds summed; cumulative score up (2001, 2003), judgement conversion, Gekisou skills and snap skills are not linear and need the simulation itself."],
          ["Gekisou Live ranks", "Gekisou Live seats up to 5 players; in every range the rank compares that range's mission measure (combo, luck points or Just count) with the other players in the room, and a lower rank gets a smaller bonus. The page takes rank 1, the best case. The game has no co-op mode. By the decompiled code, Gekisou Live reports two scores, and the one kept as the song's best score leaves out every Gekisou effect."],
          ["Snap skills", "Shuffled with their member; mostly conditional (the member's band, life, judgement counts), so deck-specific and left out here. A score up whose condition holds all live multiplies base by (1 + y)."],
          ["Probability skills (condition 4011)", "With an activation chance p independent of the rest, the expected contribution is that of the value p · x, which can be entered as the skill value; the spread is larger than shown."],
          ["Real play time", "When the results start and how long loading takes depend on the device and the network; the overhead c stands for them, and dominance holds for every c ≥ 0."],
          ["Scope of the checks", "deck's rules are checked against the decompiled client code (the game's own functions run in an emulator and their outputs compared), not yet against real play results live by live. "
            + "Judgement window skills (4000–4003, 13001) are not in the whole-live simulation yet, and a few Gekisou conditions only have synthetic tests; the page uses the plain score-up skill only and is affected by neither. A game update or hotfix patch may also change these rules."],
        ],
      },
      {
        title: "Chart facts",
        defs: [
          ["Level", "The display level (_musicScoreDisplayLevel, with decimals); the score uses the whole level (_musicScoreLevel)."],
          ["Notes", "Judged notes, the combo of a full combo; hidden notes, guide ends and unjudged slide ticks are left out. By NoteOperateType: tap {1, 101}, flick {40, 41, 42, 102}, slide {20, 21, 22}, trace {60–63, 104, 105}, combo tick {120}."],
          ["Main BPM, density", "The main BPM holds longest from the first to the last judged note; density = judged notes ÷ that span in seconds."],
          ["Base, W, skip", "Base and W as in sections 1 and 2 (base includes the Gekisou range rank bonuses). Skip: score per point of power of a skipped live (every note Great, combo 0, no skills), independent of the length."],
          ["Where other sources disagree", "The figures come from our reading of the decompiled code, with no official data to check them against, and may be wrong; where other sites, tools or real plays disagree, trust them first. "
            + "Different conventions (how the length is taken, whether Gekisou counts, the deck) also make differences; set the page's parameters to theirs before comparing."],
        ],
      },
    ],
  },
};
