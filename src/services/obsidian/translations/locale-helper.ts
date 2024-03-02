// from https://github.com/valentine195/obsidian-admonition/blob/master/src/lang/helpers.ts

import { moment } from 'obsidian';
import en from "./locale/en";
import zhCN from "./locale/zh-cn";

const localeMap: { [k: string]: Partial<typeof en> } = {
  en: en,
  'zh-cn': zhCN,
};

const locale = localeMap[moment.locale()];

export function t(str: keyof typeof en): string {
  return (locale && locale[str]) || en[str];
}