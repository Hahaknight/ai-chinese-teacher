# 端到端冒烟测试报告

**日期**: 2026-06-08
**服务器**: http://127.0.0.1:3000 (Node + Express + Prisma + SQLite,dev 模式)
**会话时间戳**: 14:38:05 - 14:42:55 (约 4 分 50 秒)
**测试者**: Claude Code subagent (model: MiniMax-M3)
**测试范围**: 仅后端 API,前端 miniprogram 不在测试范围

---

## 1. 测试结果汇总

| # | 测试 | 状态 | 备注 |
|---|------|------|------|
| 1 | dev-login | **PASS** | token 返回,200 OK |
| 2 | create batch | **PASS** (需修正) | 端点要求 `reviewRequirement` 字段(原 prompt 未提供);中文 batchName 被 curl 当作 GBK → 乱码落库 |
| 3 | add task w/ image | **PASS** (路径需修正) | 端点接受 `imageUrls: [url]` JSON,不是 multipart;正确流程 = `POST /api/files/upload` 拿 `fileUrl` → 再 `POST /api/essay-batches/:id/tasks` |
| 4 | start batch + 轮询 | **FAIL** | OCR 返回空/太短,任务 10s 内失败 → `status=failed`;测试图肉眼可读、含完整作文(标题"是同往众人的方向,还是勇寻个人的月亮"),但 `recognizedText` 字段为 null,`errorMessage="OCR 返回为空或太短,无法识别作文内容"` |
| 5 | verify report | **FAIL (级联)** | 因为任务 OCR 失败,`score / fullScore / wordUrl / pdfUrl / reviewResult / shortComment` 全为 null,`studentName` 仍为 null |
| 6 | download files | **PASS** | `/api/files/recent` 返回 2 个 docx + 2 个 pdf(均为之前成功批改/讲评课产物);`HEAD /uploads/...docx` 返回 `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`,`HEAD /uploads/...pdf` 返回 `Content-Type: application/pdf`,均 200 |
| 7 | material search "坚持" | **PASS** | `?keyword=坚持` 返回 5+ 素材,含 **竹子**(tags 含"坚持")和 **蝉**(tags 含"坚持"),以及 候鸟/雨滴/萤火虫;`?category=坚持` 返回 `[]`(正确:坚持是 tag,不是 category) |
| 8 | sentence fix | **PASS** (curl 编码需修正) | 第一次请求中文被 Windows curl 当 GBK → 服务端拿到乱码 → AI 返回"乱码非语法错误";加上 `Content-Type: application/json; charset=utf-8` 重试后 5 字段全齐:`originalSentence / problemAnalysis / fixedSentence / explanation / similarExample`,正确诊断"主语残缺" |
| 9 | lecture review gen | **PASS** | 端点接受 `{"batchId": "..."}`(不是原 prompt 的 `reportIds`);新生成的讲评课 `id=66aa20a1-...` 含全部 8 字段:`title / overallSituation / mainStrengths / commonProblems / typicalProblemExplanation / excellentExpressions / classPractice / afterClassSuggestions`,即使 batch 0 成功也允许生成(生成"无数据"讲评) |
| 10 | lecture docx/pdf 下载 | **PASS** | 新生成的 docx 8376B,PDF 153108B(2 页),`file` 命令确认 `Microsoft Word 2007+` 和 `PDF document, version 1.4`,`HEAD` 状态 200,`Content-Type` 正确 |

**总评**: 7/10 PASS, 1/10 PARTIAL(编码), 2/10 FAIL(OCR 是核心阻塞)。

---

## 2. 详细测试日志

### Test 1: dev-login (PASS)

```bash
curl -X POST http://127.0.0.1:3000/api/wechat/dev-login \
     -H "Content-Type: application/json" \
     -d '{"openId":"miniprogram-local-dev"}'
```

**响应 (200 OK)**:
```json
{"code":0,"data":{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzMmY4Zjk0MS0wNGFlLTQ5MGMtODhmNS0yYjgwNTEzM2I4YjciLCJpYXQiOjE3ODA5MDA3MDUsImV4cCI6MTc4MzQ5MjcwNX0.lql2PoKQizaSG3NrD9VVO_jUKVAoxOqBTx4i_OVYTzg","user":{"id":"32f8f941-04ae-490c-88f5-2b805133b8b7","openId":"miniprogram-local-dev","nickname":"本地测试老师","avatarUrl":""}}}
```
- 端点挂在 `/api/wechat/dev-login`(不是 `/api/auth`)
- 实际从 response 的 `user` 字段读取 `id`/`openId`/`nickname` 也都正常
- 拿到 token 进入 `$TOKEN`

---

### Test 2: create batch (PASS,需补字段)

```bash
curl -X POST http://127.0.0.1:3000/api/essay-batches \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"batchName\":\"冒烟测试-$(date +%s)\",\"reviewRequirement\":\"请从立意、内容、结构、语言、卷面五个维度评分,总分50分...\"}"
```

**响应 (200 OK)**:
```json
{"code":0,"data":{"id":"53223746-32d7-467c-b2fe-6d94ddb638f1","batchName":"ð�̲���-1780900712","status":"pending","totalCount":0,"successCount":0,"failedCount":0,"processingCount":0,"createdAt":"2026-06-08T06:38:32.715Z"}}
```

**注意**:
- 端点 **必填** `reviewRequirement`(代码 `routes/essay.ts:18` 显式 400),原 prompt 没给 → 必须补
- bash 默认 GBK 编码把中文 batchName 编码成 mojibake 落库,DB 里查出来是 `ð�̲���-1780900712`;不影响功能,但前端/老师会看到乱码

---

### Test 3: add task with image (PASS,需两步走)

实际正确流程需要先调文件上传端点拿到 `fileUrl`,再用 JSON 把 `imageUrls: [fileUrl]` 发给任务端点。原 prompt 的 "multipart/form-data" 不能直接进 task 端点。

**Step 3a — 上传图片**:
```bash
curl -X POST http://127.0.0.1:3000/api/files/upload \
     -H "Authorization: Bearer $TOKEN" \
     -F "file=@uploads/1780382772349_ZNwMlMDnNxBH6cf2669314d14868b6f947d5234ecc45.jpg"
```
**响应 (200 OK)**:
```json
{"code":0,"data":{"fileName":"1780382772349_ZNwMlMDnNxBH6cf2669314d14868b6f947d5234ecc45.jpg","fileUrl":"http://localhost:3000/uploads/1780900721172_1780382772349_ZNwMlMDnNxBH6cf2669314d14868b6f947d5234ecc45.jpg","fileSize":844892}}
```

**Step 3b — 创建任务**:
```bash
curl -X POST http://127.0.0.1:3000/api/essay-batches/$BATCH_ID/tasks \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"imageUrls\":[\"$FILE_URL\"]}"
```
**响应 (200 OK)**:
```json
{"code":0,"data":{"taskId":"93d26c8d-0d6d-44a0-86d3-5e20736fc094","batchId":"53223746-32d7-467c-b2fe-6d94ddb638f1","studentName":null,"imageCount":1,"status":"pending"}}
```

---

### Test 4: start batch + poll (FAIL — OCR 空)

```bash
curl -X POST http://127.0.0.1:3000/api/essay-batches/$BATCH_ID/start \
     -H "Authorization: Bearer $TOKEN"
# 然后每 10s 轮询
```

**Start 响应 (200 OK)**:
```json
{"code":0,"data":{"batchId":"53223746-32d7-467c-b2fe-6d94ddb638f1","status":"processing","message":"批改任务已开始,共 1 个任务"}}
```

**Poll 第一次 (10s 后)**:
```json
{"code":0,"data":{...,"status":"failed","totalCount":1,"successCount":0,"failedCount":1,...,"tasks":[{"id":"93d26c8d-...","status":"failed","score":null,"fullScore":null,"wordUrl":null,"pdfUrl":null,"errorMessage":"OCR 返回为空或太短,无法识别作文内容"}]}}
```

**Retry 后同样失败**(`POST /api/essay-batches/tasks/$TASK_ID/retry`)。

**关键证据**:
- 任务在 **10 秒内** 从 `processing` → `failed`(`updateBatchCounts` 立刻结算)
- errorMessage 写明 "OCR 返回为空或太短"
- `recognizedText` 字段为 null(不是空的字符串)
- 端点路径:**任务详情在 `/api/essay-batches/tasks/$TASK_ID`**,不是原 prompt 的 `/api/essay-tasks/$TASK_ID`(`/api/essay-tasks` 整个前缀都不存在,返回 `Cannot GET`)
- 同样重试也失败 → 不是网络抖动,是 OCR 调用本身在这一张图上稳定返回极短/空文本
- 我用 `understand_image` 工具直接看图,标题《是同往众人的方向,还是勇寻个人的月亮》清晰可读,是正常的 5-7 页学生作文照片,**不是模糊图**

可能原因(按可能性排序):
1. **M2.7 真的 OCR 失败**:图是 845KB JPEG,base64 后约 1.2MB,完全在 axios 50MB body limit 之内;ai.ts 强制图像任务用 M2.7(避免 M3 幻觉);但 M2.7 可能在某些手写体上识别率比 M3 还低
2. **两套 OCR 路径选错**:`USE_TWO_STEP` 默认 = `MINIMAX_DIRECT !== '0'`,即默认走 `ocrViaCreateMessage`(走 `createMessage` + image_url,经 `chat/completions`);**没有走** `imageRecognitionService.ts` 里那个直连 `/coding_plan/vlm` 的 `recognizeImage`(那个 prompt 更详细,要求"先识姓名再识正文")
3. **prompt 设计**:`ocrViaCreateMessage` 的 prompt 是 "识别图片中的作文文字,按原文输出,不要改写...";没要求标 [?],但 AI 可能在 [?] 标记和正常输出之间走偏
4. 服务端 dev 进程跑在我无法 tail 的另一个控制台里(本机 `/tmp/server.log` 只是历史重启 noise),所以看不到 ai.ts 的 `[VLM] / [ai] / [essay:xxx] OCR ...` 日志,无法直接确认是 M2.7 调了还是哪一步崩了

---

### Test 5: verify report (FAIL,级联 4)

```bash
curl http://127.0.0.1:3000/api/essay-batches/tasks/$TASK_ID \
     -H "Authorization: Bearer $TOKEN"
```

**响应 (200 OK,但所有报告字段为 null)**:
```json
{"code":0,"data":{"id":"93d26c8d-0d6d-44a0-86d3-5e20736fc094","studentName":null,"status":"failed","recognizedText":null,"reviewResult":null,"shortComment":null,"imageUrls":"[\"http://localhost:3000/uploads/1780900721172_...\"]","wordUrl":null,"pdfUrl":null,"score":null,"fullScore":null,"errorMessage":"OCR 返回为空或太短,无法识别作文内容","batchName":"...","nameCandidates":[],"nameMissing":true,"createdAt":"2026-06-08T06:38:45.997Z"}}
```

**端点路径修正**:任务详情挂在 `/api/essay-batches/tasks/:taskId`(`routes/essay.ts:336`),不是 `/api/essay-tasks/:taskId` —— `/api/essay-tasks` 整个 router 都没注册。

**结论**:既然 OCR 失败,后续的 `score` / `items`(立意/内容/结构/语言/卷面) / `overallComment` / `highlights` / `problems` / `suggestions` / `improvedEssay` / `shortTeacherComment` / `wordUrl` / `pdfUrl` 全部拿不到;**`nameCandidates` 是空数组**(`extractNameCandidates` 在 `recognizedText` 为 null 时短路返回 `[]`),所以前端"快速选名"也救不了。

---

### Test 6: download generated files (PASS)

```bash
curl http://127.0.0.1:3000/api/files/recent -H "Authorization: Bearer $TOKEN"
```

**响应 (200 OK,前 5 条)**:
```json
{"code":0,"data":[
  {"id":"29ae30ac-...","fileName":"九年级作文讲评课——如何让你的文章更准确、更流畅.pdf","fileType":"pdf","fileUrl":"http://localhost:3000/uploads/1780897693751_lecture_...pdf","createdAt":"2026-06-08"},
  {"id":"abaf5c73-...","fileName":"九年级作文讲评课——如何让你的文章更准确、更流畅.docx","fileType":"docx","fileUrl":"http://localhost:3000/uploads/1780897692293_lecture_...docx","createdAt":"2026-06-08"},
  {"id":"3b288312-...","fileName":"以自然之物悟人生之理——记叙文写作讲评课.pdf","fileType":"pdf",...},
  {"id":"86d3377f-...","fileName":"以自然之物悟人生之理——记叙文写作讲评课.docx","fileType":"docx",...},
  {"id":"f271b83b-...","fileName":"_作文批改报告.docx","fileType":"docx",...},
  ...(5+ 条 essay docx 报告)
]}
```

**docx HEAD**:
```
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Length: 11417
```

**pdf HEAD**:
```
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 248226
```

- `/api/files/recent` 直接拿这 10 条都是 **之前成功跑过的历史任务** 的产物,**不是本测试产生的**(本测试任务全失败,没产物)
- 静态文件由 `express.static(UPLOAD_DIR)` 服务,`Accept-Ranges: bytes` 正常,`ETag` 有
- Express 默认不响应 `HEAD` 错,curl 走的 `-I` 头能拿到完整 metadata

---

### Test 7: material search "坚持" (PASS)

```bash
curl "http://127.0.0.1:3000/api/materials?keyword=%E5%9D%9A%E6%8C%81" \
     -H "Authorization: Bearer $TOKEN"
```

**响应 (200 OK,前 4 条)**:
```json
{"code":0,"data":[
  {"id":"7531a2e9-...","title":"竹子","category":"成长","tags":["坚持","厚积薄发","耐心"],"sampleParagraph":"妈妈总说我像家里的那盆文竹,长了很久还是小小一株。可我知道,真正的竹子在地下悄悄扎根。那些做错的题、背过的书、流过的汗,都是我的根。直到那次考试,我第一次冲进班级前十,我知道,我的「第五年」到了。"},
  {"id":"1488c460-...","title":"蝉","category":"成长","tags":["坚持","蜕变","等待"],"sampleParagraph":"整个夏天,蝉都在叫。我曾嫌它吵。可后来才知道,蝉在地下等了四年,只为了这一个夏天的鸣叫。它用四年的黑暗换一个夏天的光明。我在题海里泡了三年,就是想做那只最后能鸣叫的蝉。"},
  {"id":"cfc4b962-...","title":"候鸟","category":"成长","tags":["迁徙","目标","坚持"],"sampleParagraph":"..."},
  {"id":"7e800d42-...","title":"雨滴","category":"时间","tags":["坚持","积累","穿透"],"sampleParagraph":"..."},
  {"id":"156785ba-...","title":"萤火虫","category":"成长","tags":["发光","微小","坚持"],"sampleParagraph":"..."}
]}
```

- 竹子(成长)、蝉(成长) 都在,符合 seed 数据预期
- 候鸟/雨滴/萤火虫 也都因 tag 含 "坚持" 命中,共 5 条

**`?category=坚持`** 返回 `{"code":0,"data":[]}` —— 因为 `category` 字段是 `成长/时间/亲情/友情/励志/...` 这种大分类,"坚持" 只是 `tags[]` 里的一个标签。这是设计正确行为。

---

### Test 8: sentence fix (PASS,curl 编码要修正)

**第一次尝试(FAIL)**:
```bash
curl -X POST http://127.0.0.1:3000/api/sentence-fix \
     -H "Content-Type: application/json" \
     -d '{"sentence":"通过这次活动,使我学到了很多。"}'
```
**响应 (200 OK,但内容是"乱码分析")**:
```json
{"code":0,"data":{"id":"f049d395-...","originalSentence":"ͨ����λ��ʤ��ѧ���˺ܶࡣ","problemAnalysis":"这句话出现了严重的乱码问题,是由于文本编码不一致(如UTF-8、GBK、GB2312等编码混用)导致的字符显示错误...","fixedSentence":"(无法确定原始句子,请检查文本编码后重新输入)","explanation":"乱码不是语法错误,而是技术问题...","similarExample":"...网页源码直接复制到Word文档时,中文显示为'锟斤拷烫烫烫'或符号乱码..."}}
```

**第二次尝试(PASS)**:
```bash
echo '{"sentence":"通过这次活动,使我学到了很多。"}' > /tmp/sf.json
curl -X POST http://127.0.0.1:3000/api/sentence-fix \
     -H "Content-Type: application/json; charset=utf-8" \
     --data-binary @/tmp/sf.json
```
**响应 (200 OK)**:
```json
{"code":0,"data":{"id":"5be0ae63-...","originalSentence":"通过这次活动,使我学到了很多。","problemAnalysis":"这句话存在主语残缺的问题。'通过这次活动'是介词结构,在句中只能作状语;'使'是使令动词,必须带宾语才能表达完整意思。两个成分叠加使用,导致整句话没有主语。常见病句类型是'介词结构+使令动词'造成主语缺失。","fixedSentence":"通过这次活动,我学到了很多。","explanation":"去掉'使'字,让'我'作为句子的主语。介词结构'通过这次活动'作状语,'我'作主语,'学到了很多'作谓语,句子结构就完整了。也可以去掉'通过',让'这次活动'作主语,但保留'通过'更能突出活动的意义。","similarExample":"通过老师的讲解,使我们明白了这个道理。"}}
```

- 5 字段全齐:`originalSentence / problemAnalysis / fixedSentence / explanation / similarExample`
- 病句诊断准确(主语被 "通过...使..." 吞掉),给出最简修改
- **后端代码本身没问题**,是 Windows 下 `bash + curl` 的 `--data` 参数默认 GBK 编码,JSON 里中文到服务端就变 mojibake。Express `body-parser` 没声明 `default charset` 会按 request header 推断,加上 `; charset=utf-8` 才稳。**前端 miniprogram 用 wx.request 一般不会踩这个坑**,但后端最好在 `app.ts` 里写死 `app.use(express.json({ limit: '50mb', type: 'application/json; charset=utf-8' }))` 或类似以防其他 client。

---

### Test 9: lecture review generation (PASS)

```bash
curl -X POST http://127.0.0.1:3000/api/lecture-reviews \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json; charset=utf-8" \
     -d "{\"batchId\":\"$BATCH_ID\"}"
```

**响应 (200 OK,耗时约 30s,生成 8.4KB docx + 153KB pdf)**:
```json
{"code":0,"data":{
  "id":"66aa20a1-779e-4ad1-81e3-3aece3e9ba4d",
  "title":"作文讲评课方案",
  "content":{
    "title":"作文讲评课方案",
    "overallSituation":"本次批改数据未能成功获取,批改系统显示有效作文记录为0篇,平均分为0分,无法基于实际学生作品进行常规讲评。建议任课教师核实批改系统数据上传情况,确认作文提交和批改流程是否正常。在下次批改完成后,可基于真实数据重新生成针对性讲评方案。",
    "mainStrengths":["本次数据不足,暂无优点总结"],
    "commonProblems":["本次数据不足,暂无问题总结"],
    "typicalProblemExplanation":[
      {"problem":"数据缺失导致无法进行讲评","reason":"批改系统未能获取到有效作文数据,可能原因包括:作文未提交、批改流程未完成、系统传输问题等","method":"建议核实作文提交状态,重新进行批改或手动导入批改结果后再开展讲评课"}
    ],
    "excellentExpressions":[],
    "classPractice":[{"exercise":"由于本次无有效作文数据,课堂练习将根据下次批改结果定制","guide":"请等待下次批改完成后再进行针对性练习设计","answer":"待补充"}],
    "afterClassSuggestions":["建议核实批改系统数据上传情况,确保作文已成功提交并批改","下次批改完成后重新导入数据,生成基于实际学生作品情况的讲评课方案","在等待数据期间,可安排学生复习上次课程重点内容或进行写作技能专项..."]
  },
  "wordUrl":"http://localhost:3000/uploads/1780900955147_lecture_66aa20a1_779e_4ad1_81e3_3aece3e9ba4d.docx",
  "pdfUrl":"http://127.0.0.1:3000/uploads/1780900955960_lecture_66aa20a1_779e_4ad1_81e3_3aece3e9ba4d.pdf"
}}
```

**端点签名修正**:
- 原 prompt 写 `POST /api/lecture-reviews` with `{"reportIds": [...]}` → **错**。实际是 `{"batchId": "..."}`(`routes/lecture.ts:39`),从 `essayBatch.tasks` 拉数据,不存在 reportId 这个概念
- 8 字段全齐:`title / overallSituation / mainStrengths / commonProblems / typicalProblemExplanation / excellentExpressions / classPractice / afterClassSuggestions`(`routes/lecture.ts:14` 的 `parseLectureData` 函数会缺字段补默认值,防止 docx/PDF 模板渲染时炸)
- 0 成功任务的兜底逻辑也跑通 —— AI 收到"0 成功"的数据,生成了"无数据"版讲评课方案(虽然没用,但接口没崩)
- 历史 2 条 lecture(fcbf076a、d2fb4b5b)也都有完整 8 字段

---

### Test 10: lecture docx/pdf 下载 (PASS)

**docx HEAD**:
```
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Length: 8376
Last-Modified: Mon, 08 Jun 2026 06:42:35 GMT
```

**pdf HEAD**:
```
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: 153108
```

**完整 GET 验证**:
```bash
curl -o /tmp/lec.docx http://127.0.0.1:3000/uploads/1780900955147_lecture_66aa20a1...docx
curl -o /tmp/lec.pdf  http://127.0.0.1:3000/uploads/1780900955960_lecture_66aa20a1...pdf
file /tmp/lec.docx /tmp/lec.pdf
# /tmp/lec.docx: Microsoft Word 2007+
# /tmp/lec.pdf:  PDF document, version 1.4, 2 page(s)
```

docx magic bytes `50 4B 03 04`(ZIP 容器),pdf magic bytes `25 50 44 46 2D 31 2E 34`(`%PDF-1.4`)。

---

## 3. 发现的问题

### P0(阻塞生产)
- **OCR 在 845KB 真实学生作文图上稳定返回空文本** —— M2.7 走 `ocrViaCreateMessage`(默认两步流水线)在这个图上 10 秒内 fail。**整条作文批改管线因此走不到** `gradeEssay` → `persistReport` → 生成 docx/pdf。,用户在 app 内会上传图片 → 看到任务失败 → 0 输出。,这是核心功能,必须修。
  - 怀疑点:`USE_TWO_STEP` 默认走 `createMessage` + image_url(走 `chat/completions`),prompt 简单(只说"按原文输出,不改写");另一条路径 `recognizeImage`(`/coding_plan/vlm`,prompt 详细到"先识姓名班级学号,再识标题正文,看不清用 [?] 标记")似乎**从未被触发**。建议临时把 `MINIMAX_DIRECT=0` 切到 `recognizeImage` 路径实测一次,看是不是 prompt 不够细导致 M2.7 在 chat 路径上偷懒
  - 或者在 `ocrViaCreateMessage` 的 prompt 里加: `"只输出识别到的文字,不要解释、不要改写、不要加 [?],保留换行"`(M2.7 偶尔会把内容转写或加注)

### P1(体验问题)
- **task/retry 端点路径与 user prompt 不符**:`GET /api/essay-tasks/$TASK_ID` 返回 404,实际是 `GET /api/essay-batches/tasks/$TASK_ID`(`routes/essay.ts:336`)。前端 miniprogram 实际怎么调的需要核对一遍 `pages/essay/...` 的代码 —— 如果前端用了 `/api/essay-tasks/...` 路径,就是前后端不一致,线上 100% 报错
- **GET /api/essay-tasks/tasks/:taskId 路径下 retry 的 retry body** 与创建时的字段不完全一致 —— 反正都是 `imageUrls`/`studentName`,前端应该兼容
- **CORS / `Content-Type` 缺 charset**:Windows curl 默认 GBK,把 JSON 里的 UTF-8 中文弄成 mojibake。建议后端 `app.use(express.json({ limit: '50mb' }))` 改成强制 `type: ['application/json']`(Express 默认就会接受无 charset 的 `application/json`,问题在客户端),同时后端日志应该告警"非 UTF-8 request body" —— 现在这种坏数据会原封不动进 AI,得到"乱码解释"这种垃圾输出,污染 sentence_fix 表
- **batch 名字段支持 GBK 写入 DB**:`routes/essay.ts:26` 直接 `data: { batchName }`,Prisma SQLite 默认 `text` 类型,底层是 UTF-8 字符串,理论上不应该被 GBK 污染,但实测就是 mojibake 进库。,可能是 tsx watch 进程读 `.env` 时被 GBK 化的某个组件污染。**这不影响功能(批改按 id 走),但前端 list 页会显示乱码名**,老师看到会困惑

### P2(可优化)
- **dev-login 端点**:虽然 dev 模式才开,但生产 `NODE_ENV=production` 时返回 404 而不是 401,在 prod 部署的早期会让人误以为"我访问错地址了",可以改成 401/403
- **`updateBatchCounts` 的 status 计算**:`processingCount > 0 → processing` 在所有 task 都 `failed` 的瞬间,如果还有 `processing` 任务(并发场景),batch 会卡在 `processing`。本次测试就遇到 —— start 之后 10s 内 status 直接跳到 `failed`,说明 `processingCount` 已经清零前 `updateBatchCounts` 跑了。**但** 极端竞态下(10 个并发任务,9 个先 fail、第 10 个还在 processing),batch 会一直显示 processing,前端轮询会一直转。建议在 `updateBatchCounts` 加 `failedCount + processingCount === totalCount → 'failed' || 'partial'` 的兜底
- **AI debug 落盘**:从 `extractJson` 走 `temp/ai_debug_*.txt`,但**目录里最新是 06-08 14:27 的旧 debug**(本测试 OCR 失败没写新文件,说明 OCR 失败没经过 `extractJson` 这层,直接是 createMessage 返回了空字符串或者 throw 了)。**可以再加一层 OCR 落盘**:在 `ocrViaCreateMessage` 失败时把 `imagePath` + `aiText`(哪怕空)写到 `temp/ocr_debug_*.txt`,便于排查 OCR 失败是不是稳定空文本

### 已知问题(不在本次范围)
- `/tmp/server.log` 367 行全是历史 tsx watch EADDRINUSE 错误 noise,真正的 dev server 日志在某个我无法 tail 的进程控制台里。建议下次给 dev server 配个 `tee` 到 `logs/dev.log` 或者直接 `nohup npm run dev > logs/dev.log 2>&1 &`

---

## 4. 总结

**项目当前状态**: **不能上生产**。核心的"上传作文图 → 拿到批改报告"流程在 OCR 这一步就 fail 了,老师在 app 里看到的是任务闪失败,什么报告都拿不到。其他外围能力(dev-login / 文件管理 / 素材搜索 / 病句修改 / 讲评课生成 / 文件下载)都是好的,但**主流程不通一切白搭**。

**Top 3 必修(上线前)**:
1. **修 OCR**:`ocrViaCreateMessage` 在测试图上稳定返回空 —— 加 retry、加落盘(`temp/ocr_debug_*.txt`)、加 fallback 到 `recognizeImage`(`/coding_plan/vlm`)路径,确认是哪条 prompt/哪条模型出问题。修不好就直接把 `MINIMAX_DIRECT=0` 切到 `recognizeImage` 路径(那条 prompt 详细得多,虽然慢但稳)
2. **核对前端 API 路径**:task 详情/重试到底是 `/api/essay-tasks/...` 还是 `/api/essay-batches/tasks/...`;lecture 创建到底是 `reportIds` 还是 `batchId`。当前后端是后者,如果前端写了前者,所有"查看报告/重试"按钮都是 404
3. **server.json Content-Type 强制 utf-8 + GBK 落库告警**:在 `app.ts` 把 express.json 配置改成只接受 `application/json` + 校验请求 body 是合法 UTF-8(检测到 GBK 头/坏字节直接 400);同时 batchName 这类用户文本字段在写入 DB 前 `Buffer.isUtf8` 一下,坏的就 400 回去,避免污染列表

**优点**:
- 路由设计清晰(`/api/files/upload` 独立、`/api/essay-batches/tasks/:id` 走主资源前缀)
- 8 字段 lecture 模板 + 缺字段补默认值的 `parseLectureData`(`routes/lecture.ts:14`)是教科书级别的容错
- `extractNameCandidates` 在 OCR 没拿到姓名时返回候选数组(`essay.service.ts:70`)给前端做"快速选名"—— 这个设计很贴心
- `Promise.allSettled` 兜底 + `requestId` 中间件 + pino 结构化日志,这些基础设施都是生产级

**测试覆盖**:10 项,涵盖了登录 / 批改 / 讲评 / 下载 / 搜索 / 病句 全链路,但**主链路(批改报告产出)**在 OCR 这一刀被切断了,所以本质是 **9 项外围 + 1 项核心 fail**。
