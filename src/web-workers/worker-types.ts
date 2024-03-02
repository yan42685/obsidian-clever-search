export type Message = {
	type: MessageType;
};

export type Result = {
	msg?: string;
	data?: any;
};

export type MessageType = "image-search";
