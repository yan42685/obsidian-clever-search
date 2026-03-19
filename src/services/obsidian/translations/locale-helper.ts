// from https://github.com/valentine195/obsidian-admonition/blob/master/src/lang/helpers.ts

import { moment } from 'obsidian';
import en from "./locale/en";
import zhCN from "./locale/zh-cn";

const localeMap: { [k: string]: Partial<typeof en> } = {
  en: en,
  'zh-cn': zhCN,
};

const locale = localeMap[moment.locale()];

export type LocaleKey = keyof typeof en;

export function t(str: LocaleKey): string {
  return (locale && locale[str]) || en[str];
}
