export enum LanguageEnum {
    // null = "English",
    en = "English",
    zh = "简体中文",
    "zh-TW" = "繁體中文",
    ru = "Pусский",
    ko = "한국어",
    it = "Italiano",
    id = "Bahasa Indonesia",
    ro = "Română",
    "pt-BR" = "Portugues do Brasil",
    cz = "čeština",
    de = "Deutsch",
    es = "Español",
    fr = "Français",
    no = "Norsk",
    pl = "język polski",
    pt = "Português",
    ja = "日本語",
    da = "Dansk",
    uk = "Український",
    sq = "Shqip",
    tr = "Türkçe (kısmi)",
    hi = "हिन्दी (आंशिक)",
    nl = "Nederlands (gedeeltelijk)",
    ar = "العربية (جزئي)"
}

export function getCurrLanguage(): LanguageEnum {
    const langKey = window.localStorage.getItem("language") || "en";
    if (langKey in LanguageEnum) {
        return LanguageEnum[langKey as keyof typeof LanguageEnum];
    } else {
        throw new Error(`Invalid or missing language key: ${langKey}`);
    }
}