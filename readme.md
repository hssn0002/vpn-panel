# 🚀 VPN User Management Panel

پنل مدیریت کاربر VPN با قابلیت‌های کامل — مستقل، بدون نیاز به MySQL، پشتیبانی از چند ساب و تلگرام.

## ✨ ویژگی‌ها

- 🎨 **UI مدرن** — گلس مورفیسم + انیمیشن + فونت فارسی وزیرمتن
- 🔐 **پنل ادمین مخفی** — مسیر قابل تنظیم، JWT + bcrypt
- 📊 **پارسر ساب** — تشخیص خودکار حجم/زمان از هدر `subscription-userinfo`
- 🔗 **چند ساب برای هر کاربر** — جمع حجم + بیشترین زمان
- ∞ **حالت حجم نامحدود** — با لینک‌های VLESS دستی
- 💬 **چت Real-time** — WebSocket + ارسال عکس + نوتیفیکیشن
- 🤖 **بات تلگرام** — بکاپ خودکار هر ۵ دقیقه + اعلان پیام
- 📦 **بکاپ و بازیابی** — دستی/خودکار، کامل با SSL cert
- ⚡ **مستقل** — SQLite داخلی، فقط Node.js نیاز داره

## 🚀 نصب سریع (اوبونتو ۲۲)

```bash
# پیش‌نیاز: Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# دانلود و اجرا
git clone https://github.com/YOUR_USER/vpn-panel.git
cd vpn-panel
bash start.sh
```

یا بدون git:

```bash
unzip vpn-panel.zip -d /root/panel
cd /root/panel
bash start.sh
```

## 📋 آدرس‌ها

| بخش | آدرس |
|------|-------|
| صفحه اصلی | `http://IP:3000` |
| پنل ادمین | `http://IP:3000/panel_h` |
| پنل کاربر | `http://IP:3000/u/username` |
| رمز پیش‌فرض | `427726` |

## 🔧 تنظیمات

از طریق پنل ادمین:
- تغییر رمز عبور
- تنظیم توکن و آیدی تلگرام
- آپلود SSL certificate
- تنظیم آدرس سایت
- تغییر مسیر پنل

## 📁 ساختار پروژه

```
vpn-panel/
├── server.js          # سرور اصلی Express + WebSocket
├── db.js              # SQLite database layer
├── sub-parser.js      # پارسر لینک‌های ساب VLESS
├── telegram.js        # یکپارچگی بات تلگرام
├── backup.js          # سیستم بکاپ
├── start.sh           # اسکریپت راه‌اندازی
├── public/
│   ├── index.html     # صفحه اصلی (لندینگ)
│   ├── admin.html     # پنل ادمین
│   ├── user.html      # پنل کاربر
│   ├── css/style.css  # استایل‌ها
│   └── js/
│       ├── admin.js   # منطق پنل ادمین
│       └── user.js    # منطق پنل کاربر
├── db/                # دیتابیس (auto-generated)
├── backups/           # فایل‌های بکاپ
└── certs/             # گواهی‌های SSL
```

## 🛡️ امنیت

- تمام رمزها با bcrypt هش می‌شوند
- احراز هویت JWT با expiry
- SQLite با WAL mode برای performance
- ورودی‌ها sanitize می‌شوند
- مسیر پنل ادمین مخفی و قابل تغییر

## 📄 License

MIT
