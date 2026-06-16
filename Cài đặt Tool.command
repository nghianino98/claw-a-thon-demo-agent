#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo "    🚀 CÀI ĐẶT DIDI AI TOOL TỰ ĐỘNG 🚀    "
echo "=========================================="

# Check if npm exists, if not try installing Node.js via Homebrew
if ! command -v npm &> /dev/null; then
    echo "⚠️ Không tìm thấy Node.js. Tiến hành cài đặt tự động Node.js..."
    
    if ! command -v brew &> /dev/null; then
        echo "[!] Không tìm thấy Homebrew. Đang tải và cài đặt Homebrew (Công cụ quản lý thư viện của Mac)..."
        echo "[!] LƯU Ý: Quá trình này có thể yêu cầu bạn nhập mật khẩu máy tính của mình."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Load brew into PATH mapping based on processor architecture (M1/M2/Intel)
        if [ -x "/opt/homebrew/bin/brew" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -x "/usr/local/bin/brew" ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    fi
    
    echo "📦 Đang tải và cài đặt bản chính thức của Node.js..."
    brew install node

    if ! command -v npm &> /dev/null; then
        echo "❌ Lỗi: Cài đặt Node.js chạy tự động thất bại."
        echo "Vui lòng truy cập https://nodejs.org/ để tải bộ cài Node.js LTS tự động."
        sleep 10
        exit 1
    fi
    echo "✅ Cài đặt Node.js thành công!"
fi

# Check if pip3 exists
if ! command -v pip3 &> /dev/null && ! command -v pip &> /dev/null; then
    echo "❌ Lỗi: Không tìm thấy Python (pip). Công cụ này cần Python 3 để chạy các đoạn mã crawl."
    echo "Đang thoát..."
    sleep 10
    exit 1
fi

echo "[1/2] Đang cài đặt thư viện cho Node.js (Frontend & Backend)..."
npm install --no-fund --no-audit

echo "[2/2] Đang cài đặt thư viện cho Python (Scripts)..."

# Tạo môi trường Python ảo (.venv) nếu chưa có
if [ ! -d ".venv" ]; then
    echo "   -> Đang tạo môi trường Python ảo (.venv)..."
    # Ưu tiên dùng Python của Homebrew nếu có
    if [ -x "/opt/homebrew/bin/python3" ]; then
        /opt/homebrew/bin/python3 -m venv .venv
    else
        python3 -m venv .venv
    fi
fi

echo "   -> Đang cài đặt thư viện vào môi trường ảo..."
.venv/bin/pip install -r src/scripts/confluence_docs_tools/requirements.txt

echo "=========================================="
echo "✅ CÀI ĐẶT HOÀN TẤT!"
echo "🎉 Bây giờ bạn chỉ cần click đúp vào file 'Start App.command' để mở tool như mọi khi."
echo "Bạn có thể Copy cái Folder này tùy thích."
echo "=========================================="
echo "Bạn có thể tắt cửa sổ này (sẽ tự đóng sau 5 giây)."
sleep 5
exit 0
