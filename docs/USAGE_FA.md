# راهنمای فارسی استفاده

## معماری

```text
ChatGPT / Helios
      ↓  mcp mac + http_fetch
LinkedIn Agent روی مک: 127.0.0.1:3190
      ↓  OAuth رسمی
LinkedIn API
```

این سرویس فقط روی خود مک قابل دسترسی است و به دامنه یا VPS نیاز ندارد.

## نصب

1. در LinkedIn Developer Portal یک App بسازید.
2. Redirect URL زیر را ثبت کنید:

   `http://127.0.0.1:3190/oauth/callback`

3. Repository را روی مک Clone کنید.
4. فایل `Install.command` را اجرا کنید.
5. Client ID را در Terminal وارد کنید.
6. Client Secret را فقط در ورودی مخفی Terminal وارد کنید؛ داخل چت نفرستید.
7. مرورگر باز می‌شود؛ دسترسی OAuth را تأیید کنید.

Client Secret و Access Token در Keychain مک ذخیره می‌شوند و داخل فایل‌های پروژه قرار نمی‌گیرند.

## تست اتصال

```bash
curl http://127.0.0.1:3190/health
curl http://127.0.0.1:3190/oauth/status
```

## استفاده در چت

```text
هلیوس، با mcp mac وضعیت اتصال لینکدین من را از
http://127.0.0.1:3190/oauth/status بررسی کن.
```

```text
پروفایل پایه لینکدین من را بخوان؛ ایمیل و شناسه داخلی را نمایش نده.
```

برای انتشار، ابتدا متن نهایی را تأیید کنید. سپس Agent باید `confirmed=true` ارسال کند.

## محدودیت‌ها

امکان هر عملیات به Product و Scopeهای تأییدشده توسط LinkedIn بستگی دارد. تاریخچه کامل پست‌ها، Feed و Analytics ممکن است تا زمان تأیید Community Management خطای 403 بدهند. این پروژه هیچ محدودیتی را دور نمی‌زند و از Scraping، Cookie یا رمز LinkedIn استفاده نمی‌کند.
