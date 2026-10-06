# EzChinese · Luyện nghe – chép (website tĩnh)

Nghe một câu tiếng Trung → gõ lại (pinyin / chữ Hán / ghép từ) → chấm từng chữ. Có thêm dạng Dịch (Việt → Trung)
và Đọc (đọc to, máy nhận giọng của trình duyệt chấm từng chữ theo âm + thanh; cần Chrome / Edge / Safari và HTTPS). Chia theo cấp HSK 3.0,
theo điểm ngữ pháp, theo chủ đề; có phản xạ tốc độ và ôn câu sai (lặp lại ngắt quãng).

Toàn bộ là file tĩnh — không cần server, không cần cơ sở dữ liệu. Tiến độ người học lưu trong trình duyệt
(`localStorage`); muốn chuyển sang máy khác: Cài đặt → Sao lưu tiến độ → sao chép mã `EZ1.…` rồi dán ở máy kia.

## Cấu trúc

```
website/
├── index.html · style.css · app.js     # giao diện + bộ chấm + ôn tập
├── data/
│   ├── index.json                     # danh sách cấp / bài
│   ├── hsk1-g-G1-57.json …            # mỗi bài 1 file (câu, pinyin từng chữ, từ, nghĩa, audio)
│   ├── hsk1-speed.json                # mọi câu của cấp, ngắn → dài (phản xạ tốc độ)
│   ├── syllables.json · vocab.json    # âm tiết pinyin hợp lệ · từ vựng theo cấp (ô gây nhiễu)
│   ├── pinyin-chars.json             # chữ → cách đọc (chế độ Đọc: chấm theo âm + thanh, không theo chữ)
│   ├── hsk<N>-today.json              # ~120 câu nhẹ cho thẻ "Câu hôm nay" ở trang chủ
│   ├── affiliate.json                 # link Shopee: màn trước bài + "Dụng cụ học gợi ý"
│   └── site.json                      # bg_video: link YouTube làm video nền mặc định (mờ, tắt tiếng)
└── audio/*.mp3                        # giọng đọc mỗi câu (tốc độ chậm / nhanh do trình duyệt chỉnh)
```

## Tạo nội dung (chạy ở thư mục gốc dự án)

```bash
python ez.py web gen --level 1          # Gemini sinh ~12 câu / bài, máy loại câu dùng từ ngoài cấp
python ez.py web gen --level 2 3 4      # gói miễn phí có giới hạn lượt / ngày: hết lượt thì chạy lại hôm sau,
                                        # bài đã có sẽ được bỏ qua
python ez.py web export                 # pinyin, tách từ, audio → website/data + website/audio
python ez.py web serve                  # xem thử ở http://127.0.0.1:8780
python ez.py web shopee "<file>.csv"    # nạp file "Lấy link Shopee hàng loạt" vào thẻ ưu đãi ở màn kết quả
python ez.py web link "我可以去吗？"       # link vào thẳng một câu (#/s/<mã câu>) để dán vào mô tả video
python ez.py web deploy "ghi chú"       # commit + push → Cloudflare Pages tự đưa lên mạng (~1 phút)
python ez.py web deploy --export        # export lại dữ liệu rồi mới đẩy
```

## Deploy

Thư mục `website/` là một repo git riêng: github.com/tranduskp/ezchinese (private), nối với Cloudflare Pages
(Cloudflare Workers, deploy command `npx wrangler deploy`: tải lên cả repo, `.assetsignore` loại `.git` > 25 MiB, README, build.sh. Nếu là project Pages kiểu cũ: build command `sh build.sh`, output directory `dist`). Mỗi lần push nhánh `main` là Cloudflare tự deploy.
Cache đặt trong `_headers`: audio 1 năm (tên file là mã băm giọng|câu, không bao giờ đổi nội dung),
`data/` 5 phút, html/js/css luôn hỏi lại. Gói miễn phí: băng thông không giới hạn, tối đa 20.000 file / 25 MB mỗi file.

Link Shopee (`affiliate.json` → `offers`) chỉ hiện ở cuối màn kết quả, người học tự bấm; không chặn trước bài.
Mỗi lần chọn ngẫu nhiên một link còn hạn ưu đãi; link
hết hạn (`end`) tự bị bỏ. Hết tháng: tải CSV mới trong trang Shopee Affiliate rồi chạy lại lệnh `web shopee`.

Ngân hàng câu gốc nằm ở `data/webbank/hsk<N>/<bài>.json`. Muốn bỏ một câu: đổi `"status": "rejected"` rồi export lại.

## Kiểm thử (chạy ở thư mục gốc dự án)

```bash
node --test "tests/web/*.test.mjs"      # cần Node 22+ và Chrome/Edge; không cần cài thư viện
```

- `tests/web/data.test.mjs`: dữ liệu — bài trong chỉ mục có file, pinyin khớp từng chữ, âm tiết hợp lệ, tách từ khớp câu,
  audio đủ, câu không lẫn chữ Latin. Nên chạy sau mỗi lần `web export`.
- `tests/web/app.test.mjs`: chạy `app.js` trong Chrome headless — chấm pinyin / chữ Hán, ôn câu sai, sao lưu, các luồng làm bài.

## Đưa lên mạng (miễn phí)

- **Cloudflare Pages**: Create project → Upload assets → kéo thả cả thư mục `website/`.
- **GitHub Pages / Netlify**: trỏ vào thư mục `website/`.

Phải mở qua web server (không mở trực tiếp file `index.html`) vì trang tải dữ liệu bằng `fetch`.

## Trước khi công khai — cần quyết

- **Giọng đọc**: audio hiện tạo bằng edge-tts (dịch vụ Microsoft dùng không chính thức) — chưa rõ được dùng
  thương mại hay không. Nên chuyển sang dịch vụ TTS có giấy phép (Azure Speech, Gemini TTS gói trả phí...)
  trước khi gắn kiếm tiền.
- **Duyệt câu**: câu do AI soạn đã qua máy kiểm tra từ vựng, nhưng nên đọc lướt từng bài trước khi công khai.
- **Link tiếp thị liên kết**: chỉ đặt ở dạng link người học tự bấm, có ghi rõ là link tiếp thị (`data/affiliate.json`).
