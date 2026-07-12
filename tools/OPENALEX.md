# L2 文獻庫：OpenAlex 連線說明

本專案已改用 **OpenAlex API** 取得真實學術文獻，**不再使用 Semantic Scholar**，也**不需要本機 Proxy**。

## 為什麼改用 OpenAlex？

| 項目 | Semantic Scholar（已棄用） | OpenAlex（目前） |
|------|---------------------------|------------------|
| 瀏覽器 CORS | 常被阻擋，需後端／代理 | 對前端友善，可直接 Fetch |
| 費用 | 免費但額度緊（易 429） | 免費，建議帶 `mailto` |
| 架構 | 需 Proxy，違反純前端原則 | 純 Vanilla JS 即可 |

## 運作流程

1. 使用者在 L2 輸入關鍵字（建議英文）
2. `searchOpenAlex()` 呼叫：  
   `https://api.openalex.org/works?search=...&per-page=5&mailto=test@example.com`
3. 以 `reconstructAbstractFromInvertedIndex()` 把 `abstract_inverted_index` 重組為完整摘要
4. 畫面列出可選論文 → 使用者點「簡化此篇文獻」
5. `simplifyAbstractAPI()` 呼叫 DeepSeek，回傳簡化短文、中文翻譯、3–5 個生字

## 若搜尋失敗

| 情況 | 建議 |
|------|------|
| 網路錯誤 | 檢查網路後重試 |
| 找不到含摘要論文 | 改用常見英文關鍵字（如 `attachment theory`） |
| DeepSeek 錯誤 | 確認設定頁已填入有效 API Key |

## 相關檔案

- `js/literature.js` — OpenAlex 搜尋與反向索引重組
- `js/deepseek.js` — `simplifyAbstractAPI`
- `js/reading.js` — L2 UI 與串接
