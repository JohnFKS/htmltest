// 相似度引擎：三级混合（归一化签名 → 快速召回 → 可选 embedding 精排 → LLM 裁决在 provider 中）
// 设计目标：可靠 = 分数透明 + 多信号交叉验证 + 人工覆写兜底
window.Sim = (() => {
  // 数学要素词表（关键词重叠信号）
  const KEYWORDS = [
    '函数', '导数', '极值', '最值', '单调', '奇偶', '周期', '零点', '定义域', '值域', '恒成立',
    '积分', '切线', '渐近线', '向量', '数量积', '共线', '垂直', '夹角', '投影',
    '数列', '等差', '等比', '通项', '求和', '递推', '归纳', '收敛', '极限',
    '概率', '期望', '方差', '正态', '二项分布', '排列', '组合', '古典概型', '条件概率', '独立',
    '三角函数', '正弦', '余弦', '正切', '诱导公式', '辅助角', '解三角形', '正弦定理', '余弦定理', '平移', '伸缩', '对称',
    '椭圆', '双曲线', '抛物线', '焦点', '准线', '离心率', '渐近线方程', '直线方程', '斜率', '轨迹', '弦长', '中点弦',
    '集合', '复数', '虚数', '模长', '共轭', '对数', '指数', '幂函数', '绝对值', '不等式', '基本不等式', '均值不等式',
    '立体几何', '二面角', '线面角', '异面直线', '体积', '表面积', '外接球', '内切球', '棱柱', '棱锥', '圆锥', '球',
    '统计', '回归', '相关性', '百分位数', '平均数', '中位数', '频率分布',
    '二项式定理', '展开式', '系数', '因式分解', '韦达定理', '判别式', '根的分布', '参数取值', '分类讨论', '数形结合', '换元', '消元', '放缩', '构造', '待定系数', '反证法',
  ];

  // ---------- 归一化签名 ----------
  // 数字 → N（消除实例差异，保留结构），去空白与标点，保留数学运算符
  function normalize(text) {
    let s = U.stripHtml(String(text || '')).toLowerCase();
    s = s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)); // 全角数字
    s = s.replace(/\d+(\.\d+)?/g, 'N');
    s = s.replace(/\s+/g, '')
      .replace(/[，。；：、“”‘’（）【】《》？！、,.:;()"'?!~—…·\u3000]/g, '');
    return s;
  }

  function bigrams(str) {
    const set = new Set();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    if (str.length === 1) set.add(str);
    return set;
  }

  function jaccard(aSet, bSet) {
    let inter = 0;
    for (const x of aSet) if (bSet.has(x)) inter++;
    const uni = aSet.size + bSet.size - inter;
    return uni ? inter / uni : 0;
  }

  function keywordsOf(text) {
    const s = U.stripHtml(String(text || ''));
    const found = new Set();
    for (const k of KEYWORDS) if (s.includes(k)) found.add(k);
    return found;
  }

  // ---------- TF-IDF 余弦（bigram 为词项，候选池内计算 idf） ----------
  function tfidfCosine(queryStr, poolStrs) {
    const docs = [queryStr, ...poolStrs].map(normalize);
    const freqs = docs.map(s => {
      const m = new Map();
      const grams = [...bigrams(s)];
      for (const g of grams) m.set(g, (m.get(g) || 0) + 1);
      return m;
    });
    const df = new Map();
    for (const f of freqs) for (const g of f.keys()) df.set(g, (df.get(g) || 0) + 1);
    const N = docs.length;
    const idf = g => Math.log((N + 1) / ((df.get(g) || 0) + 1)) + 1;
    const vec = f => {
      let norm = 0; const v = new Map();
      for (const [g, c] of f) { const w = (c / f.size) * idf(g); v.set(g, w); norm += w * w; }
      return { v, norm: Math.sqrt(norm) };
    };
    const q = vec(freqs[0]);
    return poolStrs.map((_, i) => {
      const d = vec(freqs[i + 1]);
      let dot = 0;
      for (const [g, w] of q.v) if (d.v.has(g)) dot += w * d.v.get(g);
      return (q.norm && d.norm) ? dot / (q.norm * d.norm) : 0;
    });
  }

  // ---------- 融合评分 ----------
  function hybridScore(queryText, candText, w = {}) {
    const wj = w.wJaccard ?? 0.4, wt = w.wTfidf ?? 0.4, wk = w.wKeyword ?? 0.2;
    const qn = normalize(queryText), cn = normalize(candText);
    const jac = jaccard(bigrams(qn), bigrams(cn));
    const tf = tfidfCosine(queryText, [candText])[0];
    const qk = keywordsOf(queryText), ck = keywordsOf(candText);
    let kw = 0;
    if (qk.size && ck.size) {
      let inter = 0; for (const x of qk) if (ck.has(x)) inter++;
      kw = inter / Math.min(qk.size, ck.size); // 关键词召回率视角
    }
    const score = wj * jac + wt * tf + wk * kw;
    return { score: Math.round(score * 1000) / 1000, parts: { jaccard: r2(jac), tfidf: r2(tf), keyword: r2(kw) } };
  }

  const r2 = x => Math.round(x * 100) / 100;

  // ---------- 快速召回：返回 top-K 候选 ----------
  function rank(queryText, pool, cfg = {}) {
    const topK = cfg.recallTopK ?? 5;
    const scored = pool.map(item => ({
      ...item,
      ...hybridScore(queryText, item.text, cfg),
      sigA: normalize(queryText),
      sigB: normalize(item.text),
    })).sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).filter(x => x.score >= 0.1);
  }

  // ---------- 双栏对照 diff（token 级 LCS，高亮共同结构） ----------
  function tokenize(s) {
    // CJK 单字成 token，连续拉丁/数字成 token，其余符号各自成 token
    return s.match(/[\u4e00-\u9fff]|[a-z]+|[A-Z]+|N+|[+\-*/=^<>|√π∈∫Σ±≤≥≠]/g) || [];
  }

  function lcsFlags(a, b) {
    const A = tokenize(a), B = tokenize(b);
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const fa = new Array(n).fill(false), fb = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { fa[i] = fb[j] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { fa, fb };
  }

  function markTokens(str, flags) {
    const toks = tokenize(str);
    // token 顺序与原串顺序一致：按 token 重建
    return toks.map((t, i) => flags[i] ? `<mark>${U.esc(t)}</mark>` : U.esc(t)).join('');
  }

  function diffHtml(textA, textB) {
    const a = normalize(textA), b = normalize(textB);
    const { fa, fb } = lcsFlags(a, b);
    const common = fa.filter(Boolean).length / Math.max(1, tokenize(a).length);
    return {
      html: `<div class="diff-box"><div><b>新题签名：</b>${markTokens(a, fa)}</div>
             <div style="margin-top:8px"><b>候选签名：</b>${markTokens(b, fb)}</div></div>`,
      commonRatio: r2(common),
    };
  }

  // ---------- embedding 余弦 ----------
  function cosineVec(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
  }

  return { normalize, bigrams, jaccard, keywordsOf, hybridScore, rank, diffHtml, cosineVec, KEYWORDS };
})();
