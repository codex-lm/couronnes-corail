export class I18n {
  constructor(locales, language = 'en') {
    this.locales = locales;
    this.language = locales[language] ? language : 'en';
  }

  setLanguage(language) {
    if (this.locales[language]) this.language = language;
  }

  t(key, params = {}) {
    let text = this.locales[this.language]?.[key] ?? this.locales.en?.[key] ?? key;
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  apply(root = document) {
    for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = this.t(element.dataset.i18n);
    for (const element of root.querySelectorAll('[data-i18n-title]')) element.title = this.t(element.dataset.i18nTitle);
    document.documentElement.lang = this.language;
  }
}
