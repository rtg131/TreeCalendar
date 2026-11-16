const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "passport.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "aol.com", "aim.com",
  "gmx.com", "gmx.net", "gmx.de", "yandex.com", "yandex.ru", "ya.ru", "mail.com", "email.com", "usa.com", "zoho.com", "zohomail.com",
  "fastmail.com", "fastmail.fm", "hey.com", "tutanota.com", "tuta.io", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "qq.com",
  "163.com", "126.com", "sina.com", "naver.com", "hanmail.net", "web.de", "t-online.de", "orange.fr", "free.fr", "libero.it",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net", "cox.net", "charter.net", "earthlink.net",
  "duck.com", "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "yopmail.com",
]);

const FREE_MAIL_FAMILIES = /^(yahoo|ymail|outlook|hotmail|live|windowslive|gmx|yandex|aol|zoho|proton|protonmail)\.[a-z.]+$/;

export const isFreeMailDomain = (domain: string) => FREE_MAIL.has(domain) || FREE_MAIL_FAMILIES.test(domain);

export const isAcademicDomain = (domain: string) => /(^|\.)edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(domain);

export const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
