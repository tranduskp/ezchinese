#!/bin/sh
# Cloudflare Pages: build command "sh build.sh", output directory "dist".
# Chỉ chép file của trang (không lấy .git — gói lịch sử git > 25 MB làm Cloudflare báo "Asset too large").
set -e
rm -rf dist
mkdir dist
cp -r index.html app.js style.css _headers audio brand data dist/
echo "dist: $(find dist -type f | wc -l) file"
