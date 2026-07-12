/**
 * literature.js — OpenAlex 學術文獻搜尋（CORS 友善、純前端）
 *
 * 職責：
 * 1. 以 Fetch 直接呼叫 OpenAlex Works API（瀏覽器可跨域）
 * 2. 將 abstract_inverted_index 重組為完整英文摘要字串
 * 3. 回傳含 title、abstract 的論文列表供 L2 閱讀使用
 *
 * 無需後端、無需 Proxy。mailto 用於 OpenAlex polite pool。
 */

/** OpenAlex Works 搜尋端點 */
const OPENALEX_WORKS_URL = 'https://api.openalex.org/works';

/** Polite pool 聯絡信箱（OpenAlex 建議帶上） */
const OPENALEX_MAILTO = 'test@example.com';

/**
 * 將 OpenAlex 的 abstract_inverted_index 重組為完整純文字摘要
 *
 * 反向索引格式範例：
 * { "Social": [0], "work": [1, 5], "practice": [2] }
 * → "Social work practice … work …"
 *
 * @param {Object|null|undefined} invertedIndex - 詞 → 出現位置陣列
 * @returns {string} 依位置排序後以空白串接的摘要；無法重組則回傳空字串
 */
function reconstructAbstractFromInvertedIndex(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') {
    return '';
  }

  /** @type {Array<{pos: number, word: string}>} */
  const tokens = [];

  Object.keys(invertedIndex).forEach((word) => {
    const positions = invertedIndex[word];
    if (!Array.isArray(positions)) return;

    positions.forEach((pos) => {
      const index = Number(pos);
      if (!Number.isFinite(index)) return;
      tokens.push({ pos: index, word: String(word) });
    });
  });

  if (tokens.length === 0) return '';

  tokens.sort((a, b) => a.pos - b.pos);
  return tokens.map((t) => t.word).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 判斷是否為網路／CORS 類錯誤
 * @param {unknown} error
 * @returns {boolean}
 */
function isCorsOrNetworkError(error) {
  if (!error) return false;
  if (error instanceof TypeError) return true;
  const detail = error.message ? String(error.message) : String(error);
  return /cors|failed to fetch|networkerror|load failed|network/i.test(detail);
}

/**
 * 搜尋 OpenAlex 論文，並重組摘要文字
 *
 * @param {string} keyword - 搜尋關鍵字（建議英文，例如 "attachment theory"）
 * @param {number} [perPage=5] - 回傳筆數（1–25）
 * @returns {Promise<Array<{id: string, title: string, abstract: string, year: number|null, source: string}>>}
 */
async function searchOpenAlex(keyword, perPage = 5) {
  const query = String(keyword || '').trim();
  if (!query) {
    throw new Error('請先輸入搜尋關鍵字。');
  }

  const limit = Math.min(Math.max(Number(perPage) || 5, 1), 25);

  const params = new URLSearchParams({
    search: query,
    'per-page': String(limit),
    mailto: OPENALEX_MAILTO
  });

  const url = `${OPENALEX_WORKS_URL}?${params.toString()}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
  } catch (networkError) {
    if (isCorsOrNetworkError(networkError)) {
      throw new Error(
        '無法連線至 OpenAlex（網路或瀏覽器政策問題）。請檢查網路後再試。'
      );
    }
    throw new Error('網路連線失敗，請檢查網路後再試。');
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('OpenAlex 請求過於頻繁，請稍候再試。');
    }
    throw new Error(`OpenAlex 回應錯誤（狀態碼 ${response.status}）。`);
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error('OpenAlex 回傳格式異常，無法解析 JSON。');
  }

  const results = Array.isArray(data?.results) ? data.results : [];

  const papers = results
    .map((work) => {
      const title = (work.display_name || work.title || '').trim();
      const abstract = reconstructAbstractFromInvertedIndex(
        work.abstract_inverted_index
      );
      const id = work.id ? String(work.id) : '';
      const year = typeof work.publication_year === 'number'
        ? work.publication_year
        : null;

      return {
        id,
        title,
        abstract,
        year,
        source: 'openalex'
      };
    })
    .filter((p) => p.title && p.abstract);

  if (papers.length === 0) {
    throw new Error(
      '找不到含摘要的相關論文。請試試更常見的英文關鍵字（例如 attachment theory、family therapy）。'
    );
  }

  return papers;
}

window.reconstructAbstractFromInvertedIndex = reconstructAbstractFromInvertedIndex;
window.searchOpenAlex = searchOpenAlex;
window.isCorsOrNetworkError = isCorsOrNetworkError;
