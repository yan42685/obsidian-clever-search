import { OuterSetting } from "./globals/plugin-setting";
import { getInstance } from "./utils/my-lib";

export async function devTest() {
	void getInstance(OuterSetting);
}
