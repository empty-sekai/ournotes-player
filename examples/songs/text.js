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
      rank: (songs, charts) => `${songs} 首歌、${charts} 张谱面的可计算事实：效率、活动评级、速度、等级与时长。点任意一行看谱面详情；作词作曲、音频和谱面预览见 moenotes。`,
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
      seeds: (n) => `${n} 个种子`, unplayable: "无法游玩", unplayableHint: "Fever 超过 3 个：游戏只保留 3 个激走区间，第 4 个 Fever 开始时出错",
      orders: "顺序区间", sameOrder: "技能相同，顺序不影响得分", ranks: "评级门槛", rank: "评级", required: "所需分数", needPower: "所需综合力（期望）",
      needRange: "所需综合力（顺序区间）", chanceAt: (p) => `综合力 ${p} 达成率`,
      ranksHint: "门槛按歌定义，各难度共用。所需综合力 = 门槛 ÷ (每点综合力得分 × Great 比例系数)。",
      efficiency: "效率（当前设置）", close: "关闭",
    },
    kinds: { tap: "点击", flick: "划键", slide: "长条", trace: "追踪", combo: "连击节点" },
    loading: "读取中…", error: "错误", source: (r, v) => `数据：${r} 区服 · master ${v}`,
  },
  en: {
    app: "Chart data", views: { rank: "Rankings", charts: "Charts", guide: "Guide" },
    all: "All", search: "Search title, reading, credits…", songs: (n) => `${n} songs`, chartsN: (n) => `${n} charts`,
    jackets: "Jackets", jacketsHint: "Show or hide the jackets", theme: "Light / dark", swap: "Swap the axes",
    band: "Band", difficulty: "Difficulty",
    heads: { rank: "Chart rankings", charts: "Chart figures" },
    lead: {
      rank: (songs, charts) => `Computable facts of ${songs} songs and ${charts} charts: efficiency, event ranks, speed, level and length. Open any row for the chart's details; credits, audio and chart previews are on moenotes.`,
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
      seeds: (n) => `${n} seeds`, unplayable: "Unplayable", unplayableHint: "More than 3 fevers: the game keeps three Gekisou ranges and fails when a fourth fever starts",
      orders: "Order range", sameOrder: "Equal skills: the order does not matter", ranks: "Score ranks", rank: "Rank", required: "Score", needPower: "Power (expected)",
      needRange: "Power (order range)", chanceAt: (p) => `Chance at ${p}`,
      ranksHint: "Thresholds are the song's, shared by every difficulty. Power needed = threshold ÷ (score per power × Great factor).",
      efficiency: "Efficiency (current settings)", close: "Close",
    },
    kinds: { tap: "Tap", flick: "Flick", slide: "Slide", trace: "Trace", combo: "Combo tick" },
    loading: "Loading…", error: "error", source: (r, v) => `Data: region ${r} · master ${v}`,
  },
};

// The guide: sections of {title, body: [paragraph], math: [formula], after: [paragraph], defs: [[term, text]]}.
export const GUIDE = {
  zh: {
    title: "定义、推导与成立条件",
    lead: "本页的得分数值来自 music-data.json 的 deck 统计：ournotes-deck 按客户端的得分代码（反编译确认）对每张谱面做整局模拟，激走开启，并逐个种子用真实技能值的卡组核对。"
      + "下文给出每个量的定义、由它推出的结论以及结论成立的条件；模型没有覆盖的机制单列一节，逐项说明它们会怎样改变结论、目前怎样处理。",
    sections: [
      {
        title: "得分模型",
        body: [
          "理论最佳打法：激走开启，每个判定音符都在准确时刻命中，激走 Just 任务区间内为 Just、其它为 Perfect，全连，生命不归零；Fever 区间与歌曲的激走任务一起构成激走区间，单人游玩排名第 1，每个完成的区间都拿到排名加成。"
            + "整局按客户端的帧、得分帧（40 ms）、连击与激走连击系数、技能的发动与结束帧逐步模拟（ournotes-deck live::full）。本页的卡组模型是普通加分技能：效果 2000、持续 5 秒、作用于全体、无条件，卡组得分为",
        ],
        math: [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (位置 k 带因子 1 的技能时的得分 − score) / P₀,   P₀ = 300000",
        ],
        after: [
          "score 是无技能的精确得分（含区间排名加成），w_k 是第 k 位成员带一个因子 1（技能值 10000，即 +100%）的普通加分技能时整局多得的分数；两者都除以测量综合力 P₀。"
            + "技能值换算成因子时有取整（⌊值/10000 × 10⁵⌋/10⁵），各音符得分也有取整，所以上式在取整范围内成立：deck 对每个种子用一副真实技能值的随机卡组、在另一个综合力（1000003）下整局重算，偏差超过上界的谱面直接报错；现有 340 张全部通过。",
          "激走的影响很大：区间排名加成（MasterLiveGekisouRankingScoreBonus，单人最高 250%）按区间得分计算，Expert 谱面的 base 中有 36%–69%（中位 53%）来自它；技能落在激走区间内时，排名加成随之放大，所以区间内的技能位权重明显更高。",
          "幸运任务区间的抽签与幸运冲刺取自本局的随机种子。含幸运区间的谱面（340 张中 148 张）给出前 8 个公开种子的结果，本页取种子平均，并在详情里给出种子间 base 的区间（中位相差 1.3%，最大 4.2%）。"
            + "游戏的种子规律未知，所以种子平均不是游戏内的真实期望。",
        ],
      },
      {
        title: "技能顺序是随机变量",
        body: [
          "客户端在每局开始时构造 MemberDataContainer：先把技能顺序置为 0…n−1，再用 MemberShuffle 随机流做 Fisher–Yates 洗牌；种子取自客户端时钟，单人重试沿用同一种子（顺序也不变）。"
            + "第 e 个技能事件触发洗牌后第 e 位成员的技能，Snap 技能的列表按同一顺序构建。因此 π 在 5! = 120 种排列上均匀分布，卡组里的站位不是可选变量。",
        ],
        math: [
          "E[S] / P = base + x̄ · W,   x̄ = (1/n) Σ_i x_i,   W = Σ_k W_k",
          "Var[S / P] = (1/(n−1)) · Σ_i (x_i − x̄)² · Σ_k (W_k − W̄)²",
        ],
        after: [
          "推论一：期望只取决于技能平均值 x̄，与技能在成员间如何分配、谁在第几位无关。“最强技能放在权重最高的位置”只是 120 种排列中最好的一种，是上界，不是期望。",
          "推论二：离散度等于技能离散度与位置权重离散度的乘积；5 个技能相同时，每一局得分都相同。以技能 [140, 100, 60, 30, 0]% 为例，在全部 Expert 谱面上，最好与最差排列相差中位 15.4%、最大 29.2%，最佳排列比期望高中位 7.6%；激走区间让位置权重差距拉大，顺序的影响远大于不计激走时。"
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
          "前沿（不被任何谱面支配的集合）是与参数无关的结论：无论 x̄ 和 c 取何值，最优谱面一定在前沿上。给定参数时的名次只是其中一种排序。"
            + "现有数据中，两种 L 下前沿都只有 340 张里的 2 张。",
          "比较的前提是同一卡组在两首歌上综合力相同。卡牌的曲种加成（musicType）和标签加成会使 P 随歌曲变化，这时应比较 P_a S_a 与 P_b S_b。",
        ],
      },
      {
        title: "评级与活动",
        body: [
          "评级门槛按歌定义：MasterLiveMusic._liveScoreRankGroup 指向 MasterLiveScoreRank 的一组行，同一首歌的所有难度共用；得分达到的最高门槛就是评级。"
            + "协力的门槛为 trunc(√(5/n) · R_battle · n)（n 为未断线人数），E 计作 D。",
          "客户端的活动积分计算如下，其中 v 由（活动，评级）查表，加成来自卡组，倍率在消耗 k 个 boost 时为 5k、不消耗时为 1：",
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
            + "技能全 140% 时，Expert 达到 SS 所需综合力从 27 万到 128 万，相差 4.7 倍。SS 门槛对本模型的得分容量做过原点的最小二乘拟合，相对残差约 30%：门槛不是按容量定的，所以活动选曲必须逐曲计算，不能拿效率排行代替。"
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
          ["多人游玩", "排名加成按区间内的名次给出，本页按单人（第 1 名）计算；协力时名次与其他玩家有关，排名加成通常更低。"],
          ["Snap 技能", "跟随所属成员一起被洗牌；效果多由条件触发（成员乐队、生命、判定数等），取决于具体卡组，本页不计入。条件在整局都满足的加分，相当于在 base 上乘 (1 + y)。"],
          ["概率发动（条件 4011）", "若发动概率 p 与其它量独立，它的期望贡献等于把该技能值换成 p · x，可以直接填进技能输入；方差会比表中给出的更大。"],
          ["实机一局耗时", "进入结算的时刻、加载时间都依赖设备和网络，由每局额外耗时 c 表示；支配关系对所有 c ≥ 0 成立。"],
        ],
      },
      {
        title: "谱面事实的口径",
        defs: [
          ["等级", "显示等级（_musicScoreDisplayLevel，可带小数）；得分使用整数等级（_musicScoreLevel）。"],
          ["Notes", "判定音符数，也就是全连连击数；不含隐藏音符、导引终点和不判定的长条节点。音符构成按 NoteOperateType 归类：点击 {1, 101}、划键 {40, 41, 42, 102}、长条 {20, 21, 22}、追踪 {60–63, 104, 105}、连击节点 {120}。"],
          ["主 BPM、密度", "主 BPM 是第一个到最后一个判定音符之间持续时间最长的 BPM；密度 = 判定音符数 ÷ 这段区间的秒数。"],
          ["基础系数、W、跳过系数", "base 与 W 定义见第 1、2 节（base 含激走区间排名加成）。跳过系数是跳过时每点综合力的得分（全部按 Great、连击为 0、无技能），与时长无关。"],
          ["常见排行的口径问题", "用 Expert 的末音时间当所有难度的时长、把额外耗时固定为某个值不作说明、得分用未公开的卡组或不说明是否计入激走，这三种做法都会让名次随隐藏参数变化，无法复现。"
            + "本页把所有参数放在界面上，并用支配关系给出与参数无关的结论。"],
        ],
      },
    ],
  },
  en: {
    title: "Definitions, derivations and conditions",
    lead: "The score figures on this page are music-data.json's deck statistics: ournotes-deck simulates every chart's whole live after the client's score code (decompiled), Gekisou on, and checks each seed against a deck of real skill values. "
      + "Below: each quantity's definition, what follows from it and under which conditions; the mechanisms the model leaves out have their own section, with how each would change the results and how it is handled now.",
    sections: [
      {
        title: "Score model",
        body: [
          "Theoretical best play: Gekisou on, every judged note hit at its exact time, Just inside the Gekisou Just-count ranges and Perfect elsewhere, a full combo, life never at zero; the fevers with the song's Gekisou missions make the Gekisou ranges, and a solo player takes rank 1, so every completed range adds its rank bonus. "
            + "The live is simulated frame by frame after the client (ournotes-deck live::full): score frames (40 ms), combo and Gekisou combo factors, the skills' execute and finish frames. The page's deck model is the plain score-up skill: effect 2000, 5 s, the whole deck, no condition. A deck scores",
        ],
        math: [
          "S = P · ( base + Σ_k x_{π(k)} · w_k )",
          "base = score / P₀,   w_k = (score with a factor-1 skill at position k − score) / P₀,   P₀ = 300000",
        ],
        after: [
          "score is the exact no-skill score (rank bonuses included), w_k the score a factor-1 plain skill (value 10000, +100 %) on the member at position k adds over the whole live; both per point of the measurement power P₀. "
            + "The value becomes a factor with a floor (⌊value/10000 × 10⁵⌋/10⁵) and every note score is floored, so the formula holds up to the floors: for every seed deck plays a random deck of real skill values at another power (1000003) through the whole live, and a chart whose deviation exceeds the bound fails. All 340 current charts pass.",
          "Gekisou weighs a lot: the range rank bonus (MasterLiveGekisouRankingScoreBonus, up to 250 % solo) is a share of the range's score, and makes 36–69 % (median 53 %) of an Expert chart's base; a skill inside a Gekisou range raises the rank bonus too, so the positions inside ranges weigh much more.",
          "Luck ranges draw their lottery and luck rushes from the live's random seed. Charts with a luck range (148 of 340) come with the first 8 published seeds; the page takes the mean over the seeds and shows the seeds' base range in the details (1.3 % apart at the median, 4.2 % at most). "
            + "The game's seed law is unknown, so the seed mean is not the game's own expectation.",
        ],
      },
      {
        title: "The skill order is random",
        body: [
          "At the start of every live the client builds MemberDataContainer: the skill order is set to 0…n−1 and Fisher–Yates shuffled with the MemberShuffle random stream, seeded from the client clock (a solo retry keeps the seed, and the order). "
            + "Skill event e fires the member at position e of the shuffled order, and the snap skill lists follow the same order. So π is uniform over the 5! = 120 orders; the deck's slot order is not a choice.",
        ],
        math: [
          "E[S] / P = base + x̄ · W,   x̄ = (1/n) Σ_i x_i,   W = Σ_k W_k",
          "Var[S / P] = (1/(n−1)) · Σ_i (x_i − x̄)² · Σ_k (W_k − W̄)²",
        ],
        after: [
          "First: the expectation depends on the mean skill value only, not on how the values are spread over members or who stands where. The strongest skill on the heaviest position is the best of the 120 orders, an upper bound, not the expectation.",
          "Second: the spread is the product of the skills' spread and the position weights' spread; five equal skills score the same every live. With skills [140, 100, 60, 30, 0] % over every Expert chart, the best and the worst order differ by 15.4 % at the median and 29.2 % at most, and the best order is 7.6 % (median) above the expectation; the Gekisou ranges pull the position weights apart, so the order matters far more than without Gekisou. "
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
          "The frontier (the charts nothing beats) holds whatever the parameters: for any x̄ and c the best chart is on it; a ranking for given parameters is one ordering of it. "
            + "On the current data the frontier holds 2 of the 340 charts for either L.",
          "The comparison assumes the deck has the same power on both songs. Card song-type (musicType) and tag bonuses make P depend on the song; then compare P_a S_a with P_b S_b.",
        ],
      },
      {
        title: "Score ranks and events",
        body: [
          "Rank thresholds are per song: MasterLiveMusic._liveScoreRankGroup selects rows of MasterLiveScoreRank, shared by every difficulty; the rank is the highest threshold the score reaches. "
            + "Co-op thresholds are trunc(√(5/n) · R_battle · n) for n connected players, E counting as D.",
          "The client computes event points as below; v comes from the (event, rank) table, the bonus from the deck, and the rate is 5k for k boosts spent, 1 for none:",
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
            + "With every skill at 140 %, SS on Expert needs 0.27 to 1.28 million power, a factor 4.7. A least-squares fit through the origin of the SS thresholds against this model's score capacity leaves 30 % relative residuals: thresholds are not set by capacity, so event choices must be computed song by song, not read off the efficiency ranking. "
            + "For 20 of the 85 songs SS is easier on Hard than on Expert.",
        ],
      },
      {
        title: "Judgement accuracy",
        body: ["Judgement factors: Perfect 100 %, Great 80 %, Good 50 %, Bad and Miss 0 and a combo break; Just 230 %, only possible inside Gekisou Just-count ranges."],
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
          ["Multiplayer", "The rank bonus follows the rank within the range; the page takes a solo player (rank 1). In co-op the rank depends on the other players and the bonus is usually lower."],
          ["Snap skills", "Shuffled with their member; mostly conditional (the member's band, life, judgement counts), so deck-specific and left out here. A score up whose condition holds all live multiplies base by (1 + y)."],
          ["Probability skills (condition 4011)", "With an activation chance p independent of the rest, the expected contribution is that of the value p · x, which can be entered as the skill value; the spread is larger than shown."],
          ["Real play time", "When the results start and how long loading takes depend on the device and the network; the overhead c stands for them, and dominance holds for every c ≥ 0."],
        ],
      },
      {
        title: "Chart facts",
        defs: [
          ["Level", "The display level (_musicScoreDisplayLevel, with decimals); the score uses the whole level (_musicScoreLevel)."],
          ["Notes", "Judged notes, the combo of a full combo; hidden notes, guide ends and unjudged slide ticks are left out. By NoteOperateType: tap {1, 101}, flick {40, 41, 42, 102}, slide {20, 21, 22}, trace {60–63, 104, 105}, combo tick {120}."],
          ["Main BPM, density", "The main BPM holds longest from the first to the last judged note; density = judged notes ÷ that span in seconds."],
          ["Base, W, skip", "Base and W as in sections 1 and 2 (base includes the Gekisou range rank bonuses). Skip: score per point of power of a skipped live (every note Great, combo 0, no skills), independent of the length."],
          ["Common ranking pitfalls", "Using the Expert chart's last note as every difficulty's length, a fixed unstated overhead, or a score from an unstated deck or with Gekisou unstated all make the order depend on hidden parameters and impossible to reproduce. "
            + "This page puts every parameter on screen and states the parameter-free results through dominance."],
        ],
      },
    ],
  },
};
