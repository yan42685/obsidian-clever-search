import { Notice } from "obsidian";
import { t } from "src/services/obsidian/translations/locale-helper";

export const RELEASE_ANNOUNCEMENT_VERSION_030 = "0.3";

export function showReleaseAnnouncementNotice(): Notice {
	const notice = new Notice(buildReleaseAnnouncementFragment(), 0);
	notice.noticeEl.style.maxWidth = "560px";
	notice.messageEl.style.whiteSpace = "normal";
	return notice;
}

function buildReleaseAnnouncementFragment(): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const wrapper = document.createElement("div");
	wrapper.className = "cs-release-announcement-notice";
	wrapper.style.display = "grid";
	wrapper.style.gap = "0.45em";

	const titleEl = document.createElement("div");
	titleEl.textContent = t("releaseAnnouncement.0_3.title");
	titleEl.style.fontWeight = "700";
	titleEl.style.fontSize = "1.05em";
	wrapper.appendChild(titleEl);

	const introEl = document.createElement("div");
	introEl.textContent = t("releaseAnnouncement.0_3.intro");
	wrapper.appendChild(introEl);

	const listEl = document.createElement("ul");
	listEl.style.margin = "0.15em 0 0.2em 1.25em";
	listEl.style.padding = "0";
	appendListItem(listEl, t("releaseAnnouncement.0_3.item.lexical"));
	appendListItem(listEl, t("releaseAnnouncement.0_3.item.hybrid"));
	appendListItem(listEl, t("releaseAnnouncement.0_3.item.quickSwitch"));
	wrapper.appendChild(listEl);

	const footerEl = document.createElement("div");
	footerEl.textContent = t("releaseAnnouncement.0_3.footer");
	footerEl.style.opacity = "0.9";
	wrapper.appendChild(footerEl);

	fragment.appendChild(wrapper);
	return fragment;
}

function appendListItem(listEl: HTMLUListElement, text: string): void {
	const itemEl = document.createElement("li");
	itemEl.textContent = text;
	itemEl.style.marginBottom = "0.2em";
	listEl.appendChild(itemEl);
}
