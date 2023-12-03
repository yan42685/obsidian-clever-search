import * as fsLib from "fs";
import * as pathLib from "path";

// for autocompletion
export const fsUtils = fsLib;
export const pathUtils = pathLib;
export function getModKey() {
  const ua = navigator.userAgent;
  return /Mac|iPod|iPhone|iPad/.test(ua) ? 'Mod' : 'Ctrl';
}